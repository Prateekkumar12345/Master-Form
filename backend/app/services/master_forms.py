import re
from copy import deepcopy
from datetime import UTC, datetime
from typing import Any

from bson import ObjectId
from fastapi import HTTPException
from pydantic import ValidationError
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.core.config import settings
from app.db.session import get_master_forms_collection
from app.schemas.master_form import (
    FormDefinition,
    MasterFormCreate,
    MasterFormPatch,
)
from app.services.value_sets import (
    FORM_STATUS,
    code_filter,
    codes_for_validation,
    load_value_set_references,
    reference_for,
    references_for_storage,
)

SNAPSHOT_FIELDS = (
    "name",
    "title",
    "description",
    "formType",
    "layout",
    "Buttons",
    "sections",
)


def api_error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"code": code, "message": message},
    )


def object_id(value: str, name: str = "masterFormId") -> ObjectId:
    if not ObjectId.is_valid(value):
        raise api_error(400, "INVALID_REQUEST", f"{name} must be a valid ObjectId.")
    return ObjectId(value)


def version_object_id(value: str) -> ObjectId:
    return object_id(value, "masterFormVersionId")


def find_version(
    document: dict[str, Any], version_id: ObjectId
) -> dict[str, Any] | None:
    for entry in document.get("versions", []):
        if entry.get("_id") == version_id:
            return entry
    return None


def require_version(
    document: dict[str, Any], version_id: ObjectId
) -> dict[str, Any]:
    entry = find_version(document, version_id)
    if entry is None:
        raise api_error(
            404,
            "MASTER_FORM_VERSION_NOT_FOUND",
            "The requested master form version was not found.",
        )
    return entry


def require_active_version(document: dict[str, Any]) -> dict[str, Any]:
    """Require currentVersion to identify exactly one saved version."""
    versions = document.get("versions", [])
    version_numbers = [entry.get("version") for entry in versions]
    active_versions = [
        entry
        for entry in versions
        if entry.get("version") == document.get("currentVersion")
    ]
    if (
        not versions
        or not isinstance(document.get("currentVersion"), int)
        or isinstance(document.get("currentVersion"), bool)
        or any(
            not isinstance(number, int) or isinstance(number, bool)
            for number in version_numbers
        )
        or len(version_numbers) != len(set(version_numbers))
        or len(active_versions) != 1
        or active_versions[0].get("isDeleted", False)
    ):
        raise api_error(
            409,
            "MASTER_FORM_ACTIVE_VERSION_REQUIRED",
            "The form must have exactly one saved version matching currentVersion.",
        )
    return active_versions[0]


def public_value(value: Any) -> Any:
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, list):
        return [public_value(item) for item in value]
    if isinstance(value, dict):
        return {key: public_value(item) for key, item in value.items()}
    return value


def snapshot_for(document: dict[str, Any]) -> dict[str, Any]:
    return {key: deepcopy(document.get(key)) for key in SNAPSHOT_FIELDS}


def next_version_number(document: dict[str, Any]) -> int:
    """Return the next unused version number.

    ``currentVersion`` can point at an older version after a switch, so the
    next number must be derived from the highest stored version instead of
    ``currentVersion + 1``.
    """
    highest = max(
        (entry.get("version", 0) for entry in document.get("versions", [])),
        default=0,
    )
    return max(highest, document.get("currentVersion", 0)) + 1


SUCCESS_MESSAGES: dict[int, str] = {
    200: "Request completed successfully.",
    201: "Resource created successfully.",
    202: "Request accepted for processing.",
    204: "Request completed successfully.",
}


def success_message(status_code: int = 200, message: str | None = None) -> str:
    """Return the standard success message for an HTTP status code."""
    return message or SUCCESS_MESSAGES.get(status_code, SUCCESS_MESSAGES[200])


def envelope(
    data: Any,
    meta: Any = None,
    *,
    status_code: int = 200,
    message: str | None = None,
) -> dict[str, Any]:
    return {
        "success": True,
        "message": success_message(status_code, message),
        "data": public_value(data),
        "meta": public_value(meta),
    }


def actor_object_id() -> ObjectId:
    if not ObjectId.is_valid(settings.default_actor_id):
        raise api_error(
            500,
            "INVALID_DEFAULT_ACTOR_ID",
            "DEFAULT_ACTOR_ID must contain a valid MongoDB ObjectId.",
        )
    return ObjectId(settings.default_actor_id)


