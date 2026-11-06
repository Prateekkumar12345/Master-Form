from fastapi import APIRouter, HTTPException, status

from app.schemas.form_actions import (
    AssessmentSubmissionPayload,
    ClientRegistrationPayload,
    DietPlanRequestPayload,
    LoginPayload,
)
from app.services import form_actions as service
from app.services.master_forms import envelope

router = APIRouter()


@router.post(
    "/assessments/submit",
    status_code=status.HTTP_201_CREATED,
    tags=["ASSESSMENT"],
    summary="ASSESSMENT - Submit assessment",
    description=(
        "Stores the submitted assessment in `Profentra.Assessments` with "
        "`SUBMITTED` status and audit fields. Testing example: "
        '`{"age":32,"dietPreference":"VEGETARIAN"}`.'
    ),
)
async def submit_assessment_form(payload: AssessmentSubmissionPayload) -> dict:
    return envelope(
        await service.submit_assessment(payload),
        status_code=status.HTTP_201_CREATED,
        message="Assessment submitted successfully.",
    )


@router.post(
    "/clients",
    status_code=status.HTTP_201_CREATED,
    tags=["REGISTRATION"],
    summary="REGISTRATION - Register client",
    description=(
        "Stores the client registration in `Profentra.Clients`; credentials "
        "are not accepted or stored. Testing requires firstName, lastName, "
        "email, dateOfBirth (YYYY-MM-DD), and gender."
    ),
)
async def submit_client_registration(payload: ClientRegistrationPayload) -> dict:
    return envelope(
        await service.register_client(payload),
        status_code=status.HTTP_201_CREATED,
        message="Client registered successfully.",
    )


@router.post(
    "/diet-plans/generate",
    status_code=status.HTTP_202_ACCEPTED,
    tags=["DIET_PLAN"],
    summary="DIET_PLAN - Request diet-plan generation",
    description=(
        "Stores a pending request in `Profentra.Diet_Plans`. Generation is not "
        "configured; the response marks it `PENDING_GENERATION`. Testing "
        "requires clientId, planName, goal, and calorieTarget."
    ),
)
async def submit_diet_plan_request(payload: DietPlanRequestPayload) -> dict:
    return envelope(
        await service.request_diet_plan(payload),
        status_code=status.HTTP_202_ACCEPTED,
        message="Diet plan request accepted for processing.",
    )


@router.post(
    "/auth/login",
    status_code=status.HTTP_501_NOT_IMPLEMENTED,
    tags=["LOGIN"],
    summary="LOGIN - Authenticate (not configured)",
    description=(
        "This route is referenced by the stored login form, but authentication "
        "is not configured. It validates the email/password payload and returns "
        "`501 AUTHENTICATION_NOT_CONFIGURED`; credentials are never stored."
    ),
    responses={
        501: {"description": "Authentication has not been configured."},
    },
)
async def login(_payload: LoginPayload) -> None:
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail={
            "code": "AUTHENTICATION_NOT_CONFIGURED",
            "message": "Configure an account store and authentication policy before enabling login.",
        },
    )
