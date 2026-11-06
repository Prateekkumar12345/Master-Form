from datetime import UTC, datetime
from typing import Any

from app.db.session import (
    get_assessments_collection,
    get_clients_collection,
    get_diet_plans_collection,
)
from app.schemas.form_actions import (
    AssessmentSubmissionPayload,
    ClientRegistrationPayload,
    DietPlanRequestPayload,
)
from app.services.master_forms import actor_object_id, public_value


async def register_client(payload: ClientRegistrationPayload) -> dict[str, Any]:
    document = payload.model_dump(mode="json")
    document.update(
        {
            "createdBy": actor_object_id(),
            "createdAt": datetime.now(UTC),
        }
    )
    result = await get_clients_collection().insert_one(document)
    document["_id"] = result.inserted_id
    return public_value(document)


async def submit_assessment(
    payload: AssessmentSubmissionPayload,
) -> dict[str, Any]:
    document = payload.model_dump()
    document.update(
        {
            "status": "SUBMITTED",
            "createdBy": actor_object_id(),
            "createdAt": datetime.now(UTC),
        }
    )
    result = await get_assessments_collection().insert_one(document)
    document["_id"] = result.inserted_id
    return public_value(document)


async def request_diet_plan(
    payload: DietPlanRequestPayload,
) -> dict[str, Any]:
    document = payload.model_dump()
    document.update(
        {
            "status": "PENDING_GENERATION",
            "generationConfigured": False,
            "createdBy": actor_object_id(),
            "createdAt": datetime.now(UTC),
        }
    )
    result = await get_diet_plans_collection().insert_one(document)
    document["_id"] = result.inserted_id
    return public_value(document)
