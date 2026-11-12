from typing import Annotated, Literal

from fastapi import APIRouter, Query, status

from app.schemas.master_form import (
    MasterFormCreate,
    MasterFormPatch,
    MasterFormVersionStatusPatch,
)
from app.services import master_forms as service

router = APIRouter(prefix="/master-forms", tags=["master-forms"])


def developer_metadata(example: str) -> str:
    return (
        "### Developer metadata\n\n"
        "- **MongoDB target:** `Profentra.Master_Forms`\n"
        "- **Audit actor:** loaded from `DEFAULT_ACTOR_ID` in backend `.env`; "
        "no actor header or body field is required.\n"
        "- **Authentication:** not implemented in this scaffold; add "
        "authentication and authorization before deployment.\n\n"
        "### Example request\n\n"
        "```bash\n"
        f"{example}\n"
        "```"
    )


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    summary="Create a master form",
    response_description="The new form and its initial immutable version 1 snapshot.",
    description=(
        "Creates a master form and its initial immutable version. Request field "
        "order: organizationId, formCode, name, description, formType, status, "
        "title, layout, Buttons, sections. Send controlled enum codes; the "
        "backend stores them as value-set references. `_id`, `documentType`, "
        "`currentVersion`, `versions`, audit fields, and `isDeleted` are "
        "server-managed. New forms default to DRAFT.\n\n"
        + developer_metadata(
            """curl.exe -X POST http://localhost:8000/api/v1/master-forms -H "Content-Type: application/json" -d '{"organizationId":null,"formCode":"NUTRITION_ASSESSMENT","name":"Client Nutrition Assessment","description":"Collects client nutrition and lifestyle information.","formType":"ASSESSMENT","status":"DRAFT","title":"Nutrition Assessment","layout":"WIZARD","Buttons":[],"sections":[]}'"""
        )
    ),
    responses={
        201: {"description": "Form created with version 1."},
        409: {"description": "A form with this formCode already exists."},
        422: {"description": "The form configuration is invalid."},
    },
)
async def create_master_form(payload: MasterFormCreate) -> dict:
    data = await service.create_master_form(payload)
    return service.envelope(
        data,
        status_code=status.HTTP_201_CREATED,
        message="Master form created successfully.",
    )


@router.get(
    "",
    summary="List master forms",
    response_description="A paginated list without version snapshots.",
    description=(
        "Lists master forms with optional organizationId, formCode, formType, "
        "status, name search, pagination, and sorting. By default only "
        "non-deleted forms are returned: pass isDeleted=true for soft-deleted "
        "forms only, or includeDeleted=true for both deleted and non-deleted "
        "forms. Version history is omitted from list results.\n\n"
        + developer_metadata(
            'curl.exe "http://localhost:8000/api/v1/master-forms?formType=ASSESSMENT&status=PUBLISHED&page=1&limit=10"'
        )
    ),
    responses={
        200: {"description": "Matching forms and pagination metadata."},
        400: {"description": "A filter or query parameter is invalid."},
    },
)
async def get_all_master_forms(
    organization_id: Annotated[
        str | None,
        Query(alias="organizationId", description="Organization ObjectId filter."),
    ] = None,
    form_code: Annotated[str | None, Query(alias="formCode")] = None,
    form_type: Annotated[
        Literal[
            "ASSESSMENT",
            "REGISTRATION",
            "DIET_PLAN",
            "MEDICAL_HISTORY",
            "BODY_MEASUREMENT",
            "LOGIN",
            "CUSTOM",
        ]
        | None,
        Query(alias="formType"),
    ] = None,
    form_status: Annotated[
        Literal["DRAFT", "PUBLISHED", "ARCHIVED"] | None,
        Query(alias="status"),
    ] = None,
    name: Annotated[str | None, Query(description="Case-insensitive name substring.")] = None,
    is_deleted: Annotated[
        bool,
        Query(
            alias="isDeleted",
            description="Filter by soft-deletion flag; defaults to false.",
        ),
    ] = False,
    include_deleted: Annotated[
        bool,
        Query(
            alias="includeDeleted",
            description=(
                "Return both deleted and non-deleted forms; overrides isDeleted."
            ),
        ),
    ] = False,
    page: Annotated[int, Query(ge=1, description="1-based page number.")] = 1,
    limit: Annotated[int, Query(ge=1, le=100, description="Page size, maximum 100.")] = 20,
    sort_by: Annotated[
        Literal["name", "createdAt", "updatedAt", "formCode", "formType", "status"],
        Query(alias="sortBy"),
    ] = "updatedAt",
    sort_order: Annotated[
        Literal["asc", "desc"],
        Query(alias="sortOrder", description="Sort direction."),
    ] = "desc",
) -> dict:
    data, meta = await service.list_master_forms(
        organization_id=organization_id,
        form_code=form_code,
        form_type=form_type,
        status=form_status,
        name=name,
        page=page,
        limit=limit,
        sort_by=sort_by,
        sort_order=sort_order,
        is_deleted=is_deleted,
        include_deleted=include_deleted,
    )
    return service.envelope(
        data, meta, message="Master forms retrieved successfully."
    )


