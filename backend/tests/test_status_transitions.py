from copy import deepcopy
import unittest
from unittest.mock import AsyncMock, Mock, patch

from bson import ObjectId
from fastapi import HTTPException
from pydantic import ValidationError

from app.main import app
from app.schemas.master_form import MasterFormPatch, ResponseHandling
from app.services.master_forms import (
    ALLOWED_TRANSITIONS,
    TRANSITION_STATUSES,
    can_transition,
    soft_delete_master_form,
    update_master_form,
)


class TransitionMatrixTests(unittest.TestCase):
    def test_only_the_documented_pairs_are_allowed(self) -> None:
        expected = {
            ("DRAFT", "PUBLISHED"),
            ("DRAFT", "ARCHIVED"),
            ("PUBLISHED", "ARCHIVED"),
            ("PUBLISHED", "DRAFT"),
            ("ARCHIVED", "DRAFT"),
        }
        self.assertEqual(set(ALLOWED_TRANSITIONS), expected)
        for current in TRANSITION_STATUSES:
            for target in TRANSITION_STATUSES:
                with self.subTest(current=current, target=target):
                    self.assertEqual(
                        can_transition(current, target),
                        (current, target) in expected,
                    )

    def test_archived_cannot_be_published_directly(self) -> None:
        self.assertFalse(can_transition("ARCHIVED", "PUBLISHED"))

    def test_same_status_is_not_a_transition(self) -> None:
        for status in TRANSITION_STATUSES:
            with self.subTest(status=status):
                self.assertFalse(can_transition(status, status))

    def test_unknown_status_is_not_a_transition(self) -> None:
        self.assertFalse(can_transition("ARCHIVED", "DELETED"))
        self.assertFalse(can_transition("not-a-status", "DRAFT"))

class PatchPayloadTests(unittest.TestCase):
    def test_accepts_a_status_only_payload(self) -> None:
        for status in TRANSITION_STATUSES:
            with self.subTest(status=status):
                payload = MasterFormPatch(status=status)
                self.assertEqual(payload.status, status)
                self.assertEqual(payload.model_fields_set, {"status"})

    def test_accepts_selected_version_when_reopening_as_draft(self) -> None:
        payload = MasterFormPatch(
            status="DRAFT",
            masterFormVersionId="6ae436c49f91d4bde87c9ac5",
        )
        self.assertEqual(payload.status, "DRAFT")
        self.assertEqual(
            payload.masterFormVersionId, "6ae436c49f91d4bde87c9ac5"
        )

    def test_accepts_selected_published_version_when_archiving(self) -> None:
        payload = MasterFormPatch(
            status="ARCHIVED",
            masterFormVersionId="6ae436c49f91d4bde87c9ac5",
        )
        self.assertEqual(payload.status, "ARCHIVED")
        self.assertEqual(
            payload.masterFormVersionId, "6ae436c49f91d4bde87c9ac5"
        )

    def test_accepts_a_configuration_only_payload(self) -> None:
        payload = MasterFormPatch(title="Updated title", layout="WIZARD")
        self.assertIsNone(payload.status)
        self.assertEqual(payload.model_fields_set, {"title", "layout"})

    def test_accepts_a_saved_version_edit_payload(self) -> None:
        payload = MasterFormPatch(
            masterFormVersionId="6ae436c49f91d4bde87c9ac5",
            title="Edited saved version",
        )
        self.assertEqual(
            payload.masterFormVersionId, "6ae436c49f91d4bde87c9ac5"
        )

    def test_rejects_an_empty_payload(self) -> None:
        with self.assertRaises(ValidationError):
            MasterFormPatch()

    def test_rejects_combined_configuration_and_status(self) -> None:
        with self.assertRaises(ValidationError):
            MasterFormPatch(status="PUBLISHED", title="Updated title")

    def test_rejects_saved_version_selector_without_changes(self) -> None:
        with self.assertRaises(ValidationError):
            MasterFormPatch(masterFormVersionId="6ae436c49f91d4bde87c9ac5")

    def test_rejects_combining_saved_version_edit_with_status(self) -> None:
        with self.assertRaises(ValidationError):
            MasterFormPatch(
                masterFormVersionId="6ae436c49f91d4bde87c9ac5",
                title="Updated title",
                status="DRAFT",
            )

    def test_rejects_version_selection_for_non_draft_status(self) -> None:
        with self.assertRaises(ValidationError):
            MasterFormPatch(
                status="PUBLISHED",
                masterFormVersionId="6ae436c49f91d4bde87c9ac5",
            )

    def test_rejects_null_status(self) -> None:
        with self.assertRaises(ValidationError):
            MasterFormPatch(status=None)

    def test_rejects_unknown_status(self) -> None:
        with self.assertRaises(ValidationError):
            MasterFormPatch(status="DELETED")

    def test_rejects_extra_properties(self) -> None:
        with self.assertRaises(ValidationError):
            MasterFormPatch(status="DRAFT", actorId="someone")


