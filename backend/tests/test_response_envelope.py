import unittest

from app.services.master_forms import envelope, success_message


class SuccessMessageTests(unittest.TestCase):
    def test_standard_message_for_each_success_status_code(self) -> None:
        self.assertEqual(
            success_message(200), "Request completed successfully."
        )
        self.assertEqual(
            success_message(201), "Resource created successfully."
        )
        self.assertEqual(
            success_message(202), "Request accepted for processing."
        )
        self.assertEqual(
            success_message(204), "Request completed successfully."
        )

    def test_unknown_status_code_falls_back_to_generic_message(self) -> None:
        self.assertEqual(
            success_message(299), "Request completed successfully."
        )

    def test_envelope_includes_standard_message(self) -> None:
        result = envelope({"id": "abc"}, {"page": 1})

        self.assertTrue(result["success"])
        self.assertEqual(
            result["message"], "Request completed successfully."
        )
        self.assertEqual(result["data"], {"id": "abc"})
        self.assertEqual(result["meta"], {"page": 1})

    def test_envelope_accepts_an_endpoint_specific_message(self) -> None:
        result = envelope(
            {"id": "abc"},
            status_code=201,
            message="Master form created successfully.",
        )

        self.assertEqual(
            result["message"], "Master form created successfully."
        )


if __name__ == "__main__":
    unittest.main()