@router.get(
    "/{masterFormId}",
    summary="Get a master form",
    response_description="The current form definition; optionally includes versions.",
    description=(
        "Retrieves a form by its 24-character MongoDB ObjectId. Soft-deleted "
        "forms are excluded unless includeDeleted=true. Set includeVersions=true "
        "to include immutable version history. Controlled values are returned as "
        "`{valueSetId, code}` references.\n\n"
        + developer_metadata(
            'curl.exe "http://localhost:8000/api/v1/master-forms/6ae436c49f91d4bde87c9ac4?includeVersions=true"'
        )
    ),
    responses={
        200: {"description": "Form found."},
        400: {"description": "The supplied ID is not a valid ObjectId."},
        404: {
            "description": (
                "Form not found or soft-deleted; pass includeDeleted=true to "
                "retrieve a soft-deleted form."
            )
        },
    },
)
async def get_master_form_by_id(
    masterFormId: str,
    include_versions: Annotated[
        bool, Query(alias="includeVersions", description="Include version snapshots.")
    ] = False,
    include_deleted: Annotated[
        bool,
        Query(
            alias="includeDeleted",
            description="Include a soft-deleted form.",
        ),
    ] = False,
) -> dict:
    data = await service.get_master_form(
        masterFormId, include_versions, include_deleted
    )
    return service.envelope(data, message="Master form retrieved successfully.")


