from datetime import UTC, datetime
import unittest
from unittest.mock import AsyncMock, Mock, patch

from bson import ObjectId
from fastapi import HTTPException

from app.main import app
from app.services.master_forms import (
    delete_master_form_version,
    find_version,
    get_master_form_versions,
    move_master_form_version_to_draft,
    require_active_version,
    require_version,
    restore_master_form_version,
    switch_master_form_version,
    version_object_id,
)

BASE = "/api/v1/master-forms/{masterFormId}/versions/{masterFormVersionId}"


def status_reference(code: str) -> dict:
    return {"valueSetId": ObjectId(), "code": code}


class VersionRouteTests(unittest.TestCase):
    def test_version_routes_are_exposed(self) -> None:
        paths = app.openapi()["paths"]
        expected = [
            (
                "/api/v1/master-forms/{masterFormId}/versions",
                "get",
                "Get master form versions",
            ),
            (
                BASE,
                "patch",
                "Update a saved master form version lifecycle status",
            ),
            (BASE, "delete", "Delete a master form version"),
            (f"{BASE}/restore", "post", "Restore a deleted master form version"),
        ]

        for path, method, summary in expected:
            self.assertIn(path, paths)
            self.assertIn(method, paths[path])
            operation = paths[path][method]
            self.assertEqual(operation["summary"], summary)
            self.assertEqual(operation["tags"], ["master-forms"])

        params = {
            parameter["name"]
            for parameter in paths[BASE]["patch"]["parameters"]
        }
        self.assertEqual(params, {"masterFormId", "masterFormVersionId"})
        self.assertIn("requestBody", paths[BASE]["patch"])
        self.assertNotIn(f"{BASE}/activate", paths)
        self.assertNotIn(f"{BASE}/archive", paths)
        self.assertNotIn(f"{BASE}/draft", paths)
        history_params = {
            parameter["name"]
            for parameter in paths[
                "/api/v1/master-forms/{masterFormId}/versions"
            ]["get"]["parameters"]
        }
        self.assertIn("includeDeleted", history_params)

    def test_version_by_id_get_route_is_merged(self) -> None:
        paths = app.openapi()["paths"]
        self.assertNotIn("get", paths[BASE])

        operation = paths["/api/v1/master-forms/{masterFormId}/versions"]["get"]
        params = {parameter["name"]: parameter for parameter in operation["parameters"]}
        self.assertIn("masterFormVersionId", params)
        self.assertFalse(params["masterFormVersionId"].get("required", False))
        self.assertIn("version", params)
        self.assertIn("400", operation["responses"])
        self.assertIn("404", operation["responses"])
        self.assertIn("422", operation["responses"])

    def test_delete_and_version_lifecycle_document_their_conflicts(self) -> None:
        paths = app.openapi()["paths"]
        self.assertIn("409", paths[BASE]["delete"]["responses"])
        self.assertIn("409", paths[f"{BASE}/restore"]["post"]["responses"])
        self.assertIn("409", paths[BASE]["patch"]["responses"])
        self.assertIn("422", paths[BASE]["patch"]["responses"])
        self.assertNotIn(f"{BASE}/edit", paths)


class VersionLookupTests(unittest.TestCase):
    def setUp(self) -> None:
        self.version_id = ObjectId()
        self.document = {
            "versions": [
                {"_id": ObjectId(), "version": 1},
                {"_id": self.version_id, "version": 2},
            ]
        }

    def test_find_version_returns_matching_snapshot(self) -> None:
        entry = find_version(self.document, self.version_id)
        self.assertIsNotNone(entry)
        self.assertEqual(entry["version"], 2)

    def test_find_version_returns_none_for_unknown_id(self) -> None:
        self.assertIsNone(find_version(self.document, ObjectId()))

    def test_require_version_raises_not_found(self) -> None:
        with self.assertRaises(HTTPException) as raised:
            require_version(self.document, ObjectId())
        self.assertEqual(raised.exception.status_code, 404)
        self.assertEqual(
            raised.exception.detail["code"], "MASTER_FORM_VERSION_NOT_FOUND"
        )

    def test_version_object_id_rejects_invalid_values(self) -> None:
        with self.assertRaises(HTTPException) as raised:
            version_object_id("not-an-object-id")
        self.assertEqual(raised.exception.status_code, 400)
        self.assertEqual(raised.exception.detail["code"], "INVALID_REQUEST")


