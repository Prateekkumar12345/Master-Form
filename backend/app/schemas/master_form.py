from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class FormSchema(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class ValidationRules(FormSchema):
    min: int | float | None = None
    max: int | float | None = None
    minLength: int | None = Field(default=None, ge=0)
    maxLength: int | None = Field(default=None, ge=0)
    minItems: int | None = Field(default=None, ge=0)
    maxItems: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def validate_ranges(self) -> "ValidationRules":
        if self.min is not None and self.max is not None and self.min > self.max:
            raise ValueError("validation.min cannot be greater than validation.max")
        if (
            self.minLength is not None
            and self.maxLength is not None
            and self.minLength > self.maxLength
        ):
            raise ValueError(
                "validation.minLength cannot be greater than validation.maxLength"
            )
        if (
            self.minItems is not None
            and self.maxItems is not None
            and self.minItems > self.maxItems
        ):
            raise ValueError(
                "validation.minItems cannot be greater than validation.maxItems"
            )
        return self


class FieldOption(FormSchema):
    value: str
    label: str


class FormField(FormSchema):
    fieldCode: str = Field(min_length=1)
    label: str = Field(min_length=1)
    type: Literal[
        "INPUT",
        "NUMBER",
        "TEXTAREA",
        "DATE",
        "CHECKBOX",
        "SELECT",
        "MULTISELECT",
    ]
    dataType: Literal["STRING", "NUMBER", "BOOLEAN", "DATE", "DATETIME"]
    isRequired: bool
    isEnabled: bool
    displayOrder: int = Field(ge=0)
    placeholder: str | None = None
    defaultValue: Any = None
    validation: ValidationRules | None = None
    options: list[FieldOption] | None = None
    optionsDisplayType: Literal["DROPDOWN", "RADIO", "CHECKBOXES"] | None = None

    @model_validator(mode="after")
    def validate_option_display_type(self) -> "FormField":
        if self.type == "SELECT" and self.optionsDisplayType == "CHECKBOXES":
            raise ValueError("SELECT fields cannot use checkbox options.")
        if self.type == "MULTISELECT" and self.optionsDisplayType == "RADIO":
            raise ValueError("MULTISELECT fields cannot use radio options.")
        if self.type not in ("SELECT", "MULTISELECT") and self.optionsDisplayType:
            raise ValueError(
                "optionsDisplayType is only valid for SELECT and MULTISELECT fields."
            )
        return self


class FormSection(FormSchema):
    sectionCode: str = Field(min_length=1)
    title: str = Field(min_length=1)
    displayOrder: int = Field(ge=0)
    fields: list[FormField]


class PayloadMapping(FormSchema):
    targetField: str = Field(min_length=1)
    sourceType: str = Field(min_length=1)
    sourceFieldCode: str = Field(min_length=1)
    required: bool


class ButtonRequest(FormSchema):
    endpoint: str | None = None
    httpMethod: Literal["GET", "POST", "PUT", "PATCH", "DELETE"] | None = None
    contentType: str | None = None
    pathParams: dict[str, Any] = Field(default_factory=dict)
    queryParams: dict[str, Any] = Field(default_factory=dict)
    payloadMapping: list[PayloadMapping] = Field(default_factory=list)


class ResponseAction(FormSchema):
    navigateTo: str | None = None
    responseMessage: str | None = None


class ResponseHandling(FormSchema):
    successStatusCodes: list[int] = Field(
        default_factory=list,
        description="HTTP response codes treated as success; an empty list accepts any 2xx response.",
    )
    failureStatusCodes: list[int] = Field(
        default_factory=list,
        description="HTTP response codes treated as failure in addition to non-2xx responses.",
    )
    onSuccess: ResponseAction = Field(default_factory=ResponseAction)
    onFailure: ResponseAction = Field(default_factory=ResponseAction)


class FormButton(FormSchema):
    ButtonCode: str = Field(min_length=1)
    Buttonlabel: str = Field(min_length=1)
    description: str | None = None
    executionType: Literal["API", "REACT_ROUTE", "CLIENT_ACTION"]
    displayOrder: int = Field(ge=0)
    isEnabled: bool
    request: ButtonRequest | None = None
    responseHandling: ResponseHandling = Field(default_factory=ResponseHandling)

    @model_validator(mode="after")
    def validate_api_request(self) -> "FormButton":
        if self.executionType == "API" and (
            self.request is None
            or not self.request.endpoint
            or not self.request.httpMethod
        ):
            raise ValueError(
                "API buttons require request.endpoint and request.httpMethod"
            )
        return self


class FormDefinition(FormSchema):
    name: str = Field(min_length=1)
    description: str | None = None
    formType: Literal[
        "ASSESSMENT",
        "REGISTRATION",
        "DIET_PLAN",
        "MEDICAL_HISTORY",
        "BODY_MEASUREMENT",
        "LOGIN",
        "CUSTOM",
    ]
    title: str = Field(min_length=1)
    layout: Literal["SINGLE_PAGE", "WIZARD", "TABS", "ACCORDION"]
    Buttons: list[FormButton]
    sections: list[FormSection]

    @model_validator(mode="after")
    def validate_unique_codes(self) -> "FormDefinition":
        section_codes = [section.sectionCode for section in self.sections]
        if len(section_codes) != len(set(section_codes)):
            raise ValueError("sectionCode values must be unique within a form")

        field_codes = [
            field.fieldCode
            for section in self.sections
            for field in section.fields
        ]
        if len(field_codes) != len(set(field_codes)):
            raise ValueError("fieldCode values must be unique within a form")

        button_codes = [button.ButtonCode for button in self.Buttons]
        if len(button_codes) != len(set(button_codes)):
            raise ValueError("ButtonCode values must be unique within a form")

        known_field_codes = set(field_codes)
        for button in self.Buttons:
            if button.request is None:
                continue
            for mapping in button.request.payloadMapping:
                if (
                    mapping.sourceType == "FORM_FIELD"
                    and mapping.sourceFieldCode not in known_field_codes
                ):
                    raise ValueError(
                        f"Unknown sourceFieldCode: {mapping.sourceFieldCode}"
                    )
        return self


class MasterFormCreate(FormSchema):
    organizationId: str | None = Field(
        default=None,
        description="24-character MongoDB ObjectId; null means a global form.",
    )
    formCode: str = Field(min_length=1)
    name: str = Field(min_length=1)
    description: str | None = None
    formType: Literal[
        "ASSESSMENT",
        "REGISTRATION",
        "DIET_PLAN",
        "MEDICAL_HISTORY",
        "BODY_MEASUREMENT",
        "LOGIN",
        "CUSTOM",
    ]
    status: Literal["DRAFT"] = "DRAFT"
    title: str = Field(min_length=1)
    layout: Literal["SINGLE_PAGE", "WIZARD", "TABS", "ACCORDION"]
    Buttons: list[FormButton]
    sections: list[FormSection]

    @field_validator("formCode", mode="before")
    @classmethod
    def normalize_form_code(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @model_validator(mode="after")
    def validate_form_definition(self) -> "MasterFormCreate":
        FormDefinition.model_validate(
            {
                "name": self.name,
                "description": self.description,
                "formType": self.formType,
                "title": self.title,
                "layout": self.layout,
                "Buttons": self.Buttons,
                "sections": self.sections,
            }
        )
        return self


CONFIG_FIELDS = frozenset(
    {"name", "description", "formType", "title", "layout", "Buttons", "sections"}
)


class MasterFormPatch(FormSchema):
    """PATCH payload for current configuration, a saved version, or status."""

    masterFormVersionId: str | None = Field(
        default=None,
        description=(
            "Saved version ObjectId to reopen as a draft, or optionally the "
            "active published version ID when archiving a published form."
        ),
    )
    name: str | None = Field(default=None, min_length=1)
    description: str | None = None
    formType: Literal[
        "ASSESSMENT",
        "REGISTRATION",
        "DIET_PLAN",
        "MEDICAL_HISTORY",
        "BODY_MEASUREMENT",
        "LOGIN",
        "CUSTOM",
    ] | None = None
    title: str | None = Field(default=None, min_length=1)
    layout: Literal["SINGLE_PAGE", "WIZARD", "TABS", "ACCORDION"] | None = None
    Buttons: list[FormButton] | None = None
    sections: list[FormSection] | None = None
    status: Literal["DRAFT", "PUBLISHED", "ARCHIVED"] | None = Field(
        default=None,
        description=(
            "Target lifecycle status. Status changes and configuration changes "
            "cannot be combined. When reopening a published form as a draft, "
            "masterFormVersionId selects the saved snapshot to reopen. "
            "Archiving a published form does not require a replacement version."
        ),
    )

    @model_validator(mode="after")
    def require_single_operation(self) -> "MasterFormPatch":
        provided = self.model_fields_set
        configuration = provided & CONFIG_FIELDS
        if not provided:
            raise ValueError(
                "At least one configuration property, version selector, or status "
                "must be provided"
            )
        if "status" in provided:
            if self.status is None:
                raise ValueError("status cannot be null")
            if configuration:
                raise ValueError(
                    "Provide a status change or configuration changes, not both"
                )
            if "masterFormVersionId" in provided:
                if self.status not in {"DRAFT", "ARCHIVED"} or not self.masterFormVersionId:
                    raise ValueError(
                        "A non-empty masterFormVersionId may only accompany a "
                        "transition to DRAFT or ARCHIVED"
                    )
        elif "masterFormVersionId" in provided:
            if not self.masterFormVersionId:
                raise ValueError("masterFormVersionId cannot be empty")
            if not configuration:
                raise ValueError(
                    "Editing a saved version requires at least one configuration property"
                )
        return self


class MasterFormVersionStatusPatch(FormSchema):
    """Target lifecycle status for one saved master form version."""

    status: Literal["DRAFT", "PUBLISHED", "ARCHIVED"] = Field(
        description=(
            "Target status for this saved version. PUBLISHED activates it on a "
            "draft or published form; ARCHIVED and DRAFT change only an inactive "
            "version."
        )
    )
