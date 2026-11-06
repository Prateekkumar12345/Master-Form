from datetime import date
from typing import Literal

from pydantic import Field, SecretStr, field_validator

from app.schemas.master_form import FormSchema

EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"


class LoginPayload(FormSchema):
    email: str = Field(min_length=3, max_length=255, pattern=EMAIL_PATTERN)
    password: SecretStr = Field(min_length=8, max_length=128)

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value: object) -> object:
        return value.strip().lower() if isinstance(value, str) else value


class ClientRegistrationPayload(FormSchema):
    firstName: str = Field(min_length=2, max_length=100)
    lastName: str = Field(min_length=2, max_length=100)
    email: str = Field(min_length=3, max_length=255, pattern=EMAIL_PATTERN)
    phone: str | None = Field(default=None, min_length=7, max_length=20)
    dateOfBirth: date
    gender: Literal["MALE", "FEMALE", "OTHER", "PREFER_NOT_TO_SAY"]

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value: object) -> object:
        return value.strip().lower() if isinstance(value, str) else value

    @field_validator("dateOfBirth")
    @classmethod
    def validate_date_of_birth(cls, value: date) -> date:
        if value > date.today():
            raise ValueError("dateOfBirth cannot be in the future")
        return value


class AssessmentSubmissionPayload(FormSchema):
    age: int = Field(ge=1, le=120)
    dietPreference: Literal["VEGETARIAN", "NON_VEGETARIAN"] | None = None


class DietPlanRequestPayload(FormSchema):
    clientId: str = Field(min_length=1, max_length=100)
    planName: str = Field(min_length=2, max_length=100)
    goal: Literal["WEIGHT_LOSS", "MUSCLE_GAIN", "MAINTENANCE"]
    calorieTarget: int = Field(ge=800, le=5000)
    durationWeeks: int | None = Field(default=None, ge=1, le=52)