class ResponseHandlingSchemaTests(unittest.TestCase):
    def test_accepts_http_success_and_failure_status_codes(self) -> None:
        handling = ResponseHandling(
            successStatusCodes=[200, 201],
            failureStatusCodes=[404, 500],
        )

        self.assertEqual(handling.successStatusCodes, [200, 201])
        self.assertEqual(handling.failureStatusCodes, [404, 500])

    def test_failure_status_codes_default_to_empty(self) -> None:
        handling = ResponseHandling()

        self.assertEqual(handling.failureStatusCodes, [])


class PatchRouteTests(unittest.TestCase):
    def test_patch_route_documents_both_operations(self) -> None:
        document = app.openapi()
        operation = document["paths"]["/api/v1/master-forms/{masterFormId}"]["patch"]
        self.assertEqual(operation["tags"], ["master-forms"])
        self.assertIn("409", operation["responses"])
        self.assertIn("422", operation["responses"])
        self.assertIn("configuration", operation["description"].lower())
        self.assertIn("status", operation["description"].lower())
        self.assertIn("masterFormVersionId", operation["description"])

        body = operation["requestBody"]["content"]["application/json"]["schema"]
        ref = body.get("$ref")
        if ref:
            body = document["components"]["schemas"][ref.rsplit("/", 1)[-1]]
        self.assertIn("status", body["properties"])
        self.assertIn("sections", body["properties"])
        self.assertIn("masterFormVersionId", body["properties"])
        self.assertIn(
            "no replacement version is required", operation["description"]
        )

    def test_merged_routes_are_removed(self) -> None:
        paths = app.openapi()["paths"]
        self.assertNotIn("/api/v1/master-forms/{masterFormId}/status", paths)
        self.assertEqual(
            sorted(paths["/api/v1/master-forms/{masterFormId}/versions"]), ["get"]
        )
        self.assertNotIn("/api/v1/master-forms/{masterFormId}/publish", paths)
        self.assertNotIn("/api/v1/master-forms/{masterFormId}/archive", paths)


class PublishedToDraftTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.form_id = ObjectId()
        self.active_version_id = ObjectId()
        self.selected_version_id = ObjectId()
        self.selected_snapshot = {
            "name": "Old form name",
            "formType": "ASSESSMENT",
            "title": "Old draft version",
            "layout": "SINGLE_PAGE",
            "Buttons": [],
            "sections": [],
        }
        self.current = {
            "_id": self.form_id,
            "status": {"valueSetId": ObjectId(), "code": "PUBLISHED"},
            "currentVersion": 2,
            "versions": [
                {
                    "_id": self.selected_version_id,
                    "version": 1,
                    "snapshot": deepcopy(self.selected_snapshot),
                },
                {
                    "_id": self.active_version_id,
                    "version": 2,
                    "snapshot": {
                        **self.selected_snapshot,
                        "title": "Currently published",
                    },
                },
            ],
            "isDeleted": False,
        }
        self.collection = Mock()
        self.collection.find_one = AsyncMock(return_value=self.current)
        self.collection.find_one_and_update = AsyncMock(
            return_value={"_id": self.form_id, "status": "DRAFT", "currentVersion": 1}
        )

    async def test_reopening_uses_selected_snapshot_and_preserves_history(self) -> None:
        with (
            patch(
                "app.services.master_forms.actor_object_id",
                return_value=ObjectId(),
            ),
            patch(
                "app.services.master_forms.get_master_forms_collection",
                return_value=self.collection,
            ),
            patch(
                "app.services.master_forms.load_value_set_references",
                new_callable=AsyncMock,
                return_value={},
            ),
            patch(
                "app.services.master_forms.reference_for",
                side_effect=lambda code, _set, _values: {"code": code},
            ),
            patch(
                "app.services.master_forms.references_for_storage",
                side_effect=lambda document, _values: document,
            ),
        ):
            result = await update_master_form(
                str(self.form_id),
                MasterFormPatch(
                    status="DRAFT",
                    masterFormVersionId=str(self.selected_version_id),
                ),
            )

        query, update = self.collection.find_one_and_update.await_args.args[:2]
        self.assertEqual(query["currentVersion"], 2)
        self.assertEqual(query["versions._id"], self.selected_version_id)
        self.assertEqual(update["$set"]["status"], {"code": "DRAFT"})
        self.assertEqual(update["$set"]["currentVersion"], 1)
        self.assertEqual(update["$set"]["title"], "Old draft version")
        self.assertEqual(update["$set"]["versions.$[active].status"], "DRAFT")
        self.assertEqual(update["$set"]["versions.$[selected].status"], "DRAFT")
        self.assertEqual(self.current["versions"][0]["snapshot"], self.selected_snapshot)
        self.assertEqual(result["currentVersion"], 1)

    async def test_reopening_selected_active_version_uses_only_active_array_filter(
        self,
    ) -> None:
        with (
            patch(
                "app.services.master_forms.actor_object_id",
                return_value=ObjectId(),
            ),
            patch(
                "app.services.master_forms.get_master_forms_collection",
                return_value=self.collection,
            ),
            patch(
                "app.services.master_forms.load_value_set_references",
                new_callable=AsyncMock,
                return_value={},
            ),
            patch(
                "app.services.master_forms.reference_for",
                side_effect=lambda code, _set, _values: {"code": code},
            ),
            patch(
                "app.services.master_forms.references_for_storage",
                side_effect=lambda document, _values: document,
            ),
        ):
            await update_master_form(
                str(self.form_id),
                MasterFormPatch(
                    status="DRAFT",
                    masterFormVersionId=str(self.active_version_id),
                ),
            )

        _, update = self.collection.find_one_and_update.await_args.args[:2]
        self.assertEqual(
            update["$set"]["versions.$[active].status"],
            "DRAFT",
        )
        self.assertNotIn("versions.$[selected].status", update["$set"])
        self.assertEqual(
            self.collection.find_one_and_update.await_args.kwargs["array_filters"],
            [{"active._id": self.active_version_id}],
        )

    async def test_reopening_with_multiple_versions_requires_a_selection(self) -> None:
        with (
            patch(
                "app.services.master_forms.actor_object_id",
                return_value=ObjectId(),
            ),
            patch(
                "app.services.master_forms.get_master_forms_collection",
                return_value=self.collection,
            ),
        ):
            with self.assertRaises(HTTPException) as raised:
                await update_master_form(
                    str(self.form_id), MasterFormPatch(status="DRAFT")
                )

        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(
            raised.exception.detail["code"],
            "MASTER_FORM_VERSION_SELECTION_REQUIRED",
        )
        self.collection.find_one_and_update.assert_not_called()


class PublishedToArchivedTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.form_id = ObjectId()
        self.active_version_id = ObjectId()
        self.alternate_version_id = ObjectId()
        self.current = {
            "_id": self.form_id,
            "status": {"valueSetId": ObjectId(), "code": "PUBLISHED"},
            "currentVersion": 2,
            "versions": [
                {
                    "_id": self.alternate_version_id,
                    "version": 1,
                    "status": "DRAFT",
                    "snapshot": {},
                },
                {
                    "_id": self.active_version_id,
                    "version": 2,
                    "status": "PUBLISHED",
                    "snapshot": {},
                },
            ],
            "isDeleted": False,
        }
        self.collection = Mock()
        self.collection.find_one = AsyncMock(return_value=self.current)

    async def test_published_form_with_one_version_can_be_archived_directly(
        self,
    ) -> None:
        self.current["versions"] = [self.current["versions"][1]]
        updated = {**self.current, "status": {"code": "ARCHIVED"}}
        self.collection.find_one_and_update = AsyncMock(return_value=updated)
        with (
            patch(
                "app.services.master_forms.actor_object_id",
                return_value=ObjectId(),
            ),
            patch(
                "app.services.master_forms.get_master_forms_collection",
                return_value=self.collection,
            ),
            patch(
                "app.services.master_forms.load_value_set_references",
                new_callable=AsyncMock,
                return_value={},
            ),
            patch(
                "app.services.master_forms.reference_for",
                side_effect=lambda code, _set, _values: {"code": code},
            ),
        ):
            result = await update_master_form(
                str(self.form_id), MasterFormPatch(status="ARCHIVED")
            )

        query, update = self.collection.find_one_and_update.await_args.args[:2]
        self.assertEqual(query["currentVersion"], 2)
        self.assertEqual(update["$set"]["status"], {"code": "ARCHIVED"})
        self.assertEqual(update["$set"]["versions.$[active].status"], "ARCHIVED")
        self.assertIs(result, updated)

    async def test_published_form_can_be_archived_without_a_version_switch(
        self,
    ) -> None:
        updated = {**self.current, "status": {"code": "ARCHIVED"}}
        self.collection.find_one_and_update = AsyncMock(return_value=updated)
        with (
            patch(
                "app.services.master_forms.actor_object_id",
                return_value=ObjectId(),
            ),
            patch(
                "app.services.master_forms.get_master_forms_collection",
                return_value=self.collection,
            ),
            patch(
                "app.services.master_forms.load_value_set_references",
                new_callable=AsyncMock,
                return_value={},
            ),
            patch(
                "app.services.master_forms.reference_for",
                side_effect=lambda code, _set, _values: {"code": code},
            ),
        ):
            result = await update_master_form(
                str(self.form_id), MasterFormPatch(status="ARCHIVED")
            )

        self.assertIs(result, updated)
        self.assertEqual(
            self.collection.find_one_and_update.await_args.args[0]["currentVersion"],
            2,
        )

    async def test_published_form_cannot_be_archived_using_an_unpublished_alternate(
        self,
    ) -> None:
        with (
            patch(
                "app.services.master_forms.actor_object_id",
                return_value=ObjectId(),
            ),
            patch(
                "app.services.master_forms.get_master_forms_collection",
                return_value=self.collection,
            ),
        ):
            with self.assertRaises(HTTPException) as raised:
                await update_master_form(
                    str(self.form_id),
                    MasterFormPatch(
                        status="ARCHIVED",
                        masterFormVersionId=str(self.alternate_version_id),
                    ),
                )

        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(
            raised.exception.detail["code"],
            "MASTER_FORM_ARCHIVE_VERSION_NOT_PUBLISHED",
        )
        self.collection.find_one_and_update.assert_not_called()

    async def test_published_form_accepts_active_version_id_when_archiving(
        self,
    ) -> None:
        updated = {**self.current, "status": {"code": "ARCHIVED"}}
        self.collection.find_one_and_update = AsyncMock(return_value=updated)

        with (
            patch(
                "app.services.master_forms.actor_object_id",
                return_value=ObjectId(),
            ),
            patch(
                "app.services.master_forms.get_master_forms_collection",
                return_value=self.collection,
            ),
            patch(
                "app.services.master_forms.load_value_set_references",
                new_callable=AsyncMock,
                return_value={},
            ),
            patch(
                "app.services.master_forms.reference_for",
                side_effect=lambda code, _set, _values: {"code": code},
            ),
        ):
            result = await update_master_form(
                str(self.form_id),
                MasterFormPatch(
                    status="ARCHIVED",
                    masterFormVersionId=str(self.active_version_id),
                ),
            )

        query, update = self.collection.find_one_and_update.await_args.args[:2]
        self.assertEqual(query["currentVersion"], 2)
        self.assertEqual(query["versions._id"], self.active_version_id)
        self.assertEqual(update["$set"]["status"], {"code": "ARCHIVED"})
        self.assertEqual(update["$set"]["versions.$[active].status"], "ARCHIVED")
        self.assertIn("lastPublishedSwitch", update["$unset"])
        self.assertIs(result, updated)


class FormDeletionLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def test_draft_form_can_be_soft_deleted(self) -> None:
        form_id = ObjectId()
        current = {
            "_id": form_id,
            "isDeleted": False,
            "status": {"code": "DRAFT"},
        }
        collection = Mock()
        collection.find_one_and_update = AsyncMock(return_value=current)

        with (
            patch("app.services.master_forms.actor_object_id", return_value=ObjectId()),
            patch(
                "app.services.master_forms.get_master_forms_collection",
                return_value=collection,
            ),
        ):
            result = await soft_delete_master_form(str(form_id))

        query = collection.find_one_and_update.await_args.args[0]
        self.assertNotIn("status.code", query)
        self.assertEqual(query, {"_id": form_id, "isDeleted": False})
        self.assertIs(result, current)

    async def test_published_form_can_be_soft_deleted(self) -> None:
        form_id = ObjectId()
        published = {
            "_id": form_id,
            "isDeleted": False,
            "status": {"code": "PUBLISHED"},
        }
        collection = Mock()
        collection.find_one_and_update = AsyncMock(return_value=published)

        with (
            patch("app.services.master_forms.actor_object_id", return_value=ObjectId()),
            patch(
                "app.services.master_forms.get_master_forms_collection",
                return_value=collection,
            ),
        ):
            result = await soft_delete_master_form(str(form_id))

        self.assertEqual(
            collection.find_one_and_update.await_args.args[0],
            {"_id": form_id, "isDeleted": False},
        )
        self.assertIs(result, published)


if __name__ == "__main__":
    unittest.main()
