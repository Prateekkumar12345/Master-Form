"""Ensure the three sample master forms and their response keyholders.

The three sample forms exercise the form-action routes:

* Sample Client Registration  -> ``POST /api/v1/clients``
* Sample Nutrition Assessment -> ``POST /api/v1/assessments/submit``
* Sample Diet Plan Request    -> ``POST /api/v1/diet-plans/generate``

Each form's API button stores a **response path** (keyholder) instead of a
literal message, so the text shown to the person filling the form comes from
the API response body:

* success keyholder ``message``       -> ``{ "success": true, "message": ... }``
* failure keyholder ``error.message`` -> ``{ "success": false, "error": {...} }``

The script is idempotent. For each sample it:

* creates the form (and publishes it) when it is missing;
* repairs the button keyholders when they are literals, preserving the rest of
  the definition, and re-publishes the resulting version;
* leaves an already-correct, published form untouched.

It reuses the real service layer, so value-set references, version snapshots,
and lifecycle transitions are produced exactly as the API would.

Prerequisite: the controlled value sets must exist, otherwise the service
reports ``VALUE_SET_NOT_CONFIGURED``::

    python -m scripts.migrate_master_form_value_sets --apply

Usage::

    python -m scripts.seed_sample_forms            # dry run
    python -m scripts.seed_sample_forms --apply    # create / repair the forms
"""

from __future__ import annotations

import argparse
import asyncio
from copy import deepcopy
from typing import Any

from fastapi import HTTPException

from app.core.config import settings
from app.db.session import connect_mongodb, get_master_forms_collection
from app.schemas.master_form import MasterFormCreate, MasterFormPatch
from app.services.master_forms import (
    create_master_form,
    switch_master_form_version,
    update_master_form,
)
from app.services.value_sets import codes_for_validation

SUCCESS_KEYHOLDER = "message"
FAILURE_KEYHOLDER = "error.message"


def _code(value: Any) -> Any:
    if isinstance(value, dict) and "code" in value:
        return value["code"]
    return value


def _field(
    field_code: str,
    label: str,
    *,
    order: int,
    type_: str = "INPUT",
    data_type: str = "STRING",
    required: bool = True,
    placeholder: str | None = None,
    validation: dict[str, Any] | None = None,
    options: list[dict[str, str]] | None = None,
    options_display_type: str | None = None,
) -> dict[str, Any]:
    return {
        "fieldCode": field_code,
        "label": label,
        "type": type_,
        "dataType": data_type,
        "isRequired": required,
        "isEnabled": True,
        "displayOrder": order,
        "placeholder": placeholder,
        "defaultValue": None,
        "validation": validation,
        "options": options,
        "optionsDisplayType": options_display_type,
    }


def _button(
    code: str,
    label: str,
    endpoint: str,
    *,
    success_status: int,
    mappings: tuple[tuple[str, str, bool], ...] = (),
) -> dict[str, Any]:
    """Build an API button with response keyholders instead of literals."""
    return {
        "ButtonCode": code,
        "Buttonlabel": label,
        "description": None,
        "executionType": "API",
        "displayOrder": 0,
        "isEnabled": True,
        "request": {
            "endpoint": endpoint,
            "httpMethod": "POST",
            "contentType": "application/json",
            "pathParams": {},
            "queryParams": {},
            "payloadMapping": [
                {
                    "targetField": target,
                    "sourceType": "FORM_FIELD",
                    "sourceFieldCode": source,
                    "required": required,
                }
                for target, source, required in mappings
            ],
        },
        "responseHandling": {
            "successStatusCodes": [success_status],
            "failureStatusCodes": [],
            "onSuccess": {
                "navigateTo": None,
                "responseMessage": SUCCESS_KEYHOLDER,
            },
            "onFailure": {
                "navigateTo": None,
                "responseMessage": FAILURE_KEYHOLDER,
            },
        },
    }