class PublishedVersionSwitchTests(unittest.IsolatedAsyncioTestCase):
    async def test_switching_published_form_promotes_selected_version(self) -> None:
        form_id = ObjectId()
        current_version_id = ObjectId()
        selected_version_id = ObjectId()
        selected_snapshot = {
            "name": "Nutrition Assessment",
            "formType": "ASSESSMENT",
            "title": "Draft title",
            "layout": "SINGLE_PAGE",
            "Buttons": [],
            "sections": [],
        }
        current = {
            "_id": form_id,
            "status": {"code": "PUBLISHED"},
            "currentVersion": 2,
            "versions": [
                {
                    "_id": selected_version_id,
                    "version": 1,
                    "snapshot": selected_snapshot,
                },
                {
                    "_id": current_version_id,
                    "version": 2,
                    "snapshot": {**selected_snapshot, "title": "Published title"},
                },
            ],
        }
        collection = Mock()
        collection.find_one = AsyncMock(return_value=current)
        collection.find_one_and_update = AsyncMock()
        updated = {
            **current,
            **selected_snapshot,
            "currentVersion": 1,
            "status": {"code": "PUBLISHED"},
        }
        collection.find_one_and_update.return_value = updated

        with (
            patch("app.services.master_forms.actor_object_id", return_value=ObjectId()),
            patch(
                "app.services.master_forms.get_master_forms_collection",
                return_value=collection,
            ),
            patch(
                "app.services.master_forms.load_value_set_references",
                new_callable=AsyncMock,
                return_value={},
            ),
            patch(
                "app.services.master_forms.references_for_storage",
                side_effect=lambda document, _values: document,
            ),
        ):
            result = await switch_master_form_version(
                str(form_id), str(selected_version_id)
            )

        query, update = collection.find_one_and_update.await_args.args[:2]
        self.assertEqual(query["currentVersion"], 2)
        self.assertEqual(update["$set"]["currentVersion"], 1)
        self.assertNotIn("status", update["$set"])
        self.assertEqual(
            update["$set"]["lastPublishedSwitch"],
            {
                "fromVersionId": current_version_id,
                "toVersionId": selected_version_id,
            },
        )
        self.assertEqual(result["status"], {"code": "PUBLISHED"})
        self.assertEqual(result["title"], "Draft title")

    async def test_publishing_saved_version_on_draft_form_publishes_form(self) -> None:
        form_id = ObjectId()
        selected_version_id = ObjectId()
        current_version_id = ObjectId()
        selected_snapshot = {
            "name": "Nutrition Assessment",
            "formType": "ASSESSMENT",
            "title": "Selected draft",
            "layout": "SINGLE_PAGE",
            "Buttons": [],
            "sections": [],
        }
        current = {
            "_id": form_id,
            "status": {"code": "DRAFT"},
            "currentVersion": 2,
            "versions": [
                {
                    "_id": selected_version_id,
                    "version": 1,
                    "status": "DRAFT",
                    "snapshot": selected_snapshot,
                },
                {
                    "_id": current_version_id,
                    "version": 2,
                    "status": "DRAFT",
                    "snapshot": {**selected_snapshot, "title": "Current draft"},
                },
            ],
        }
        collection = Mock()
        collection.find_one = AsyncMock(return_value=current)
        collection.find_one_and_update = AsyncMock(
            return_value={
                **current,
                **selected_snapshot,
                "status": {"code": "PUBLISHED"},
                "currentVersion": 1,
            }
        )

        with (
            patch("app.services.master_forms.actor_object_id", return_value=ObjectId()),
            patch(
                "app.services.master_forms.get_master_forms_collection",
                return_value=collection,
            ),
            patch(
                "app.services.master_forms.load_value_set_references",
                new_callable=AsyncMock,
                return_value={},
            ),
            patch(
                "app.services.master_forms.references_for_storage",
                side_effect=lambda document, _values: document,
            ),
            patch(
                "app.services.master_forms.reference_for",
                side_effect=lambda code, _set, _values: {"code": code},
            ),
        ):
            result = await switch_master_form_version(
                str(form_id), str(selected_version_id)
            )

        query, update = collection.find_one_and_update.await_args.args[:2]
        self.assertEqual(query["status.code"], "DRAFT")
        self.assertEqual(query["currentVersion"], 2)
        self.assertEqual(update["$set"]["status"], {"code": "PUBLISHED"})
        self.assertEqual(update["$set"]["currentVersion"], 1)
        self.assertEqual(update["$set"]["versions.$[previous].status"], "DRAFT")
        self.assertEqual(update["$set"]["versions.$[selected].status"], "PUBLISHED")
        self.assertEqual(result["status"], {"code": "PUBLISHED"})

    async def test_publishing_saved_version_on_archived_form_publishes_form(self) -> None:
        form_id = ObjectId()
        selected_version_id = ObjectId()
        current_version_id = ObjectId()
        selected_snapshot = {
            "name": "Nutrition Assessment",
            "formType": "ASSESSMENT",
            "title": "Selected draft",
            "layout": "SINGLE_PAGE",
            "Buttons": [],
            "sections": [],
        }
        current = {
            "_id": form_id,
            "status": {"code": "ARCHIVED"},
            "currentVersion": 2,
            "versions": [
                {
                    "_id": selected_version_id,
                    "version": 1,
                    "status": "DRAFT",
                    "snapshot": selected_snapshot,
                },
                {
                    "_id": current_version_id,
                    "version": 2,
                    "status": "ARCHIVED",
                    "snapshot": {**selected_snapshot, "title": "Archived title"},
                },
            ],
        }
        collection = Mock()
        collection.find_one = AsyncMock(return_value=current)
        collection.find_one_and_update = AsyncMock(
            return_value={
                **current,
                **selected_snapshot,
                "status": {"code": "PUBLISHED"},
                "currentVersion": 1,
            }
        )

        with (
            patch("app.services.master_forms.actor_object_id", return_value=ObjectId()),
            patch(
                "app.services.master_forms.get_master_forms_collection",
                return_value=collection,
            ),
            patch(
                "app.services.master_forms.load_value_set_references",
                new_callable=AsyncMock,
                return_value={},
            ),
            patch(
                "app.services.master_forms.references_for_storage",
                side_effect=lambda document, _values: document,
            ),
            patch(
                "app.services.master_forms.reference_for",
                side_effect=lambda code, _set, _values: {"code": code},
            ),
        ):
            result = await switch_master_form_version(
                str(form_id), str(selected_version_id)
            )

        query, update = collection.find_one_and_update.await_args.args[:2]
        self.assertEqual(query["status.code"], "ARCHIVED")
        self.assertEqual(query["currentVersion"], 2)
        self.assertEqual(update["$set"]["status"], {"code": "PUBLISHED"})
        self.assertEqual(update["$set"]["currentVersion"], 1)
        self.assertEqual(update["$set"]["versions.$[previous].status"], "DRAFT")
        self.assertEqual(update["$set"]["versions.$[selected].status"], "PUBLISHED")
        self.assertEqual(update["$unset"], {"lastPublishedSwitch": ""})
        self.assertEqual(result["status"], {"code": "PUBLISHED"})


