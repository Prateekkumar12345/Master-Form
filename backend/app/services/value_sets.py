from copy import deepcopy
from typing import Any

from bson import ObjectId
from fastapi import HTTPException

from app.db.session import get_value_sets_collection

FORM_TYPE = "FormType"
FORM_STATUS = "MasterFormStatus"
FORM_LAYOUT = "FormLayout"
BUTTON_EXECUTION_TYPE = "ButtonExecutionType"
HTTP_METHOD = "HttpMethod"
FIELD_TYPE = "FieldType"
FIELD_DATA_TYPE = "FieldDataType"
FIELD_VALIDATION_RULE = "FieldValidationRule"
QUERY_PARAMETER_SOURCE_TYPE = "QueryParameterSourceType"

VALUE_SET_DEFINITIONS: tuple[dict[str, Any], ...] = (
    {
        "name": FORM_TYPE,
        "version": "1.0",
        "codes": [
            {"code": "ASSESSMENT", "display": "Assessment"},
            {"code": "REGISTRATION", "display": "Registration"},
            {"code": "DIET_PLAN", "display": "Diet Plan"},
            {"code": "MEDICAL_HISTORY", "display": "Medical History"},
            {"code": "BODY_MEASUREMENT", "display": "Body Measurement"},
            {"code": "LOGIN", "display": "Login"},
            {"code": "CUSTOM", "display": "Custom"},
        ],
    },
    {
        "name": FORM_STATUS,
        "version": "1.0",
        "codes": [
            {"code": "DRAFT", "display": "Draft"},
            {"code": "PUBLISHED", "display": "Published"},
            {"code": "ARCHIVED", "display": "Archived"},
        ],
    },
    {
        "name": FORM_LAYOUT,
        "version": "1.0",
        "codes": [
            {"code": "SINGLE_PAGE", "display": "Single Page"},
            {"code": "WIZARD", "display": "Wizard"},
            {"code": "TABS", "display": "Tabs"},
            {"code": "ACCORDION", "display": "Accordion"},
        ],
    },
    {
        "name": BUTTON_EXECUTION_TYPE,
        "version": "1.0",
        "codes": [
            {"code": "API", "display": "API"},
            {"code": "REACT_ROUTE", "display": "React Route"},
            {"code": "CLIENT_ACTION", "display": "Client Action"},
        ],
    },
    {
        "name": HTTP_METHOD,
        "version": "1.0",
        "codes": [
            {"code": "GET", "display": "GET"},
            {"code": "POST", "display": "POST"},
            {"code": "PUT", "display": "PUT"},
            {"code": "PATCH", "display": "PATCH"},
            {"code": "DELETE", "display": "DELETE"},
        ],
    },
    {
        "name": FIELD_TYPE,
        "version": "1.0",
        "codes": [
            {"code": "INPUT", "display": "Input"},
            {"code": "NUMBER", "display": "Number"},
            {"code": "TEXTAREA", "display": "Text Area"},
            {"code": "DATE", "display": "Date"},
            {"code": "CHECKBOX", "display": "Checkbox"},
            {"code": "SELECT", "display": "Select"},
            {"code": "MULTISELECT", "display": "Multi-select"},
        ],
    },
    {
        "name": FIELD_DATA_TYPE,
        "version": "1.0",
        "codes": [
            {"code": "STRING", "display": "String"},
            {"code": "NUMBER", "display": "Number"},
            {"code": "BOOLEAN", "display": "Boolean"},
            {"code": "DATE", "display": "Date"},
            {"code": "DATETIME", "display": "Date and Time"},
        ],
    },
    {
        "name": FIELD_VALIDATION_RULE,
        "version": "1.0",
        "codes": [
            {"code": "min", "display": "Minimum value"},
            {"code": "max", "display": "Maximum value"},
            {"code": "minLength", "display": "Minimum length"},
            {"code": "maxLength", "display": "Maximum length"},
            {"code": "minItems", "display": "Minimum items"},
            {"code": "maxItems", "display": "Maximum items"},
        ],
    },
    {
        "name": QUERY_PARAMETER_SOURCE_TYPE,
        "version": "1.0",
        "codes": [
            {"code": "FORM_FIELD", "display": "Form field"},
            {"code": "CONSTANT", "display": "Constant"},
        ],
    },
)

SET_BY_FIELD = {
    "formType": FORM_TYPE,
    "status": FORM_STATUS,
    "layout": FORM_LAYOUT,
    "executionType": BUTTON_EXECUTION_TYPE,
    "httpMethod": HTTP_METHOD,
    "type": FIELD_TYPE,
    "dataType": FIELD_DATA_TYPE,
}

VALIDATION_FIELDS = (
    "min",
    "max",
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
)


def _not_configured(name: str) -> HTTPException:
    return HTTPException(
        status_code=503,
        detail={
            "code": "VALUE_SET_NOT_CONFIGURED",
            "message": f"The required {name} value set is missing or inactive.",
        },
    )


async def load_value_set_references() -> dict[str, dict[str, dict[str, Any]]]:
    names = [definition["name"] for definition in VALUE_SET_DEFINITIONS]
    documents = await get_value_sets_collection().find(
        {"name": {"$in": names}, "isActive": True, "isDeleted": False}
    ).to_list(length=len(names))
    result: dict[str, dict[str, dict[str, Any]]] = {}
    for document in documents:
        result[document["name"]] = {
            entry["code"]: {
                "valueSetId": document["_id"],
                "code": entry["code"],
            }
            for entry in document.get("codes", [])
            if entry.get("isActive", True)
        }
    return result


