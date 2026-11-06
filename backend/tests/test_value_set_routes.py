import unittest

from app.main import app


class ValueSetRouteTests(unittest.TestCase):
    def test_value_set_routes_are_removed(self) -> None:
        paths = app.openapi()["paths"]
        self.assertNotIn("/api/v1/value-sets", paths)
        self.assertNotIn("/api/v1/value-sets/{valueSetId}", paths)

    def test_value_set_tag_is_absent(self) -> None:
        tags = {
            tag
            for path_item in app.openapi()["paths"].values()
            for operation in path_item.values()
            if isinstance(operation, dict)
            for tag in operation.get("tags", [])
        }
        self.assertNotIn("value-sets", tags)


if __name__ == "__main__":
    unittest.main()