class ActiveVersionInvariantTests(unittest.TestCase):
    def test_requires_exactly_one_active_version(self) -> None:
        active = {"_id": ObjectId(), "version": 2}
        document = {
            "currentVersion": 2,
            "versions": [
                {"_id": ObjectId(), "version": 1},
                active,
                {"_id": ObjectId(), "version": 3},
            ],
        }

        self.assertIs(require_active_version(document), active)

    def test_rejects_missing_or_ambiguous_active_version(self) -> None:
        invalid_documents = [
            {"currentVersion": 2, "versions": []},
            {"currentVersion": 2, "versions": [{"version": 1}]},
            {
                "currentVersion": 2,
                "versions": [{"version": 2}, {"version": 2}],
            },
            {
                "currentVersion": 2,
                "versions": [{"version": 1}, {"version": "2"}],
            },
            {"currentVersion": True, "versions": [{"version": 1}]},
        ]

        for document in invalid_documents:
            with self.subTest(document=document):
                with self.assertRaises(HTTPException) as raised:
                    require_active_version(document)
                self.assertEqual(raised.exception.status_code, 409)
                self.assertEqual(
                    raised.exception.detail["code"],
                    "MASTER_FORM_ACTIVE_VERSION_REQUIRED",
                )

    def test_rejects_deleted_active_version(self) -> None:
        with self.assertRaises(HTTPException) as raised:
            require_active_version(
                {
                    "currentVersion": 1,
                    "versions": [{"version": 1, "isDeleted": True}],
                }
            )
        self.assertEqual(raised.exception.status_code, 409)


