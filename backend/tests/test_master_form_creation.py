import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from bson import ObjectId
from pydantic import ValidationError

from app.schemas.master_form import MasterFormCreate
from app.services.master_forms import create_master_form


def create_payload(**overrides) -> dict:
    payload = {
        "formCode": "MEDICAL_HISTORY",
        "name": "Medical history",
        "formType": "MEDICAL_HISTORY",
        "title": "Medical history",
        "layout": "SINGLE_PAGE",
        "Buttons": [],
        "sections": [],
    }
    payload.update(overrides)
    return payload


class MasterFormCreateSchemaTests(unittest.TestCase):
    def test_form_code_is_required_and_trimmed(self) -> None:
        payload = MasterFormCreate.model_validate(
            create_payload(formCode="  MEDICAL_HISTORY  ")
        )
        self.assertEqual(payload.formCode, "MEDICAL_HISTORY")

        with self.assertRaises(ValidationError):
            MasterFormCreate.model_validate(create_payload(formCode="  "))

        with self.assertRaises(ValidationError):
            MasterFormCreate.model_validate(
                {key: value for key, value in create_payload().items() if key != "formCode"}
            )


class MasterFormCreationTests(unittest.IsolatedAsyncioTestCase):
    async def test_creation_persists_supplied_code_and_master_form_type(self) -> None:
        actor_id = ObjectId()
        collection = Mock()

        async def insert_document(document):
            return SimpleNamespace(inserted_id=document["_id"])

        collection.insert_one = AsyncMock(side_effect=insert_document)
        payload = MasterFormCreate.model_validate(create_payload())

        with (
            patch("app.services.master_forms.actor_object_id", return_value=actor_id),
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
            result = await create_master_form(payload)

        stored_document = collection.insert_one.await_args.args[0]
        self.assertEqual(list(stored_document)[:2], ["_id", "documentType"])
        self.assertEqual(stored_document["formCode"], "MEDICAL_HISTORY")
        self.assertEqual(stored_document["documentType"], "MASTER_FORM")
        self.assertEqual(result["_id"], stored_document["_id"])


if __name__ == "__main__":
    unittest.main()