async def create_master_form(payload: MasterFormCreate) -> dict[str, Any]:
    actor = actor_object_id()
    document = payload.model_dump(by_alias=True)
    organization_id = document.get("organizationId")
    if organization_id is not None:
        if not ObjectId.is_valid(organization_id):
            raise api_error(
                422, "VALIDATION_ERROR", "organizationId must be a valid ObjectId."
            )
        document["organizationId"] = ObjectId(organization_id)

    FormDefinition.model_validate(
        {key: document[key] for key in SNAPSHOT_FIELDS}
    )
    document = references_for_storage(
        document, await load_value_set_references()
    )
    document = {
        "_id": ObjectId(),
        "documentType": "MASTER_FORM",
        **document,
    }
    now = datetime.now(UTC)
    document.update(
        {
            "currentVersion": 1,
            "versions": [],
            "createdBy": actor,
            "createdAt": now,
            "updatedBy": actor,
            "updatedAt": now,
            "isDeleted": False,
        }
    )
    document["versions"] = [
        {
            "_id": ObjectId(),
            "version": 1,
            "status": "DRAFT",
            "snapshot": snapshot_for(document),
            "createdBy": actor,
            "createdAt": now,
        }
    ]
    require_active_version(document)

    try:
        result = await get_master_forms_collection().insert_one(document)
    except DuplicateKeyError as exc:
        raise api_error(
            409,
            "MASTER_FORM_ALREADY_EXISTS",
            "A form with this formCode already exists in the requested scope.",
        ) from exc
    document["_id"] = result.inserted_id
    return document


async def get_master_form(
    master_form_id: str, include_versions: bool, include_deleted: bool = False
) -> dict[str, Any]:
    form_id = object_id(master_form_id)
    projection = None if include_versions else {"versions": 0}
    document = await get_master_forms_collection().find_one(
        build_get_query(form_id, include_deleted),
        projection=projection,
    )
    if document is None:
        raise api_error(404, "MASTER_FORM_NOT_FOUND", "Master form was not found.")
    if include_versions:
        require_active_version(document)
    return document


def build_list_query(
    *,
    organization_id: str | None,
    form_code: str | None,
    form_type: str | None,
    status: str | None,
    name: str | None,
    is_deleted: bool,
    include_deleted: bool,
) -> dict[str, Any]:
    query: dict[str, Any] = {}
    if not include_deleted:
        query["isDeleted"] = is_deleted
    if organization_id is not None:
        if not ObjectId.is_valid(organization_id):
            raise api_error(
                400, "INVALID_REQUEST", "organizationId must be a valid ObjectId."
            )
        query["organizationId"] = ObjectId(organization_id)
    if form_code is not None:
        query["formCode"] = form_code
    if form_type is not None:
        query.update(code_filter("formType", form_type))
    if status is not None:
        query.update(code_filter("status", status))
    if name is not None:
        query["name"] = {"$regex": re.escape(name), "$options": "i"}
    return query


def build_get_query(form_id: ObjectId, include_deleted: bool) -> dict[str, Any]:
    query: dict[str, Any] = {"_id": form_id}
    if not include_deleted:
        query["isDeleted"] = False
    return query