class VersionDeletionTests(unittest.IsolatedAsyncioTestCase):
    async def test_history_hides_deleted_versions_by_default(self) -> None:
        form_id = ObjectId()
        active = {"_id": ObjectId(), "version": 2}
        deleted = {"_id": ObjectId(), "version": 1, "isDeleted": True}
        collection = Mock()
        collection.find_one = AsyncMock(
            return_value={
                "_id": form_id,
                "currentVersion": 2,
                "versions": [deleted, active],
            }
        )

        with patch(
            "app.services.master_forms.get_master_forms_collection",
            return_value=collection,
        ):
            visible, _ = await get_master_form_versions(
                str(form_id),
                master_form_version_id=None,
                include_deleted=False,
                version=None,
                sort_order="desc",
                page=1,
                limit=100,
            )
            all_versions, _ = await get_master_form_versions(
                str(form_id),
                master_form_version_id=None,
                include_deleted=True,
                version=None,
                sort_order="desc",
                page=1,
                limit=100,
            )

        self.assertEqual(visible, [active])
        self.assertEqual(all_versions, [active, deleted])

    async def test_history_is_readable_for_a_soft_deleted_form(self) -> None:
        form_id = ObjectId()
        active = {"_id": ObjectId(), "version": 1}
        deleted = {"_id": ObjectId(), "version": 2, "isDeleted": True}
        collection = Mock()
        collection.find_one = AsyncMock(
            return_value={
                "_id": form_id,
                "isDeleted": True,
                "currentVersion": 1,
                "versions": [deleted, active],
            }
        )

        with patch(
            "app.services.master_forms.get_master_forms_collection",
            return_value=collection,
        ):
            versions, _ = await get_master_form_versions(
                str(form_id),
                master_form_version_id=None,
                include_deleted=False,
                version=None,
                sort_order="desc",
                page=1,
                limit=100,
            )

        # Deleting a form must not hide its saved history.
        self.assertEqual(versions, [active])
        query = collection.find_one.await_args.args[0]
        self.assertNotIn("isDeleted", query)

    async def test_delete_is_soft_and_never_targets_active_version(self) -> None:
        form_id = ObjectId()
        historical_id = ObjectId()
        active_id = ObjectId()
        current = {
            "_id": form_id,
            "status": status_reference("PUBLISHED"),
            "currentVersion": 2,
            "versions": [
                {
                    "_id": historical_id,
                    "version": 1,
                    "status": "ARCHIVED",
                    "snapshot": {"title": "Saved"},
                },
                {"_id": active_id, "version": 2, "snapshot": {"title": "Active"}},
            ],
        }
        collection = Mock()
        collection.find_one = AsyncMock(return_value=current)
        collection.update_one = AsyncMock(
            return_value=Mock(modified_count=1)
        )

        with (
            patch(
                "app.services.master_forms.get_master_forms_collection",
                return_value=collection,
            ),
            patch(
                "app.services.master_forms.actor_object_id",
                return_value=ObjectId(),
            ),
        ):
            result = await delete_master_form_version(
                str(form_id), str(historical_id)
            )
            with self.assertRaises(HTTPException) as raised:
                await delete_master_form_version(str(form_id), str(active_id))

        self.assertIs(result, current)
        collection.update_one.assert_awaited_once()
        update = collection.update_one.await_args.args[1]
        query = collection.update_one.await_args.args[0]
        self.assertEqual(update["$set"]["versions.$.isDeleted"], True)
        self.assertNotIn("status.code", query)
        self.assertEqual(current["versions"][0]["snapshot"], {"title": "Saved"})
        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(
            raised.exception.detail["code"], "MASTER_FORM_VERSION_IS_CURRENT"
        )

    async def test_delete_active_version_falls_back_to_highest_remaining(self) -> None:
        form_id = ObjectId()
        previous_id = ObjectId()
        active_id = ObjectId()
        current = {
            "_id": form_id,
            "isDeleted": False,
            "status": status_reference("ARCHIVED"),
            "currentVersion": 2,
            "versions": [
                {
                    "_id": previous_id,
                    "version": 1,
                    "status": "DRAFT",
                    "snapshot": {"name": "Previous", "title": "Previous"},
                },
                {
                    "_id": active_id,
                    "version": 2,
                    "status": "ARCHIVED",
                    "snapshot": {"name": "Active", "title": "Active"},
                },
            ],
        }
        updated = {**current, "currentVersion": 1}
        collection = Mock()
        collection.find_one = AsyncMock(return_value=current)
        collection.find_one_and_update = AsyncMock(return_value=updated)

        with (
            patch(
                "app.services.master_forms.get_master_forms_collection",
                return_value=collection,
            ),
            patch(
                "app.services.master_forms.actor_object_id",
                return_value=ObjectId(),
            ),
        ):
            result = await delete_master_form_version(str(form_id), str(active_id))

        self.assertIs(result, updated)
        query, update = collection.find_one_and_update.await_args.args[:2]
        self.assertEqual(query["currentVersion"], 2)
        self.assertEqual(update["$set"]["currentVersion"], 1)
        self.assertEqual(update["$set"]["name"], "Previous")
        self.assertEqual(update["$set"]["title"], "Previous")
        self.assertEqual(update["$set"]["versions.$[target].isDeleted"], True)
        self.assertNotIn("versions.$.isDeleted", update["$set"])

    async def test_delete_rejects_the_only_saved_version(self) -> None:
        form_id = ObjectId()
        active_id = ObjectId()
        current = {
            "_id": form_id,
            "isDeleted": False,
            "status": status_reference("ARCHIVED"),
            "currentVersion": 1,
            "versions": [
                {
                    "_id": active_id,
                    "version": 1,
                    "status": "ARCHIVED",
                    "snapshot": {"name": "Only", "title": "Only"},
                }
            ],
        }
        collection = Mock()
        collection.find_one = AsyncMock(return_value=current)
        collection.find_one_and_update = AsyncMock()

        with (
            patch(
                "app.services.master_forms.get_master_forms_collection",
                return_value=collection,
            ),
            patch(
                "app.services.master_forms.actor_object_id",
                return_value=ObjectId(),
            ),
        ):
            with self.assertRaises(HTTPException) as raised:
                await delete_master_form_version(str(form_id), str(active_id))

        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(raised.exception.detail["code"], "MASTER_FORM_LAST_VERSION")
        collection.find_one_and_update.assert_not_awaited()

    async def test_version_delete_does_not_delete_the_form(self) -> None:
        form_id = ObjectId()
        historical_id = ObjectId()
        current = {
            "_id": form_id,
            "isDeleted": False,
            "status": status_reference("ARCHIVED"),
            "currentVersion": 2,
            "versions": [
                {"_id": historical_id, "version": 1, "status": "ARCHIVED"},
                {"_id": ObjectId(), "version": 2, "status": "ARCHIVED"},
            ],
        }
        collection = Mock()
        collection.find_one = AsyncMock(return_value=current)
        collection.update_one = AsyncMock(return_value=Mock(modified_count=1))

        with (
            patch(
                "app.services.master_forms.get_master_forms_collection",
                return_value=collection,
            ),
            patch(
                "app.services.master_forms.actor_object_id",
                return_value=ObjectId(),
            ),
        ):
            await delete_master_form_version(str(form_id), str(historical_id))

        query, update = collection.update_one.await_args.args[:2]
        # The form document itself must stay in the library: only the selected
        # version entry is flagged, never the master-form isDeleted flag.
        self.assertIs(query["isDeleted"], False)
        self.assertNotIn("isDeleted", update["$set"])
        self.assertNotIn("deletedAt", update["$set"])
        self.assertEqual(update["$set"]["versions.$.isDeleted"], True)
        self.assertFalse(current["isDeleted"])

    async def test_delete_rejects_unarchived_historical_version(self) -> None:
        form_id = ObjectId()
        historical_id = ObjectId()
        current = {
            "_id": form_id,
            "currentVersion": 2,
            "versions": [
                {"_id": historical_id, "version": 1, "status": "DRAFT"},
                {"_id": ObjectId(), "version": 2, "status": "PUBLISHED"},
            ],
        }
        collection = Mock()
        collection.find_one = AsyncMock(return_value=current)
        collection.update_one = AsyncMock()

        with (
            patch(
                "app.services.master_forms.get_master_forms_collection",
                return_value=collection,
            ),
            patch(
                "app.services.master_forms.actor_object_id",
                return_value=ObjectId(),
            ),
        ):
            with self.assertRaises(HTTPException) as raised:
                await delete_master_form_version(str(form_id), str(historical_id))

        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(
            raised.exception.detail["code"],
            "MASTER_FORM_VERSION_NOT_ARCHIVED",
        )
        collection.update_one.assert_not_awaited()

    async def test_archive_version_does_not_change_master_form_status(self) -> None:
        from app.services.master_forms import archive_master_form_version

        form_id = ObjectId()
        version_id = ObjectId()
        current = {
            "_id": form_id,
            "status": status_reference("PUBLISHED"),
            "currentVersion": 2,
            "versions": [
                {"_id": version_id, "version": 1, "status": "DRAFT"},
                {"_id": ObjectId(), "version": 2, "status": "PUBLISHED"},
            ],
        }
        collection = Mock()
        collection.find_one = AsyncMock(side_effect=[current, current])
        collection.update_one = AsyncMock(return_value=Mock(modified_count=1))

        with (
            patch(
                "app.services.master_forms.get_master_forms_collection",
                return_value=collection,
            ),
            patch(
                "app.services.master_forms.actor_object_id",
                return_value=ObjectId(),
            ),
        ):
            result = await archive_master_form_version(
                str(form_id), str(version_id)
            )

        self.assertIs(result, current)
        query, update = collection.update_one.await_args.args[:2]
        self.assertEqual(query["currentVersion"], 2)
        self.assertEqual(update["$set"]["versions.$.status"], "ARCHIVED")
        self.assertNotIn("status.code", update["$set"])
        self.assertEqual(current["status"]["code"], "PUBLISHED")

    async def test_move_archived_version_to_draft_does_not_change_form_status(self) -> None:
        form_id = ObjectId()
        version_id = ObjectId()
        current = {
            "_id": form_id,
            "status": status_reference("PUBLISHED"),
            "currentVersion": 2,
            "versions": [
                {
                    "_id": version_id,
                    "version": 1,
                    "status": "ARCHIVED",
                    "archivedAt": datetime.now(UTC),
                    "archivedBy": ObjectId(),
                },
                {"_id": ObjectId(), "version": 2, "status": "PUBLISHED"},
            ],
        }
        collection = Mock()
        collection.find_one = AsyncMock(side_effect=[current, current])
        collection.update_one = AsyncMock(return_value=Mock(modified_count=1))

        with (
            patch(
                "app.services.master_forms.get_master_forms_collection",
                return_value=collection,
            ),
            patch(
                "app.services.master_forms.actor_object_id",
                return_value=ObjectId(),
            ),
        ):
            result = await move_master_form_version_to_draft(
                str(form_id), str(version_id)
            )

        self.assertIs(result, current)
        query, update = collection.update_one.await_args.args[:2]
        self.assertEqual(query["currentVersion"], 2)
        self.assertEqual(update["$set"]["versions.$.status"], "DRAFT")
        self.assertIn("versions.$.archivedAt", update["$unset"])
        self.assertIn("versions.$.archivedBy", update["$unset"])
        self.assertNotIn("status.code", update["$set"])
        self.assertEqual(current["status"]["code"], "PUBLISHED")

    async def test_move_to_draft_rejects_non_archived_version(self) -> None:
        form_id = ObjectId()
        version_id = ObjectId()
        current = {
            "_id": form_id,
            "currentVersion": 2,
            "versions": [
                {"_id": version_id, "version": 1, "status": "DRAFT"},
                {"_id": ObjectId(), "version": 2, "status": "PUBLISHED"},
            ],
        }
        collection = Mock()
        collection.find_one = AsyncMock(return_value=current)
        collection.update_one = AsyncMock()

        with patch(
            "app.services.master_forms.get_master_forms_collection",
            return_value=collection,
        ):
            with self.assertRaises(HTTPException) as raised:
                await move_master_form_version_to_draft(
                    str(form_id), str(version_id)
                )

        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(
            raised.exception.detail["code"],
            "MASTER_FORM_VERSION_NOT_ARCHIVED",
        )
        collection.update_one.assert_not_awaited()

    async def test_restore_clears_deleted_state_without_changing_active_version(self) -> None:
        form_id = ObjectId()
        deleted_id = ObjectId()
        active_id = ObjectId()
        current = {
            "_id": form_id,
            "status": status_reference("PUBLISHED"),
            "currentVersion": 2,
            "versions": [
                {
                    "_id": deleted_id,
                    "version": 1,
                    "isDeleted": True,
                    "snapshot": {"title": "Saved"},
                },
                {"_id": active_id, "version": 2, "snapshot": {"title": "Active"}},
            ],
        }
        collection = Mock()
        collection.find_one = AsyncMock(side_effect=[current, current])
        collection.update_one = AsyncMock(
            return_value=Mock(modified_count=1)
        )

        with (
            patch(
                "app.services.master_forms.get_master_forms_collection",
                return_value=collection,
            ),
            patch(
                "app.services.master_forms.actor_object_id",
                return_value=ObjectId(),
            ),
        ):
            result = await restore_master_form_version(
                str(form_id), str(deleted_id)
            )

        self.assertIs(result, current)
        query = collection.update_one.await_args.args[0]
        update = collection.update_one.await_args.args[1]
        self.assertNotIn("status.code", query)
        self.assertEqual(update["$set"]["versions.$.isDeleted"], False)
        self.assertIn("versions.$.deletedAt", update["$unset"])
        self.assertEqual(current["currentVersion"], 2)


if __name__ == "__main__":
    unittest.main()