@router.patch(
    "/{masterFormId}",
    summary="Update a master form",
    response_description="The updated form with its currentVersion and status.",
    description=(
        "Handles configuration changes, saved-version edits, and lifecycle "
        "transitions. Send either `status` alone or configuration properties. "
        "To edit a specific saved snapshot, include its `masterFormVersionId` "
        "with the configuration properties to change.\n\n"
        "**Configuration changes** on a DRAFT form update its active definition "
        "and create a new active version. On a PUBLISHED form, they create a "
        "new saved DRAFT version without changing the published definition or "
        "currentVersion. A no-op creates no version.\n\n"
        "**Saved-version edits** start from the selected snapshot, preserve it, "
        "and create a new version. For a DRAFT form, the new version becomes "
        "active. On a PUBLISHED form, only a non-active version can be edited; "
        "the new version remains inactive and the published definition does not "
        "change. A configuration-only PATCH on a PUBLISHED form also creates a "
        "new inactive DRAFT version based on its published definition. Reopen "
        "an ARCHIVED form as DRAFT first.\n\n"
        "**Status transitions** follow this matrix:\n\n"
        "| From | To | Behavior |\n"
        "|---|---|---|\n"
        "| DRAFT | PUBLISHED | Validate and publish the active version; no new version |\n"
        "| DRAFT | ARCHIVED | Archive the form; no new version |\n"
        "| PUBLISHED | ARCHIVED | Archive the active published version; no replacement version is required |\n"
        "| PUBLISHED | DRAFT | Reopen a selected saved version for editing; no new version |\n"
        "| ARCHIVED | DRAFT | Reopen for editing; no new version |\n"
        "| ARCHIVED | PUBLISHED | Rejected through this endpoint; publish a saved version to make the form PUBLISHED |\n\n"
        "When reopening a PUBLISHED form with multiple versions as DRAFT, "
        "include `masterFormVersionId` to choose which saved snapshot becomes "
        "the active draft. The previously published version remains unchanged "
        "in history. If there is only one saved version, the selector is optional.\n\n"
        "A PUBLISHED form can be archived directly with `status: ARCHIVED`; "
        "no replacement version is required. The currently active published "
        "version is archived with the form. For compatibility, "
        "`masterFormVersionId` may be included only if it identifies that "
        "active published version.\n\n"
        "Requesting the status a form already holds is rejected with 409. "
        "Soft-deleted forms are not affected.\n\n"
        + developer_metadata(
            """curl.exe -X PATCH http://localhost:8000/api/v1/master-forms/6ae436c49f91d4bde87c9ac4 -H "Content-Type: application/json" -d '{"title":"Updated Nutrition Assessment","description":"Updated form description."}'"""
            + "\n\n"
            + """curl.exe -X PATCH http://localhost:8000/api/v1/master-forms/6ae436c49f91d4bde87c9ac4 -H "Content-Type: application/json" -d '{"status":"PUBLISHED"}'"""
            + "\n\n"
            + """curl.exe -X PATCH http://localhost:8000/api/v1/master-forms/6ae436c49f91d4bde87c9ac4 -H "Content-Type: application/json" -d '{"status":"DRAFT","masterFormVersionId":"6ae436c49f91d4bde87c9ac5"}'"""
            + "\n\n"
            + """curl.exe -X PATCH http://localhost:8000/api/v1/master-forms/6ae436c49f91d4bde87c9ac4 -H "Content-Type: application/json" -d '{"masterFormVersionId":"6ae436c49f91d4bde87c9ac5","title":"Revised title"}'"""
        )
    ),
    responses={
        200: {"description": "Form updated, or status transitioned."},
        400: {"description": "masterFormVersionId is not a valid ObjectId."},
        404: {"description": "Form not found or soft-deleted."},
        409: {
            "description": (
                "The selected version cannot be edited or reopened in the current "
                "lifecycle state, a version must be selected, the requested "
                "transition is not allowed, the status is unchanged, or a "
                "concurrent update occurred."
            )
        },
        422: {
            "description": (
                "The payload is empty or combines incompatible operations, or "
                "the resulting definition is invalid, or the version selector "
                "is used with an unsupported operation."
            )
        },
    },
)
async def update_master_form(masterFormId: str, payload: MasterFormPatch) -> dict:
    data = await service.update_master_form(masterFormId, payload)
    return service.envelope(data, message="Master form updated successfully.")


