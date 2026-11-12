import unittest

from app.main import app
from app.schemas.master_form import FormDefinition
from scripts.seed_sample_forms import (
    FAILURE_KEYHOLDER,
    SAMPLE_FORMS,
    SUCCESS_KEYHOLDER,
    sample_payloads,
)

EXPECTED = {
    "DEMO_CLIENT_REGISTRATION": {
        "name": "Sample Client Registration",
        "form_type": "REGISTRATION",
        "endpoint": "/api/v1/clients",
        "success_status": 201,
        "field_count": 5,
    },
    "DEMO_NUTRITION_ASSESSMENT": {
        "name": "Sample Nutrition Assessment",
        "form_type": "ASSESSMENT",
        "endpoint": "/api/v1/assessments/submit",
        "success_status": 201,
        "field_count": 2,
    },
    "DEMO_DIET_PLAN_REQUEST": {
        "name": "Sample Diet Plan Request",
        "form_type": "DIET_PLAN",
        "endpoint": "/api/v1/diet-plans/generate",
        "success_status": 202,
        "field_count": 5,
    },
}


class SampleFormSeedTests(unittest.TestCase):
    def test_every_sample_validates(self) -> None:
        payloads = sample_payloads()
        self.assertEqual(len(payloads), len(EXPECTED))
        self.assertEqual(
            {payload.formCode for payload in payloads}, set(EXPECTED)
        )

    def test_samples_match_expected_metadata(self) -> None:
        for payload in sample_payloads():
            expected = EXPECTED[payload.formCode]
            with self.subTest(formCode=payload.formCode):
                self.assertEqual(payload.name, expected["name"])
                self.assertEqual(payload.formType, expected["form_type"])
                self.assertEqual(payload.organizationId, None)
                self.assertEqual(len(payload.Buttons), 1)
                button = payload.Buttons[0]
                self.assertEqual(button.executionType, "API")
                self.assertEqual(button.request.endpoint, expected["endpoint"])
                self.assertEqual(button.request.httpMethod, "POST")
                self.assertEqual(
                    button.responseHandling.successStatusCodes,
                    [expected["success_status"]],
                )
                field_count = sum(
                    len(section.fields) for section in payload.sections
                )
                self.assertEqual(field_count, expected["field_count"])

    def test_button_endpoint_matches_sample_metadata(self) -> None:
        for sample in SAMPLE_FORMS:
            expected = EXPECTED[sample["formCode"]]
            button = sample["Buttons"][0]
            with self.subTest(formCode=sample["formCode"]):
                self.assertEqual(
                    button["request"]["endpoint"], expected["endpoint"]
                )

    def test_response_keyholders_read_the_envelope(self) -> None:
        for payload in sample_payloads():
            button = payload.Buttons[0]
            with self.subTest(formCode=payload.formCode):
                self.assertEqual(
                    button.responseHandling.onSuccess.responseMessage,
                    SUCCESS_KEYHOLDER,
                )
                self.assertEqual(
                    button.responseHandling.onFailure.responseMessage,
                    FAILURE_KEYHOLDER,
                )
        self.assertEqual(SUCCESS_KEYHOLDER, "message")
        self.assertEqual(FAILURE_KEYHOLDER, "error.message")

    def test_payload_mapping_targets_action_schema_fields(self) -> None:
        # Every payload mapping must point at a field the endpoint accepts.
        expected_targets = {
            "DEMO_CLIENT_REGISTRATION": {
                "firstName",
                "lastName",
                "email",
                "dateOfBirth",
                "gender",
            },
            "DEMO_NUTRITION_ASSESSMENT": {"age", "dietPreference"},
            "DEMO_DIET_PLAN_REQUEST": {
                "clientId",
                "planName",
                "goal",
                "calorieTarget",
                "durationWeeks",
            },
        }
        for payload in sample_payloads():
            targets = {
                mapping.targetField for mapping in payload.Buttons[0].request.payloadMapping
            }
            with self.subTest(formCode=payload.formCode):
                self.assertEqual(targets, expected_targets[payload.formCode])

    def test_button_endpoints_are_exposed(self) -> None:
        paths = app.openapi()["paths"]
        for payload in sample_payloads():
            endpoint = payload.Buttons[0].request.endpoint
            with self.subTest(endpoint=endpoint):
                self.assertIn(endpoint, paths)
                self.assertIn("post", paths[endpoint])

    def test_samples_are_valid_form_definitions(self) -> None:
        for sample in SAMPLE_FORMS:
            definition = FormDefinition.model_validate(
                {key: sample[key] for key in FormDefinition.model_fields}
            )
            with self.subTest(formCode=sample["formCode"]):
                self.assertEqual(definition.title, sample["title"])

    def test_fields_use_unique_codes_within_a_section(self) -> None:
        for payload in sample_payloads():
            codes = [
                field.fieldCode
                for section in payload.sections
                for field in section.fields
            ]
            with self.subTest(formCode=payload.formCode):
                self.assertEqual(len(codes), len(set(codes)))


if __name__ == "__main__":
    unittest.main()