def reference_for(
    code: str | None,
    set_name: str,
    value_sets: dict[str, dict[str, dict[str, Any]]],
) -> dict[str, Any] | None:
    if code is None:
        return None
    try:
        return value_sets[set_name][code].copy()
    except KeyError as exc:
        raise _not_configured(set_name) from exc


def _code(value: Any) -> Any:
    if isinstance(value, dict) and "code" in value:
        return value["code"]
    return value


def codes_for_validation(document: dict[str, Any]) -> dict[str, Any]:
    result = deepcopy(document)
    for field in ("formType", "status", "layout"):
        if field in result:
            result[field] = _code(result[field])
    for button in result.get("Buttons", []):
        if "executionType" in button:
            button["executionType"] = _code(button["executionType"])
        request = button.get("request")
        if request is not None:
            if "httpMethod" in request:
                request["httpMethod"] = _code(request["httpMethod"])
            if isinstance(request.get("queryParams"), dict):
                for value in request["queryParams"].values():
                    if isinstance(value, dict) and "sourceType" in value:
                        value["sourceType"] = _code(value["sourceType"])
            if isinstance(request.get("payloadMapping"), list):
                for mapping in request["payloadMapping"]:
                    if isinstance(mapping, dict) and "sourceType" in mapping:
                        mapping["sourceType"] = _code(mapping["sourceType"])
    for section in result.get("sections", []):
        for field in section.get("fields", []):
            for key in ("type", "dataType"):
                if key in field:
                    field[key] = _code(field[key])
            validation = field.get("validation")
            if isinstance(validation, list):
                field["validation"] = {
                    item["rule"]["code"]: item["value"]
                    for item in validation
                    if item.get("rule", {}).get("code") in VALIDATION_FIELDS
                }
    return result


def references_for_storage(
    document: dict[str, Any],
    value_sets: dict[str, dict[str, dict[str, Any]]],
) -> dict[str, Any]:
    result = deepcopy(document)
    for field in ("formType", "status", "layout"):
        if field in result:
            result[field] = reference_for(
                _code(result[field]), SET_BY_FIELD[field], value_sets
            )
    for button in result.get("Buttons", []):
        if "executionType" in button:
            button["executionType"] = reference_for(
                _code(button["executionType"]),
                SET_BY_FIELD["executionType"],
                value_sets,
            )
        request = button.get("request")
        if request is not None:
            if "httpMethod" in request:
                request["httpMethod"] = reference_for(
                    _code(request["httpMethod"]),
                    SET_BY_FIELD["httpMethod"],
                    value_sets,
                )
            if isinstance(request.get("queryParams"), dict):
                for value in request["queryParams"].values():
                    if isinstance(value, dict) and "sourceType" in value:
                        value["sourceType"] = reference_for(
                            _code(value["sourceType"]),
                            QUERY_PARAMETER_SOURCE_TYPE,
                            value_sets,
                        )
            if isinstance(request.get("payloadMapping"), list):
                for mapping in request["payloadMapping"]:
                    if isinstance(mapping, dict) and "sourceType" in mapping:
                        mapping["sourceType"] = reference_for(
                            _code(mapping["sourceType"]),
                            QUERY_PARAMETER_SOURCE_TYPE,
                            value_sets,
                        )
    for section in result.get("sections", []):
        for field in section.get("fields", []):
            for key in ("type", "dataType"):
                if key in field:
                    field[key] = reference_for(
                        _code(field[key]), SET_BY_FIELD[key], value_sets
                    )
            validation = field.get("validation")
            if validation is None or isinstance(validation, dict):
                configured_rules = validation or {}
                field["validation"] = [
                    {
                        "rule": reference_for(
                            key, FIELD_VALIDATION_RULE, value_sets
                        ),
                        "value": configured_rules.get(key),
                    }
                    for key in VALIDATION_FIELDS
                ]
    return result


def code_filter(field: str, code: str) -> dict[str, str]:
    return {f"{field}.code": code}


async def list_value_sets() -> list[dict[str, Any]]:
    names = [definition["name"] for definition in VALUE_SET_DEFINITIONS]
    return await (
        get_value_sets_collection()
        .find(
            {"name": {"$in": names}, "isActive": True, "isDeleted": False},
            projection={"name": 1, "version": 1, "codes": 1, "isActive": 1},
        )
        .sort("name", 1)
        .to_list(length=len(names))
    )


async def get_value_set(value_set_id: str) -> dict[str, Any]:
    if not ObjectId.is_valid(value_set_id):
        raise HTTPException(
            status_code=400,
            detail={
                "code": "INVALID_REQUEST",
                "message": "valueSetId must be a valid ObjectId.",
            },
        )
    document = await get_value_sets_collection().find_one(
        {
            "_id": ObjectId(value_set_id),
            "isActive": True,
            "isDeleted": False,
        },
        projection={"name": 1, "version": 1, "codes": 1, "isActive": 1},
    )
    if document is None:
        raise HTTPException(
            status_code=404,
            detail={
                "code": "VALUE_SET_NOT_FOUND",
                "message": "Value set was not found.",
            },
        )
    return document