@router.get(
    "/{masterFormId}/versions",
    summary="Get master form versions",
    response_description=(
        "One version snapshot when masterFormVersionId is supplied, otherwise "
        "version snapshots and pagination metadata."
    ),
    description=(
        "Without `masterFormVersionId`, returns immutable snapshots ordered by "
        "version number. Use `version` to filter to one version number, or "
        "paginate the history with page/limit/sortOrder.\n\n"
        "Soft-deleted versions are excluded by default. Set `includeDeleted=true` "
        "to include them so they can be restored.\n\n"
        "With `masterFormVersionId`, returns that single snapshot exactly as "
        "stored; pagination and sorting are ignored. `masterFormVersionId` is the "
        "version entry's `_id`, and cannot be combined with the `version` number "
        "filter. The form must exist; its history stays readable after the form "
        "is soft-deleted so saved versions can still be reviewed.\n\n"
        + developer_metadata(
            'curl.exe "http://localhost:8000/api/v1/master-forms/6ae436c49f91d4bde87c9ac4/versions?page=1&limit=20"'
            + "\n\n"
            + 'curl.exe "http://localhost:8000/api/v1/master-forms/6ae436c49f91d4bde87c9ac4/versions?masterFormVersionId=6ae436c49f91d4bde87c9ac5"'
        )
    ),
    responses={
        200: {"description": "Matching version history or the requested snapshot."},
        400: {"description": "A supplied ID is not a valid ObjectId."},
        404: {"description": "Form or requested version not found."},
        409: {"description": "The form does not have exactly one active saved version."},
        422: {
            "description": (
                "masterFormVersionId and version were supplied together."
            )
        },
    },
)
async def get_master_form_versions(
    masterFormId: str,
    master_form_version_id: Annotated[
        str | None,
        Query(
            alias="masterFormVersionId",
            description=(
                "Optional version ObjectId. Returns only that snapshot; cannot be "
                "combined with version."
            ),
        ),
    ] = None,
    include_deleted: Annotated[
        bool,
        Query(
            alias="includeDeleted",
            description="Include soft-deleted version snapshots.",
        ),
    ] = False,
    version: Annotated[
        int | None,
        Query(ge=1, description="Optional exact version number filter."),
    ] = None,
    sort_order: Annotated[
        Literal["asc", "desc"], Query(alias="sortOrder")
    ] = "desc",
    page: Annotated[int, Query(ge=1)] = 1,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> dict:
    data, meta = await service.get_master_form_versions(
        masterFormId,
        master_form_version_id=master_form_version_id,
        include_deleted=include_deleted,
        version=version,
        sort_order=sort_order,
        page=page,
        limit=limit,
    )
    return service.envelope(
        data, meta, message="Master form versions retrieved successfully."
    )


@router.patch(
    "/{masterFormId}/versions/{masterFormVersionId}",
    summary="Update a saved master form version lifecycle status",
    response_description="The selected version has the requested lifecycle status.",
    description=(
        "Sets the selected saved version's lifecycle status. Use "
        "`{\"status\":\"PUBLISHED\"}` to activate and publish a saved draft "
        "version on a DRAFT, PUBLISHED, or ARCHIVED form. This also publishes a "
        "DRAFT or ARCHIVED form; the previously active version becomes draft. "
        "Use "
        "`{\"status\":\"ARCHIVED\"}` to archive only an inactive "
        "version, or `{\"status\":\"DRAFT\"}` to move an archived inactive "
        "version back to draft. The last two operations do not change the "
        "master form status or active version. The active version is managed "
        "through the master form lifecycle.\n\n"
        + developer_metadata(
            'curl.exe -X PATCH http://localhost:8000/api/v1/master-forms/'
            "6ae436c49f91d4bde87c9ac4/versions/6ae436c49f91d4bde87c9ac5 "
            '-H "Content-Type: application/json" -d \'{"status":"PUBLISHED"}\''
        )
    ),
    responses={
        200: {"description": "The selected version status was updated."},
        400: {"description": "A supplied ID is not a valid ObjectId."},
        404: {"description": "Form or version not found, or the form is soft-deleted."},
        409: {
            "description": (
                "The requested version status transition is not allowed, the "
                "version is current, or a concurrent update occurred."
            )
        },
        422: {"description": "The selected version snapshot or request is invalid."},
    },
)
async def update_master_form_version_status(
    masterFormId: str,
    masterFormVersionId: str,
    payload: MasterFormVersionStatusPatch,
) -> dict:
    if payload.status == "PUBLISHED":
        data = await service.switch_master_form_version(
            masterFormId, masterFormVersionId
        )
    elif payload.status == "ARCHIVED":
        data = await service.archive_master_form_version(
            masterFormId, masterFormVersionId
        )
    else:
        data = await service.move_master_form_version_to_draft(
            masterFormId, masterFormVersionId
        )
    return service.envelope(
        data, message="Master form version updated successfully."
    )


@router.delete(
    "/{masterFormId}/versions/{masterFormVersionId}",
    summary="Delete a master form version",
    response_description="The soft-deleted snapshot and the resulting active version.",
    description=(
        "Soft-deletes an archived snapshot from a form in any lifecycle status. "
        "Archive a historical version first. On an archived form the active "
        "version can also be deleted when another version remains: the highest "
        "remaining version becomes active and its saved definition is applied to "
        "the form. The only remaining version cannot be deleted. "
        "Version numbers and snapshot data are retained. "
        "Deleted snapshots are hidden from version history by default; use "
        "`includeDeleted=true` to view and restore them.\n\n"
        + developer_metadata(
            "curl.exe -X DELETE "
            "http://localhost:8000/api/v1/master-forms/6ae436c49f91d4bde87c9ac4/"
            "versions/6ae436c49f91d4bde87c9ac5"
        )
    ),
    responses={
        200: {"description": "Version soft-deleted."},
        400: {"description": "A supplied ID is not a valid ObjectId."},
        404: {"description": "Form or version not found, or the form is soft-deleted."},
        409: {
            "description": (
                "The version is not archived or already deleted, the active version "
                "is the only saved version or the form is not archived, the active "
                "version is invalid, or a concurrent update occurred."
            )
        },
    },
)
async def delete_master_form_version(
    masterFormId: str, masterFormVersionId: str
) -> dict:
    data = await service.delete_master_form_version(
        masterFormId, masterFormVersionId
    )
    return service.envelope(
        data, message="Master form version deleted successfully."
    )


@router.post(
    "/{masterFormId}/versions/{masterFormVersionId}/restore",
    summary="Restore a deleted master form version",
    response_description="The restored snapshot; currentVersion is unchanged.",
    description=(
        "Restores a soft-deleted historical version in any lifecycle status. "
        "The version is restored as inactive; this does not change currentVersion.\n\n"
        + developer_metadata(
            "curl.exe -X POST "
            "http://localhost:8000/api/v1/master-forms/6ae436c49f91d4bde87c9ac4/"
            "versions/6ae436c49f91d4bde87c9ac5/restore"
        )
    ),
    responses={
        200: {"description": "Version restored."},
        400: {"description": "A supplied ID is not a valid ObjectId."},
        404: {"description": "Form or version not found, or the form is soft-deleted."},
        409: {"description": "The version is not deleted or a concurrent update occurred."},
    },
)
async def restore_master_form_version(
    masterFormId: str, masterFormVersionId: str
) -> dict:
    data = await service.restore_master_form_version(
        masterFormId, masterFormVersionId
    )
    return service.envelope(
        data, message="Master form version restored successfully."
    )


@router.delete(
    "/{masterFormId}",
    summary="Soft-delete a master form",
    response_description="The soft-deleted form; history remains stored.",
    description=(
        "Sets isDeleted=true without physically removing the document, regardless "
        "of lifecycle status. Standard get/list/version operations then exclude "
        "it.\n\n"
        + developer_metadata(
            "curl.exe -X DELETE "
            "http://localhost:8000/api/v1/master-forms/6ae436c49f91d4bde87c9ac4"
        )
    ),
    responses={
        200: {"description": "Form soft-deleted."},
        404: {"description": "Form not found."},
        409: {"description": "Form is already deleted or changed concurrently."},
    },
)
async def soft_delete_master_form(masterFormId: str) -> dict:
    data = await service.soft_delete_master_form(masterFormId)
    return service.envelope(data, message="Master form deleted successfully.")


@router.post(
    "/{masterFormId}/restore",
    summary="Restore a soft-deleted master form",
    response_description="The restored form; lifecycle status is unchanged.",
    description=(
        "Restores a soft-deleted document after checking formCode uniqueness. "
        "Restoration does not change lifecycle status or create a version.\n\n"
        + developer_metadata(
            "curl.exe -X POST "
            "http://localhost:8000/api/v1/master-forms/6ae436c49f91d4bde87c9ac4/restore"
        )
    ),
    responses={
        200: {"description": "Form restored."},
        404: {"description": "Form not found."},
        409: {"description": "Already restored or formCode uniqueness conflict."},
    },
)
async def restore_master_form(masterFormId: str) -> dict:
    data = await service.restore_master_form(masterFormId)
    return service.envelope(data, message="Master form restored successfully.")