SAMPLE_FORMS: tuple[dict[str, Any], ...] = (
    {
        "formCode": "DEMO_CLIENT_REGISTRATION",
        "organizationId": None,
        "name": "Sample Client Registration",
        "title": "Client Registration",
        "description": (
            "Example registration form with fields accepted by the client "
            "registration endpoint."
        ),
        "formType": "REGISTRATION",
        "layout": "SINGLE_PAGE",
        "sections": [
            {
                "sectionCode": "CLIENT_DETAILS",
                "title": "Client details",
                "displayOrder": 0,
                "fields": [
                    _field(
                        "FIRST_NAME", "First name", order=0, placeholder="First name"
                    ),
                    _field(
                        "LAST_NAME", "Last name", order=1, placeholder="Last name"
                    ),
                    _field(
                        "EMAIL",
                        "Email",
                        order=2,
                        placeholder="name@example.com",
                    ),
                    _field(
                        "DATE_OF_BIRTH",
                        "Date of birth",
                        order=3,
                        type_="DATE",
                        data_type="DATE",
                    ),
                    _field(
                        "GENDER",
                        "Gender",
                        order=4,
                        type_="SELECT",
                        options=[
                            {"value": "MALE", "label": "Male"},
                            {"value": "FEMALE", "label": "Female"},
                            {"value": "OTHER", "label": "Other"},
                            {
                                "value": "PREFER_NOT_TO_SAY",
                                "label": "Prefer not to say",
                            },
                        ],
                        options_display_type="DROPDOWN",
                    ),
                ],
            }
        ],
        "Buttons": [
            _button(
                "REGISTER_CLIENT",
                "Register client",
                "/api/v1/clients",
                success_status=201,
                mappings=(
                    ("firstName", "FIRST_NAME", True),
                    ("lastName", "LAST_NAME", True),
                    ("email", "EMAIL", True),
                    ("dateOfBirth", "DATE_OF_BIRTH", True),
                    ("gender", "GENDER", True),
                ),
            )
        ],
    },
    {
        "formCode": "DEMO_NUTRITION_ASSESSMENT",
        "organizationId": None,
        "name": "Sample Nutrition Assessment",
        "title": "Nutrition Assessment",
        "description": (
            "Example assessment form for testing the assessment workflow."
        ),
        "formType": "ASSESSMENT",
        "layout": "WIZARD",
        "sections": [
            {
                "sectionCode": "PERSONAL_DETAILS",
                "title": "Personal Details",
                "displayOrder": 0,
                "fields": [
                    _field(
                        "AGE",
                        "Age",
                        order=0,
                        type_="NUMBER",
                        data_type="NUMBER",
                        placeholder="Enter age",
                        validation={"min": 1, "max": 120},
                    ),
                    _field(
                        "DIET_PREFERENCE",
                        "Diet Preference",
                        order=1,
                        type_="SELECT",
                        required=False,
                        options=[
                            {"value": "VEGETARIAN", "label": "Vegetarian"},
                            {
                                "value": "NON_VEGETARIAN",
                                "label": "Non-vegetarian",
                            },
                        ],
                        options_display_type="RADIO",
                    ),
                ],
            }
        ],
        "Buttons": [
            _button(
                "SUBMIT_ASSESSMENT",
                "Submit assessment",
                "/api/v1/assessments/submit",
                success_status=201,
                mappings=(
                    ("age", "AGE", True),
                    ("dietPreference", "DIET_PREFERENCE", False),
                ),
            )
        ],
    },
    {
        "formCode": "DEMO_DIET_PLAN_REQUEST",
        "organizationId": None,
        "name": "Sample Diet Plan Request",
        "title": "Diet Plan Request",
        "description": "Example form for queuing a diet plan request.",
        "formType": "DIET_PLAN",
        "layout": "WIZARD",
        "sections": [
            {
                "sectionCode": "PLAN_DETAILS",
                "title": "Plan details",
                "displayOrder": 0,
                "fields": [
                    _field("CLIENT_ID", "Client ID", order=0),
                    _field("PLAN_NAME", "Plan name", order=1),
                    _field(
                        "GOAL",
                        "Goal",
                        order=2,
                        type_="SELECT",
                        options=[
                            {"value": "WEIGHT_LOSS", "label": "Weight loss"},
                            {"value": "MUSCLE_GAIN", "label": "Muscle gain"},
                            {"value": "MAINTENANCE", "label": "Maintenance"},
                        ],
                        options_display_type="DROPDOWN",
                    ),
                    _field(
                        "CALORIE_TARGET",
                        "Daily calorie target",
                        order=3,
                        type_="NUMBER",
                        data_type="NUMBER",
                        validation={"min": 800, "max": 5000},
                    ),
                    _field(
                        "DURATION_WEEKS",
                        "Duration (weeks)",
                        order=4,
                        type_="NUMBER",
                        data_type="NUMBER",
                        required=False,
                        validation={"min": 1, "max": 52},
                    ),
                ],
            }
        ],
        "Buttons": [
            _button(
                "REQUEST_DIET_PLAN",
                "Request diet plan",
                "/api/v1/diet-plans/generate",
                success_status=202,
                mappings=(
                    ("clientId", "CLIENT_ID", True),
                    ("planName", "PLAN_NAME", True),
                    ("goal", "GOAL", True),
                    ("calorieTarget", "CALORIE_TARGET", True),
                    ("durationWeeks", "DURATION_WEEKS", False),
                ),
            )
        ],
    },
)


