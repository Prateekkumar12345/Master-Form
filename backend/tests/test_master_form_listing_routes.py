import re
import unittest

from bson import ObjectId
from fastapi import HTTPException

from app.main import app
from app.services.master_forms import build_get_query, build_list_query


class ListRouteTests(unittest.TestCase):
    def test_list_route_exposes_deletion_filters(self) -> None:
        operation = app.openapi()["paths"]["/api/v1/master-forms"]["get"]
        params = {parameter["name"]: parameter for parameter in operation["parameters"]}
        self.assertIn("isDeleted", params)
        self.assertIn("includeDeleted", params)
        self.assertFalse(params["isDeleted"].get("required", False))
        self.assertFalse(params["includeDeleted"].get("required", False))

    def test_get_route_exposes_include_deleted(self) -> None:
        operation = app.openapi()["paths"][
            "/api/v1/master-forms/{masterFormId}"
        ]["get"]
        params = {parameter["name"] for parameter in operation["parameters"]}
        self.assertIn("includeDeleted", params)

    def test_separate_listing_routes_are_removed(self) -> None:
        paths = app.openapi()["paths"]
        self.assertNotIn("/api/v1/master-forms/published", paths)
        self.assertNotIn("/api/v1/master-forms/archived", paths)
        self.assertNotIn("/api/v1/master-forms/deleted", paths)


class ListingQueryTests(unittest.TestCase):
    def build(self, **overrides):
        values = {
            "organization_id": None,
            "form_code": None,
            "form_type": None,
            "status": None,
            "name": None,
            "is_deleted": False,
            "include_deleted": False,
        }
        values.update(overrides)
        return build_list_query(**values)

    def test_default_list_excludes_soft_deleted_forms(self) -> None:
        self.assertEqual(self.build(), {"isDeleted": False})

    def test_is_deleted_true_returns_only_soft_deleted_forms(self) -> None:
        self.assertEqual(self.build(is_deleted=True), {"isDeleted": True})

    def test_include_deleted_removes_the_deletion_constraint(self) -> None:
        self.assertEqual(self.build(include_deleted=True), {})
        self.assertEqual(self.build(include_deleted=True, is_deleted=True), {})

    def test_status_and_type_filters_use_value_set_codes(self) -> None:
        query = self.build(form_type="ASSESSMENT", status="PUBLISHED")
        self.assertEqual(query["formType.code"], "ASSESSMENT")
        self.assertEqual(query["status.code"], "PUBLISHED")

    def test_name_filter_is_escaped_and_case_insensitive(self) -> None:
        query = self.build(name="a.b")
        self.assertEqual(
            query["name"], {"$regex": re.escape("a.b"), "$options": "i"}
        )

    def test_invalid_organization_id_is_rejected(self) -> None:
        with self.assertRaises(HTTPException) as raised:
            self.build(organization_id="not-an-object-id")
        self.assertEqual(raised.exception.status_code, 400)
        self.assertEqual(raised.exception.detail["code"], "INVALID_REQUEST")


class GetQueryTests(unittest.TestCase):
    def test_default_get_excludes_soft_deleted_forms(self) -> None:
        form_id = ObjectId()
        self.assertEqual(
            build_get_query(form_id, False),
            {"_id": form_id, "isDeleted": False},
        )

    def test_include_deleted_omits_the_deletion_constraint(self) -> None:
        form_id = ObjectId()
        self.assertEqual(build_get_query(form_id, True), {"_id": form_id})


if __name__ == "__main__":
    unittest.main()
