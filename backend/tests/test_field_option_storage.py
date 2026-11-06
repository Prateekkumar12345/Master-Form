import unittest

from bson import ObjectId
from pydantic import ValidationError

from app.schemas.master_form import FormField
from app.services.value_sets import (
    FIELD_TYPE,
    FIELD_VALIDATION_RULE,
    VALUE_SET_DEFINITIONS,
    references_for_storage,
)


def field_payload(**overrides) -> dict:
    field = {
        "fieldCode": "DIET",
        "label": "Diet preference",
        "type": "SELECT",
        "dataType": "STRING",
        "isRequired": True,
        "isEnabled": True,
        "displayOrder": 0,
        "options": [
            {"value": "VEGETARIAN", "label": "Vegetarian"},
            {"value": "NON_VEGETARIAN", "label": "Non-vegetarian"},
        ],
        "optionsDisplayType": "RADIO",
    }
    field.update(overrides)
    return field


class FormFieldOptionDisplayTests(unittest.TestCase):
    def test_select_accepts_dropdown_and_radio_styles(self) -> None:
        for style in ("DROPDOWN", "RADIO"):
            with self.subTest(style=style):
                field = FormField.model_validate(
                    field_payload(optionsDisplayType=style)
                )
                self.assertEqual(field.optionsDisplayType, style)

    def test_multiselect_accepts_dropdown_and_checkbox_styles(self) -> None:
        for style in ("DROPDOWN", "CHECKBOXES"):
            with self.subTest(style=style):
                field = FormField.model_validate(
                    field_payload(type="MULTISELECT", optionsDisplayType=style)
                )
                self.assertEqual(field.optionsDisplayType, style)

    def test_rejects_incompatible_option_styles(self) -> None:
        with self.assertRaises(ValidationError):
            FormField.model_validate(
                field_payload(optionsDisplayType="CHECKBOXES")
            )
        with self.assertRaises(ValidationError):
            FormField.model_validate(
                field_payload(type="MULTISELECT", optionsDisplayType="RADIO")
            )

    def test_number_field_type_is_supported(self) -> None:
        field = FormField.model_validate(
            {
                "fieldCode": "AGE",
                "label": "Age",
                "type": "NUMBER",
                "dataType": "NUMBER",
                "isRequired": True,
                "isEnabled": True,
                "displayOrder": 0,
                "validation": {"min": 0, "max": 120},
            }
        )
        self.assertEqual(field.type, "NUMBER")
        self.assertIsNotNone(field.validation)
        self.assertEqual(field.validation.max, 120)

    def test_field_type_value_set_includes_number(self) -> None:
        definition = next(
            item for item in VALUE_SET_DEFINITIONS if item["name"] == FIELD_TYPE
        )
        codes = [code["code"] for code in definition["codes"]]
        self.assertIn("NUMBER", codes)

    def test_validation_storage_includes_all_six_rule_references(self) -> None:
        rule_ids = {
            "min": ObjectId(),
            "max": ObjectId(),
            "minLength": ObjectId(),
            "maxLength": ObjectId(),
            "minItems": ObjectId(),
            "maxItems": ObjectId(),
        }
        stored = references_for_storage(
            {
                "sections": [
                    {
                        "fields": [
                            field_payload(
                                optionsDisplayType="DROPDOWN",
                                validation={"maxLength": 255},
                            )
                        ]
                    }
                ]
            },
            {
                "FieldType": {"SELECT": {"valueSetId": ObjectId(), "code": "SELECT"}},
                "FieldDataType": {
                    "STRING": {"valueSetId": ObjectId(), "code": "STRING"}
                },
                FIELD_VALIDATION_RULE: {
                    code: {"valueSetId": value_set_id, "code": code}
                    for code, value_set_id in rule_ids.items()
                },
            },
        )

        validation = stored["sections"][0]["fields"][0]["validation"]
        self.assertEqual(len(validation), 6)
        self.assertEqual(
            [entry["rule"]["code"] for entry in validation],
            ["min", "max", "minLength", "maxLength", "minItems", "maxItems"],
        )
        self.assertEqual(validation[3]["value"], 255)
        self.assertIsNone(validation[0]["value"])


if __name__ == "__main__":
    unittest.main()