async def list_master_forms(
    *,
    organization_id: str | None,
    form_code: str | None,
    form_type: str | None,
    status: str | None,
    name: str | None,
    page: int,
    limit: int,
    sort_by: str,
    sort_order: str,
    is_deleted: bool = False,
    include_deleted: bool = False,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    query = build_list_query(
        organization_id=organization_id,
        form_code=form_code,
        form_type=form_type,
        status=status,
        name=name,
        is_deleted=is_deleted,
        include_deleted=include_deleted,
    )

    collection = get_master_forms_collection()
    total = await collection.count_documents(query)
    direction = 1 if sort_order == "asc" else -1
    sort_field = {"formType": "formType.code", "status": "status.code"}.get(
        sort_by, sort_by
    )
    documents = await (
        collection.find(query, projection={"versions": 0})
        .sort([(sort_field, direction), ("_id", 1)])
        .skip((page - 1) * limit)
        .limit(limit)
        .to_list(length=limit)
    )
    return documents, {
        "page": page,
        "limit": limit,
        "total": total,
        "totalPages": (total + limit - 1) // limit,
    }


async def update_master_form(
    master_form_id: str, payload: MasterFormPatch
) -> dict[str, Any]:
    """Apply configuration, saved-version edits, or lifecycle transitions.

    Editing a saved snapshot uses ``masterFormVersionId`` in the PATCH body.
    """
    form_id = object_id(master_form_id)
    actor = actor_object_id()
    collection = get_master_forms_collection()
    current = await collection.find_one({"_id": form_id, "isDeleted": False})
    if current is None:
        raise api_error(404, "MASTER_FORM_NOT_FOUND", "Master form was not found.")
    require_active_version(current)

    if "status" in payload.model_fields_set:
        return await _change_status(
            collection,
            current,
            payload.status,
            actor,
            payload.masterFormVersionId,
        )
    if "masterFormVersionId" in payload.model_fields_set:
        return await edit_master_form_version(
            master_form_id,
            payload.masterFormVersionId or "",
            payload,
        )

    current_codes = codes_for_validation(current)
    form_status = current_codes["status"]
    if form_status not in ("DRAFT", "PUBLISHED"):
        raise api_error(
            409,
            "INVALID_MASTER_FORM_STATUS",
            "Only DRAFT or PUBLISHED forms can create a version.",
        )

    changes = payload.model_dump(exclude_unset=True, by_alias=True)
    candidate = {key: deepcopy(current_codes[key]) for key in SNAPSHOT_FIELDS}
    candidate.update(changes)
    try:
        definition = FormDefinition.model_validate(candidate)
    except ValidationError as exc:
        raise api_error(
            422, "VALIDATION_ERROR", "The updated form definition is invalid."
        ) from exc
    snapshot = definition.model_dump(by_alias=True)
    stored_snapshot = references_for_storage(
        snapshot, await load_value_set_references()
    )
    if stored_snapshot == snapshot_for(current):
        return current

    next_version = next_version_number(current)
    now = datetime.now(UTC)
    updates: dict[str, Any] = {
        "$set": {
            "updatedBy": actor,
            "updatedAt": now,
        },
        "$push": {
            "versions": {
                "_id": ObjectId(),
                "version": next_version,
                "status": "DRAFT",
                "snapshot": stored_snapshot,
                "createdBy": actor,
                "createdAt": now,
            }
        },
    }
    if form_status == "DRAFT":
        updates["$set"].update(
            {
                **stored_snapshot,
                "currentVersion": next_version,
            }
        )

    update = await collection.update_one(
        {
            "_id": form_id,
            "isDeleted": False,
            "status.code": form_status,
            "currentVersion": current["currentVersion"],
        },
        updates,
    )
    if update.modified_count != 1:
        raise api_error(
            409,
            "VERSION_CONFLICT",
            "The form changed during this update; retrieve it and retry.",
        )
    return await collection.find_one({"_id": form_id})


TRANSITION_STATUSES = ("DRAFT", "PUBLISHED", "ARCHIVED")

ALLOWED_TRANSITIONS = frozenset(
    {
        ("DRAFT", "PUBLISHED"),
        ("DRAFT", "ARCHIVED"),
        ("PUBLISHED", "ARCHIVED"),
        ("PUBLISHED", "DRAFT"),
        ("ARCHIVED", "DRAFT"),
    }
)


def can_transition(current: str, target: str) -> bool:
    """Return whether ``current`` may move to ``target``.

    ARCHIVED -> PUBLISHED is rejected: an archived form must be reopened as
    DRAFT first. Staying on the same status is not a transition.
    """
    return (current, target) in ALLOWED_TRANSITIONS


async def _change_status(
    collection: Any,
    current: dict[str, Any],
    target: str | None,
    actor: ObjectId,
    master_form_version_id: str | None = None,
) -> dict[str, Any]:
    """Apply one lifecycle transition to ``current`` atomically."""
    if target is None:
        raise api_error(422, "VALIDATION_ERROR", "status cannot be null.")

    form_id = current["_id"]
    source = codes_for_validation(current)["status"]
    if source == target:
        raise api_error(
            409,
            "MASTER_FORM_STATUS_UNCHANGED",
            f"The form is already {target}.",
        )
    if not can_transition(source, target):
        raise api_error(
            409,
            "INVALID_MASTER_FORM_STATUS",
            f"A {source} form cannot move to {target}.",
        )

    selected_version: dict[str, Any] | None = None
    archive_version: dict[str, Any] | None = None
    if source == "PUBLISHED" and target == "DRAFT":
        saved_versions = current.get("versions", [])
        if master_form_version_id is None and len(saved_versions) > 1:
            raise api_error(
                409,
                "MASTER_FORM_VERSION_SELECTION_REQUIRED",
                "Choose a saved version to reopen as a draft.",
            )
        if master_form_version_id is not None:
            selected_version = require_version(
                current, version_object_id(master_form_version_id)
            )
            if selected_version.get("isDeleted", False):
                raise api_error(
                    404,
                    "MASTER_FORM_VERSION_NOT_FOUND",
                    "The requested master form version was not found.",
                )
            if selected_version.get("status", "DRAFT") == "ARCHIVED":
                raise api_error(
                    409,
                    "MASTER_FORM_VERSION_ARCHIVED",
                    "An archived version cannot be moved to draft.",
                )
        else:
            selected_version = require_active_version(current)
    elif source == "PUBLISHED" and target == "ARCHIVED":
        if master_form_version_id is not None:
            archive_version = require_version(
                current, version_object_id(master_form_version_id)
            )
            active_version = require_active_version(current)
            if archive_version.get("isDeleted", False):
                raise api_error(
                    404,
                    "MASTER_FORM_VERSION_NOT_FOUND",
                    "The requested master form version was not found.",
                )
            if (
                archive_version["_id"] != active_version["_id"]
                or archive_version.get("status") != "PUBLISHED"
            ):
                raise api_error(
                    409,
                    "MASTER_FORM_ARCHIVE_VERSION_NOT_PUBLISHED",
                    "The selected version is not the active published version.",
                )
    elif master_form_version_id is not None:
        raise api_error(
            422,
            "VALIDATION_ERROR",
            "masterFormVersionId is only valid when reopening a published form as a draft or when archiving its active published version.",
        )

    if selected_version is not None:
        try:
            selected_snapshot = FormDefinition.model_validate(
                codes_for_validation(deepcopy(selected_version["snapshot"]))
            )
        except ValidationError as exc:
            raise api_error(
                422,
                "MASTER_FORM_VALIDATION_FAILED",
                "The selected version snapshot is invalid.",
            ) from exc
        stored_snapshot = references_for_storage(
            selected_snapshot.model_dump(by_alias=True),
            await load_value_set_references(),
        )
    elif target == "PUBLISHED":
        try:
            FormDefinition.model_validate(
                codes_for_validation(snapshot_for(current))
            )
        except ValidationError as exc:
            raise api_error(
                422,
                "MASTER_FORM_VALIDATION_FAILED",
                "The form is invalid for publishing.",
            ) from exc

    now = datetime.now(UTC)
    updates: dict[str, Any] = {
        "$set": {
            "status": reference_for(
                target, FORM_STATUS, await load_value_set_references()
            ),
            "updatedBy": actor,
            "updatedAt": now,
        },
        "$unset": {"lastPublishedSwitch": ""},
    }
    active_version = require_active_version(current)
    updates["$set"]["versions.$[active].status"] = target
    array_filters: list[dict[str, Any]] = [
        {"active._id": active_version["_id"]},
    ]
    if selected_version is not None:
        updates["$set"].update(stored_snapshot)
        updates["$set"]["currentVersion"] = selected_version["version"]
        if selected_version["_id"] != active_version["_id"]:
            updates["$set"]["versions.$[selected].status"] = "DRAFT"
            array_filters.append({"selected._id": selected_version["_id"]})
        else:
            updates["$set"]["versions.$[active].status"] = "DRAFT"
    filters: dict[str, Any] = {
        "_id": form_id,
        "isDeleted": False,
        "status.code": source,
        "currentVersion": current["currentVersion"],
    }
    if selected_version is not None:
        filters["versions._id"] = selected_version["_id"]
    if archive_version is not None:
        filters["versions._id"] = archive_version["_id"]

    updated = await collection.find_one_and_update(
        filters,
        updates,
        return_document=ReturnDocument.AFTER,
        array_filters=array_filters,
    )
    if updated is None:
        raise api_error(
            409,
            "VERSION_CONFLICT",
            "The form changed during this update; retrieve it and retry.",
        )
    return updated


async def get_master_form_versions(
    master_form_id: str,
    *,
    master_form_version_id: str | None,
    include_deleted: bool = False,
    version: int | None,
    sort_order: str,
    page: int,
    limit: int,
) -> tuple[Any, dict[str, Any] | None]:
    """Return one version by ObjectId, or a page of version snapshots.

    ``masterFormVersionId`` selects a single immutable snapshot. Otherwise the
    history is filtered by optional numeric ``version``, sorted, and paginated.
    """
    form_id = object_id(master_form_id)
    collection = get_master_forms_collection()
    # A soft-deleted form keeps its saved history readable so the versions can
    # still be reviewed (and the form restored) without losing context.
    document = await collection.find_one(
        {"_id": form_id},
        projection={"versions": 1, "currentVersion": 1, "isDeleted": 1},
    )
    if document is None:
        raise api_error(404, "MASTER_FORM_NOT_FOUND", "Master form was not found.")
    require_active_version(document)

    if master_form_version_id is not None:
        if version is not None:
            raise api_error(
                422,
                "VALIDATION_ERROR",
                "Use either masterFormVersionId or version, not both.",
            )
        entry = require_version(document, version_object_id(master_form_version_id))
        if entry.get("isDeleted", False) and not include_deleted:
            raise api_error(
                404,
                "MASTER_FORM_VERSION_NOT_FOUND",
                "The requested master form version was not found.",
            )
        return (entry, None)

    versions = [
        entry
        for entry in document.get("versions", [])
        if include_deleted or not entry.get("isDeleted", False)
    ]
    if version is not None:
        versions = [entry for entry in versions if entry["version"] == version]
        if not versions:
            raise api_error(
                404,
                "MASTER_FORM_VERSION_NOT_FOUND",
                "The requested master form version was not found.",
            )
    versions.sort(key=lambda entry: entry["version"], reverse=sort_order == "desc")
    total = len(versions)
    page_versions = versions[(page - 1) * limit : page * limit]
    return page_versions, {
        "masterFormId": form_id,
        "page": page,
        "limit": limit,
        "total": total,
        "totalPages": (total + limit - 1) // limit,
    }


async def switch_master_form_version(
    master_form_id: str, master_form_version_id: str
) -> dict[str, Any]:
    """Publish a saved draft version on a draft, published, or archived form.

    Switching only moves ``currentVersion`` and copies the selected snapshot
    into the form definition. No new version is created, no snapshot is
    modified, and no snapshot is removed. The previously active version becomes
    a draft. Publishing a version on a draft or archived form also publishes the
    form.
    """
    form_id = object_id(master_form_id)
    version_id = version_object_id(master_form_version_id)
    actor = actor_object_id()
    collection = get_master_forms_collection()
    current = await collection.find_one({"_id": form_id, "isDeleted": False})
    if current is None:
        raise api_error(404, "MASTER_FORM_NOT_FOUND", "Master form was not found.")
    require_active_version(current)
    source_status = codes_for_validation(current)["status"]
    source = require_version(current, version_id)
    if source.get("isDeleted", False):
        raise api_error(
            404,
            "MASTER_FORM_VERSION_NOT_FOUND",
            "The requested master form version was not found.",
        )
    if source.get("status", "DRAFT") == "ARCHIVED":
        raise api_error(
            409,
            "MASTER_FORM_VERSION_ARCHIVED",
            "An archived version cannot be published. Restore or edit an available draft version.",
        )
    if source["version"] == current["currentVersion"]:
        return current

    try:
        selected = FormDefinition.model_validate(
            codes_for_validation(deepcopy(source["snapshot"]))
        )
    except ValidationError as exc:
        raise api_error(
            422,
            "MASTER_FORM_VALIDATION_FAILED",
            "The selected version snapshot is invalid.",
        ) from exc
    value_references = await load_value_set_references()
    snapshot = references_for_storage(
        selected.model_dump(by_alias=True), value_references
    )

    now = datetime.now(UTC)
    previous_active = require_active_version(current)
    updates: dict[str, Any] = {
        **snapshot,
        "currentVersion": source["version"],
        "versions.$[previous].status": "DRAFT",
        "versions.$[selected].status": "PUBLISHED",
        "updatedBy": actor,
        "updatedAt": now,
    }
    update_document: dict[str, Any] = {"$set": updates}
    if source_status in {"DRAFT", "ARCHIVED"}:
        updates["status"] = reference_for(
            "PUBLISHED", FORM_STATUS, value_references
        )
        update_document["$unset"] = {"lastPublishedSwitch": ""}
    else:
        updates["lastPublishedSwitch"] = {
            "fromVersionId": previous_active["_id"],
            "toVersionId": source["_id"],
        }
    updated = await collection.find_one_and_update(
        {
            "_id": form_id,
            "isDeleted": False,
            "status.code": source_status,
            "currentVersion": current["currentVersion"],
        },
        update_document,
        return_document=ReturnDocument.AFTER,
        array_filters=[
            {"previous._id": previous_active["_id"]},
            {"selected._id": source["_id"]},
        ],
    )
    if updated is None:
        raise api_error(
            409,
            "VERSION_CONFLICT",
            "The form changed during this switch; retrieve it and retry.",
        )
    return updated


async def edit_master_form_version(
    master_form_id: str,
    master_form_version_id: str,
    payload: MasterFormPatch,
) -> dict[str, Any]:
    """Create a new version from an edited snapshot without mutating history."""
    form_id = object_id(master_form_id)
    version_id = version_object_id(master_form_version_id)
    actor = actor_object_id()
    collection = get_master_forms_collection()
    current = await collection.find_one({"_id": form_id, "isDeleted": False})
    if current is None:
        raise api_error(404, "MASTER_FORM_NOT_FOUND", "Master form was not found.")
    require_active_version(current)
    source = require_version(current, version_id)
    if source.get("isDeleted", False):
        raise api_error(
            404,
            "MASTER_FORM_VERSION_NOT_FOUND",
            "The requested master form version was not found.",
        )
    if source.get("status", "DRAFT") == "ARCHIVED":
        raise api_error(
            409,
            "MASTER_FORM_VERSION_ARCHIVED",
            "An archived version cannot be edited.",
        )
    form_status = codes_for_validation(current)["status"]
    if form_status == "PUBLISHED":
        if source["version"] == current["currentVersion"]:
            raise api_error(
                409,
                "PUBLISHED_MASTER_FORM_VERSION",
                "The active published version cannot be edited.",
            )
    elif form_status != "DRAFT":
        raise api_error(
            409,
            "INVALID_MASTER_FORM_STATUS",
            "Only DRAFT forms or saved versions of PUBLISHED forms can be edited.",
        )

    candidate = codes_for_validation(deepcopy(source["snapshot"]))
    candidate.update(
        payload.model_dump(
            exclude_unset=True,
            exclude={"masterFormVersionId"},
            by_alias=True,
        )
    )
    try:
        definition = FormDefinition.model_validate(candidate)
    except ValidationError as exc:
        raise api_error(
            422,
            "VALIDATION_ERROR",
            "The edited version definition is invalid.",
        ) from exc
    stored_snapshot = references_for_storage(
        definition.model_dump(by_alias=True),
        await load_value_set_references(),
    )
    if stored_snapshot == source["snapshot"]:
        return current

    next_version = next_version_number(current)
    now = datetime.now(UTC)
    changes: dict[str, Any] = {
        "$set": {
            "updatedBy": actor,
            "updatedAt": now,
        },
        "$push": {
            "versions": {
                "_id": ObjectId(),
                "version": next_version,
                "status": "DRAFT",
                "snapshot": stored_snapshot,
                "createdBy": actor,
                "createdAt": now,
            }
        },
    }
    if form_status == "DRAFT":
        changes["$set"].update(
            {
                **stored_snapshot,
                "currentVersion": next_version,
            }
        )
    updated = await collection.find_one_and_update(
        {
            "_id": form_id,
            "isDeleted": False,
            "status.code": form_status,
            "currentVersion": current["currentVersion"],
            "versions._id": version_id,
        },
        changes,
        return_document=ReturnDocument.AFTER,
    )
    if updated is None:
        raise api_error(
            409,
            "VERSION_CONFLICT",
            "The form changed while this version was being edited; retrieve it and retry.",
        )
    return updated


async def delete_master_form_version(
    master_form_id: str, master_form_version_id: str
) -> dict[str, Any]:
    """Soft-delete a saved snapshot without removing its data.

    Historical versions must be archived before they can be deleted. On an
    archived form the active version can also be deleted when another version
    remains: the highest remaining version becomes active and its saved
    definition is applied to the form.
    """
    form_id = object_id(master_form_id)
    version_id = version_object_id(master_form_version_id)
    actor = actor_object_id()
    collection = get_master_forms_collection()
    current = await collection.find_one({"_id": form_id, "isDeleted": False})
    if current is None:
        raise api_error(404, "MASTER_FORM_NOT_FOUND", "Master form was not found.")
    require_active_version(current)
    entry = require_version(current, version_id)

    if entry.get("isDeleted", False):
        raise api_error(
            409,
            "MASTER_FORM_VERSION_ALREADY_DELETED",
            "The master form version is already deleted.",
        )

    is_current = entry["version"] == current["currentVersion"]
    if not is_current and entry.get("status", "DRAFT") != "ARCHIVED":
        raise api_error(
            409,
            "MASTER_FORM_VERSION_NOT_ARCHIVED",
            "Archive the version before deleting it.",
        )

    now = datetime.now(UTC)

    if is_current:
        if codes_for_validation(current)["status"] != "ARCHIVED":
            raise api_error(
                409,
                "MASTER_FORM_VERSION_IS_CURRENT",
                "The active version can only be deleted while the form is archived. Archive the form first.",
            )
        remaining = [
            version
            for version in current.get("versions", [])
            if version["_id"] != version_id and not version.get("isDeleted", False)
        ]
        if not remaining:
            raise api_error(
                409,
                "MASTER_FORM_LAST_VERSION",
                "The only saved version cannot be deleted. Create another version first.",
            )
        replacement = max(remaining, key=lambda item: item["version"])
        snapshot = replacement.get("snapshot") or {}
        updates: dict[str, Any] = {
            **{key: deepcopy(snapshot.get(key)) for key in SNAPSHOT_FIELDS},
            "currentVersion": replacement["version"],
            "versions.$[target].isDeleted": True,
            "versions.$[target].deletedBy": actor,
            "versions.$[target].deletedAt": now,
            "updatedBy": actor,
            "updatedAt": now,
        }
        updated = await collection.find_one_and_update(
            {
                "_id": form_id,
                "isDeleted": False,
                "currentVersion": current["currentVersion"],
                "versions": {
                    "$elemMatch": {
                        "_id": version_id,
                        "isDeleted": {"$ne": True},
                    }
                },
            },
            {"$set": updates},
            return_document=ReturnDocument.AFTER,
            array_filters=[{"target._id": version_id}],
        )
        if updated is None:
            raise api_error(
                409,
                "VERSION_CONFLICT",
                "The form changed during this deletion; retrieve it and retry.",
            )
        return updated

    result = await collection.update_one(
        {
            "_id": form_id,
            "isDeleted": False,
            "currentVersion": current["currentVersion"],
            "versions": {
                "$elemMatch": {
                    "_id": version_id,
                    "version": {"$ne": current["currentVersion"]},
                    "isDeleted": {"$ne": True},
                    "status": "ARCHIVED",
                }
            },
        },
        {
            "$set": {
                "versions.$.isDeleted": True,
                "versions.$.deletedBy": actor,
                "versions.$.deletedAt": now,
                "updatedBy": actor,
                "updatedAt": now,
            },
        },
    )
    if result.modified_count != 1:
        raise api_error(
            409,
            "VERSION_CONFLICT",
            "The form changed during this deletion; retrieve it and retry.",
        )
    return await collection.find_one({"_id": form_id})


async def archive_master_form_version(
    master_form_id: str, master_form_version_id: str
) -> dict[str, Any]:
    """Archive one inactive saved version without changing the form status."""
    form_id = object_id(master_form_id)
    version_id = version_object_id(master_form_version_id)
    actor = actor_object_id()
    collection = get_master_forms_collection()
    current = await collection.find_one({"_id": form_id, "isDeleted": False})
    if current is None:
        raise api_error(404, "MASTER_FORM_NOT_FOUND", "Master form was not found.")
    require_active_version(current)
    entry = require_version(current, version_id)

    if entry["version"] == current["currentVersion"]:
        raise api_error(
            409,
            "MASTER_FORM_VERSION_IS_CURRENT",
            "The active version cannot be archived separately. Archive the form through its lifecycle.",
        )
    if entry.get("isDeleted", False):
        raise api_error(
            404,
            "MASTER_FORM_VERSION_NOT_FOUND",
            "The requested master form version was not found.",
        )
    if entry.get("status", "DRAFT") == "ARCHIVED":
        raise api_error(
            409,
            "MASTER_FORM_VERSION_ALREADY_ARCHIVED",
            "The master form version is already archived.",
        )

    now = datetime.now(UTC)
    result = await collection.update_one(
        {
            "_id": form_id,
            "isDeleted": False,
            "currentVersion": current["currentVersion"],
            "versions": {
                "$elemMatch": {
                    "_id": version_id,
                    "version": {"$ne": current["currentVersion"]},
                    "isDeleted": {"$ne": True},
                    "status": {"$ne": "ARCHIVED"},
                }
            },
        },
        {
            "$set": {
                "versions.$.status": "ARCHIVED",
                "versions.$.archivedBy": actor,
                "versions.$.archivedAt": now,
                "updatedBy": actor,
                "updatedAt": now,
            }
        },
    )
    if result.modified_count != 1:
        raise api_error(
            409,
            "VERSION_CONFLICT",
            "The form changed while this version was being archived; retrieve it and retry.",
        )
    return await collection.find_one({"_id": form_id})


async def move_master_form_version_to_draft(
    master_form_id: str, master_form_version_id: str
) -> dict[str, Any]:
    """Move one archived inactive version back to draft."""
    form_id = object_id(master_form_id)
    version_id = version_object_id(master_form_version_id)
    actor = actor_object_id()
    collection = get_master_forms_collection()
    current = await collection.find_one({"_id": form_id, "isDeleted": False})
    if current is None:
        raise api_error(404, "MASTER_FORM_NOT_FOUND", "Master form was not found.")
    require_active_version(current)
    entry = require_version(current, version_id)

    if entry["version"] == current["currentVersion"]:
        raise api_error(
            409,
            "MASTER_FORM_VERSION_IS_CURRENT",
            "Move the whole form to DRAFT through its lifecycle instead.",
        )
    if entry.get("isDeleted", False):
        raise api_error(
            404,
            "MASTER_FORM_VERSION_NOT_FOUND",
            "The requested master form version was not found.",
        )
    if entry.get("status", "DRAFT") != "ARCHIVED":
        raise api_error(
            409,
            "MASTER_FORM_VERSION_NOT_ARCHIVED",
            "Only archived versions can be moved to draft.",
        )

    now = datetime.now(UTC)
    result = await collection.update_one(
        {
            "_id": form_id,
            "isDeleted": False,
            "currentVersion": current["currentVersion"],
            "versions": {
                "$elemMatch": {
                    "_id": version_id,
                    "version": {"$ne": current["currentVersion"]},
                    "isDeleted": {"$ne": True},
                    "status": "ARCHIVED",
                }
            },
        },
        {
            "$set": {
                "versions.$.status": "DRAFT",
                "versions.$.updatedBy": actor,
                "versions.$.updatedAt": now,
                "updatedBy": actor,
                "updatedAt": now,
            },
            "$unset": {
                "versions.$.archivedBy": "",
                "versions.$.archivedAt": "",
            },
        },
    )
    if result.modified_count != 1:
        raise api_error(
            409,
            "VERSION_CONFLICT",
            "The form changed while this version was being moved to draft; retrieve it and retry.",
        )
    return await collection.find_one({"_id": form_id})


async def restore_master_form_version(
    master_form_id: str, master_form_version_id: str
) -> dict[str, Any]:
    """Restore a soft-deleted historical version without making it active."""
    form_id = object_id(master_form_id)
    version_id = version_object_id(master_form_version_id)
    actor = actor_object_id()
    collection = get_master_forms_collection()
    current = await collection.find_one({"_id": form_id, "isDeleted": False})
    if current is None:
        raise api_error(404, "MASTER_FORM_NOT_FOUND", "Master form was not found.")
    require_active_version(current)
    entry = require_version(current, version_id)
    if not entry.get("isDeleted", False):
        raise api_error(
            409,
            "MASTER_FORM_VERSION_NOT_DELETED",
            "The master form version is not deleted.",
        )

    now = datetime.now(UTC)
    result = await collection.update_one(
        {
            "_id": form_id,
            "isDeleted": False,
            "currentVersion": current["currentVersion"],
            "versions": {
                "$elemMatch": {"_id": version_id, "isDeleted": True}
            },
        },
        {
            "$set": {
                "versions.$.isDeleted": False,
                "versions.$.restoredBy": actor,
                "versions.$.restoredAt": now,
                "updatedBy": actor,
                "updatedAt": now,
            },
            "$unset": {
                "versions.$.deletedBy": "",
                "versions.$.deletedAt": "",
            },
        },
    )
    if result.modified_count != 1:
        raise api_error(
            409,
            "VERSION_CONFLICT",
            "The form changed during this restore; retrieve it and retry.",
        )
    return await collection.find_one({"_id": form_id})


async def soft_delete_master_form(
    master_form_id: str
) -> dict[str, Any]:
    form_id = object_id(master_form_id)
    actor = actor_object_id()
    collection = get_master_forms_collection()
    result = await collection.find_one_and_update(
        {
            "_id": form_id,
            "isDeleted": False,
        },
        {
            "$set": {
                "isDeleted": True,
                "updatedBy": actor,
                "updatedAt": datetime.now(UTC),
            }
        },
        return_document=ReturnDocument.AFTER,
    )
    if result is not None:
        return result
    current = await collection.find_one({"_id": form_id})
    if current is None:
        raise api_error(404, "MASTER_FORM_NOT_FOUND", "Master form was not found.")
    if current["isDeleted"]:
        raise api_error(
            409, "MASTER_FORM_ALREADY_DELETED", "The master form is already deleted."
        )
    raise api_error(409, "VERSION_CONFLICT", "The form changed during deletion.")


async def restore_master_form(
    master_form_id: str
) -> dict[str, Any]:
    form_id = object_id(master_form_id)
    actor = actor_object_id()
    collection = get_master_forms_collection()
    current = await collection.find_one({"_id": form_id})
    if current is None:
        raise api_error(404, "MASTER_FORM_NOT_FOUND", "Master form was not found.")
    if not current["isDeleted"]:
        raise api_error(
            409, "MASTER_FORM_ALREADY_RESTORED", "The master form is not deleted."
        )
    duplicate = await collection.find_one(
        {
            "_id": {"$ne": form_id},
            "organizationId": current.get("organizationId"),
            "formCode": current["formCode"],
        }
    )
    if duplicate is not None:
        raise api_error(
            409,
            "MASTER_FORM_ALREADY_EXISTS",
            "Restoring this form would conflict with an existing formCode.",
        )
    result = await collection.find_one_and_update(
        {"_id": form_id, "isDeleted": True},
        {
            "$set": {
                "isDeleted": False,
                "updatedBy": actor,
                "updatedAt": datetime.now(UTC),
            }
        },
        return_document=ReturnDocument.AFTER,
    )
    if result is None:
        raise api_error(
            409, "MASTER_FORM_ALREADY_RESTORED", "The form was restored concurrently."
        )
    return result
