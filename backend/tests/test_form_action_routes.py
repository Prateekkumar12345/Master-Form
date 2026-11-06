import asyncio
import unittest

from fastapi import HTTPException

from app.api.v1.endpoints.form_actions import login
from app.main import app
from app.schemas.form_actions import LoginPayload


class FormActionRouteTests(unittest.TestCase):
    def test_form_action_routes_are_exposed(self) -> None:
        paths = app.openapi()["paths"]
        expected = {
            "/api/v1/assessments/submit": (
                "ASSESSMENT",
                "ASSESSMENT - Submit assessment",
            ),
            "/api/v1/clients": (
                "REGISTRATION",
                "REGISTRATION - Register client",
            ),
            "/api/v1/diet-plans/generate": (
                "DIET_PLAN",
                "DIET_PLAN - Request diet-plan generation",
            ),
            "/api/v1/auth/login": (
                "LOGIN",
                "LOGIN - Authenticate (not configured)",
            ),
        }

        for path, (tag, summary) in expected.items():
            with self.subTest(path=path):
                self.assertIn(path, paths)
                self.assertEqual(paths[path]["post"]["tags"], [tag])
                self.assertEqual(paths[path]["post"]["summary"], summary)

    def test_login_route_reports_authentication_not_configured(self) -> None:
        payload = LoginPayload(
            email="asha@example.com",
            password="ExamplePassword123!",
        )
        with self.assertRaises(HTTPException) as raised:
            asyncio.run(login(payload))

        self.assertEqual(raised.exception.status_code, 501)
        self.assertEqual(
            raised.exception.detail["code"],
            "AUTHENTICATION_NOT_CONFIGURED",
        )


if __name__ == "__main__":
    unittest.main()