def sample_payloads() -> list[MasterFormCreate]:
    """Validate and return the sample form payloads."""
    return [MasterFormCreate.model_validate(sample) for sample in SAMPLE_FORMS]


def _with_keyholders(buttons: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result = deepcopy(buttons)
    for button in result:
        handling = button.setdefault("responseHandling", {})
        handling.setdefault("onSuccess", {})["responseMessage"] = SUCCESS_KEYHOLDER
        handling.setdefault("onFailure", {})["responseMessage"] = FAILURE_KEYHOLDER
    return result


def _keyholders_ready(buttons: list[dict[str, Any]]) -> bool:
    for button in buttons:
        handling = button.get("responseHandling") or {}
        if (handling.get("onSuccess") or {}).get(
            "responseMessage"
        ) != SUCCESS_KEYHOLDER:
            return False
        if (handling.get("onFailure") or {}).get(
            "responseMessage"
        ) != FAILURE_KEYHOLDER:
            return False
    return True


async def _ensure_form(
    collection: Any, payload: MasterFormCreate, apply: bool
) -> str:
    existing = await collection.find_one(
        {"$or": [{"formCode": payload.formCode}, {"name": payload.name}]}
    )

    if existing is None:
        if not apply:
            return "create"
        document = await create_master_form(payload)
        await update_master_form(
            str(document["_id"]), MasterFormPatch(status="PUBLISHED")
        )
        return "created"

    form_id = str(existing["_id"])
    current = codes_for_validation(existing)
    buttons = current.get("Buttons", [])
    needs_fix = not _keyholders_ready(buttons)
    status = _code(existing.get("status"))

    if not needs_fix and status == "PUBLISHED":
        return "unchanged"
    if not apply:
        return "update"

    if status == "ARCHIVED":
        await update_master_form(form_id, MasterFormPatch(status="DRAFT"))
        status = "DRAFT"

    if needs_fix:
        await update_master_form(
            form_id, MasterFormPatch(Buttons=_with_keyholders(buttons))
        )
        fresh = await collection.find_one({"_id": existing["_id"]})
        if _code(fresh.get("status")) == "PUBLISHED":
            newest = max(
                fresh.get("versions", []), key=lambda entry: entry["version"]
            )
            await switch_master_form_version(form_id, str(newest["_id"]))
            return "repaired"
        status = _code(fresh.get("status"))

    if status != "PUBLISHED":
        await update_master_form(form_id, MasterFormPatch(status="PUBLISHED"))
    return "repaired"


async def _seed(apply: bool) -> int:
    payloads = sample_payloads()
    client = connect_mongodb()
    try:
        collection = get_master_forms_collection()
        print(f"Database: {settings.mongodb_database}")
        print(f"Master forms collection: {settings.mongodb_collection}")
        results: list[tuple[str, str, str]] = []
        for payload in payloads:
            endpoint = payload.Buttons[0].request.endpoint
            action = await _ensure_form(collection, payload, apply)
            results.append((payload.formCode, action, endpoint))
        for form_code, action, endpoint in results:
            print(f"  {action:<9} {form_code}  -> POST {endpoint}")
        if apply:
            print(
                "Applied seed: sample forms use the "
                "'message' / 'error.message' response keyholders."
            )
        else:
            print(
                "Dry run only. Re-run with --apply to create/repair the forms."
            )
        return 0
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, dict) else {}
        print(
            "Seed failed: "
            f"{detail.get('code', 'HTTP_ERROR')} - "
            f"{detail.get('message', exc.detail)}"
        )
        if detail.get("code") == "VALUE_SET_NOT_CONFIGURED":
            print(
                "Run the value-set migration first: "
                "python -m scripts.migrate_master_form_value_sets --apply"
            )
        return 1
    finally:
        await client.close()


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Ensure the sample master forms exist and use response keyholders."
        )
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Create/repair the sample forms (default is a dry run).",
    )
    args = parser.parse_args()
    raise SystemExit(asyncio.run(_seed(args.apply)))


if __name__ == "__main__":
    main()
