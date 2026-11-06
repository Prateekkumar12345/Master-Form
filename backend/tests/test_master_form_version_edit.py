import unittest
from copy import deepcopy
from unittest.mock import AsyncMock, Mock, patch

from bson import ObjectId
from fastapi import HTTPException

from app.main import app
from app.schemas.master_form import MasterFormPatch
from app.services.master_forms import edit_master_form_version, update_master_form


def definition(
    version_id: ObjectId, title: str = "Updated assessment"
) -> MasterFormPatch:
    return MasterFormPatch(
        masterFormVersionId=str(version_id),
        title=title,
    )


class EditVersionRouteTests(unittest.TestCase):
    def test_saved_version_edit_uses_the_master_form_patch_route(self) -> None:
        paths = app.openapi()["paths"]
        operation = paths["/api/v1/master-forms/{masterFormId}"]["patch"]
        self.assertIn(
            "saved-version edits", operation["description"].lower()
        )
        self.assertNotIn(
            "/api/v1/master-forms/{masterFormId}/versions/"
            "{masterFormVersionId}/edit",
            paths,
        )

    def test_patch_route_documents_creating_a_version_from_published_form(self) -> None:
        operation = app.openapi()["paths"]["/api/v1/master-forms/{masterFormId}"]["patch"]
        self.assertIn("PUBLISHED form", operation["description"])
        self.assertIn("new inactive DRAFT version", operation["description"])


class EditVersionServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_patch_dispatches_saved_version_edit(self) -> None:
        form_id = ObjectId()
        version_id = ObjectId()
        active = {
            "_id": ObjectId(),
            "version": 1,
            "snapshot": {},
        }
        collection = Mock()
        collection.find_one = AsyncMock(
            return_value={
                "_id": form_id,
                "status": {"valueSetId": ObjectId(), "code": "DRAFT"},
                "currentVersion": 1,
                "versions": [active],
                "isDeleted": False,
            }
        )
        expected = {"_id": form_id, "currentVersion": 2}

        with (
            patch("app.services.master_forms.actor_object_id", return_value=ObjectId()),
            patch(
                "app.services.master_forms.get_master_forms_collection",
                return_value=collection,
            ),
            patch(
                "app.services.master_forms.edit_master_form_version",
                new_callable=AsyncMock,
                return_value=expected,
            ) as edit_saved_version,
        ):
            result = await update_master_form(
                str(form_id), definition(version_id)
            )

        self.assertIs(result, expected)
        edit_saved_version.assert_awaited_once_with(
            str(form_id), str(version_id), definition(version_id)
        )

    async def test_edit_creates_new_version_without_mutating_source_snapshot(self) -> None:
        form_id = ObjectId()
        version_id = ObjectId()
        original_snapshot = {
            "name": "Nutrition Assessment",
            "formType": {"valueSetId": ObjectId(), "code": "ASSESSMENT"},
            "title": "Original assessment",
            "layout": {"valueSetId": ObjectId(), "code": "SINGLE_PAGE"},
            "Buttons": [],
            "sections": [],
        }
        source_version = {
            "_id": version_id,
            "version": 2,
            "snapshot": deepcopy(original_snapshot),
        }
        current = {
            "_id": form_id,
            "status": {"valueSetId": ObjectId(), "code": "DRAFT"},
            "currentVersion": 2,
            "versions": [source_version],
            "isDeleted": False,
        }
        collection = Mock()
        collection.find_one = AsyncMock(return_value=current)
        updated_form = {**current, "currentVersion": 3}
        collection.find_one_and_update = AsyncMock(return_value=updated_form)

        with (
            patch("app.services.master_forms.actor_object_id", return_value=ObjectId()),
            patch(
                "app.services.master_forms.load_value_set_references",
                new_callable=AsyncMock,
                return_value={},
            ),
            patch(
                "app.services.master_forms.references_for_storage",
                side_effect=lambda document, _value_sets: document,
            ),
            patch(
                "app.services.master_forms.get_master_forms_collection",
                return_value=collection,
            ),
        ):
            result = await edit_master_form_version(
                str(form_id), str(version_id), definition(version_id)
            )

        update = collection.find_one_and_update.await_args.args[1]
        self.assertEqual(update["$set"]["title"], "Updated assessment")
        self.assertEqual(update["$set"]["currentVersion"], 3)
        self.assertEqual(update["$push"]["versions"]["version"], 3)
        self.assertEqual(source_version["snapshot"], original_snapshot)
        self.assertEqual(result["currentVersion"], 3)

    async def test_edit_rejects_a_published_form(self) -> None:
        form_id = ObjectId()
        version_id = ObjectId()
        collection = Mock()
        collection.find_one = AsyncMock(
            return_value={
                "_id": form_id,
                "status": {"valueSetId": ObjectId(), "code": "PUBLISHED"},
                "currentVersion": 1,
                "versions": [
                    {
                        "_id": version_id,
                        "version": 1,
                        "snapshot": {},
                    }
                ],
                "isDeleted": False,
            }
        )
        collection.find_one_and_update = AsyncMock()

        with (
            patch("app.services.master_forms.actor_object_id", return_value=ObjectId()),
            patch(
                "app.services.master_forms.get_master_forms_collection",
                return_value=collection,
            ),
        ):
            with self.assertRaises(HTTPException) as raised:
                await edit_master_form_version(
                    str(form_id), str(version_id), definition(version_id)
                )

        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(
            raised.exception.detail["code"], "PUBLISHED_MASTER_FORM_VERSION"
        )
        collection.find_one_and_update.assert_not_awaited()

    async def test_editing_saved_published_version_does_not_activate_it(self) -> None:
        form_id = ObjectId()
        version_id = ObjectId()
        current = {
            "_id": form_id,
            "status": {"valueSetId": ObjectId(), "code": "PUBLISHED"},
            "currentVersion": 2,
            "versions": [
                {
                    "_id": version_id,
                    "version": 1,
                    "snapshot": {
                        "name": "Nutrition Assessment",
                        "formType": {
                            "valueSetId": ObjectId(),
                            "code": "ASSESSMENT",
                        },
                        "title": "Original assessment",
                        "layout": {
                            "valueSetId": ObjectId(),
                            "code": "SINGLE_PAGE",
                        },
                        "Buttons": [],
                        "sections": [],
                    },
                },
                {"_id": ObjectId(), "version": 2, "snapshot": {}},
            ],
            "isDeleted": False,
        }
        collection = Mock()
        collection.find_one = AsyncMock(return_value=current)
        collection.find_one_and_update = AsyncMock(return_value=current)

        with (
            patch("app.services.master_forms.actor_object_id", return_value=ObjectId()),
            patch(
                "app.services.master_forms.load_value_set_references",
                new_callable=AsyncMock,
                return_value={},
            ),
            patch(
                "app.services.master_forms.references_for_storage",
                side_effect=lambda document, _value_sets: document,
            ),
            patch(
                "app.services.master_forms.get_master_forms_collection",
                return_value=collection,
            ),
        ):
            await edit_master_form_version(
                str(form_id), str(version_id), definition(version_id)
            )

        query, update = collection.find_one_and_update.await_args.args[:2]
        self.assertEqual(query["status.code"], "PUBLISHED")
        self.assertNotIn("currentVersion", update["$set"])
        self.assertNotIn("title", update["$set"])
        self.assertEqual(update["$push"]["versions"]["version"], 3)

    async def test_configuration_patch_creates_inactive_version_from_published_form(self) -> None:
        form_id = ObjectId()
        active_version_id = ObjectId()
        active_snapshot = {
            "name": "Nutrition Assessment",
            "description": None,
            "formType": {
                "valueSetId": ObjectId(),
                "code": "ASSESSMENT",
            },
            "title": "Published assessment",
            "layout": {
                "valueSetId": ObjectId(),
                "code": "SINGLE_PAGE",
            },
            "Buttons": [],
            "sections": [],
        }
        current = {
            "_id": form_id,
            **deepcopy(active_snapshot),
            "status": {"valueSetId": ObjectId(), "code": "PUBLISHED"},
            "currentVersion": 1,
            "versions": [
                {
                    "_id": active_version_id,
                    "version": 1,
                    "status": "PUBLISHED",
                    "snapshot": deepcopy(active_snapshot),
                }
            ],
            "isDeleted": False,
        }
        updated = {
            **current,
            "versions": [
                *current["versions"],
                {"version": 2, "status": "DRAFT", "snapshot": {}},
            ],
        }
        collection = Mock()
        collection.find_one = AsyncMock(side_effect=[current, updated])
        collection.update_one = AsyncMock(
            return_value=Mock(modified_count=1)
        )

        with (
            patch("app.services.master_forms.actor_object_id", return_value=ObjectId()),
            patch(
                "app.services.master_forms.load_value_set_references",
                new_callable=AsyncMock,
                return_value={},
            ),
            patch(
                "app.services.master_forms.references_for_storage",
                side_effect=lambda document, _value_sets: document,
            ),
            patch(
                "app.services.master_forms.get_master_forms_collection",
                return_value=collection,
            ),
        ):
            result = await update_master_form(
                str(form_id), MasterFormPatch(title="New draft version")
            )

        query, update = collection.update_one.await_args.args[:2]
        self.assertEqual(query["status.code"], "PUBLISHED")
        self.assertEqual(query["currentVersion"], 1)
        self.assertNotIn("title", update["$set"])
        self.assertNotIn("currentVersion", update["$set"])
        self.assertEqual(update["$push"]["versions"]["version"], 2)
        self.assertEqual(update["$push"]["versions"]["status"], "DRAFT")
        self.assertEqual(
            update["$push"]["versions"]["snapshot"]["title"],
            "New draft version",
        )
        self.assertEqual(result["currentVersion"], 1)
        self.assertEqual(result["title"], "Published assessment")


if __name__ == "__main__":
    unittest.main()
