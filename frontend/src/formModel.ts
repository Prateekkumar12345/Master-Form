import type {
  DataType,
  DraftButton,
  DraftField,
  DraftSection,
  ExecutionType,
  FieldOption,
  FieldType,
  FormDraft,
  FormField,
  FormLayout,
  FormType,
  HttpMethod,
  MasterForm,
  OptionDisplayType,
  ResponseHandling,
  RuleReference,
  ValidationRules,
  VersionEntry,
} from "./types";
import { codeOf, uniqueCode } from "./utils";

export const FORM_TYPE_OPTIONS: { value: FormType; label: string }[] = [
  { value: "CUSTOM", label: "General form" },
  { value: "ASSESSMENT", label: "Assessment" },
  { value: "REGISTRATION", label: "Registration" },
  { value: "DIET_PLAN", label: "Diet plan" },
  { value: "MEDICAL_HISTORY", label: "Medical history" },
  { value: "BODY_MEASUREMENT", label: "Body measurements" },
  { value: "LOGIN", label: "Login" },
];

export const LAYOUT_OPTIONS: { value: FormLayout; label: string }[] = [
  { value: "SINGLE_PAGE", label: "One page" },
  { value: "WIZARD", label: "Step by step" },
  { value: "TABS", label: "Tabs" },
  { value: "ACCORDION", label: "Expandable groups" },
];

export const FIELD_TYPE_OPTIONS: {
  value: FieldType;
  label: string;
  dataType: DataType;
}[] = [
  { value: "INPUT", label: "Short answer", dataType: "STRING" },
  { value: "NUMBER", label: "Number", dataType: "NUMBER" },
  { value: "TEXTAREA", label: "Long answer", dataType: "STRING" },
  { value: "SELECT", label: "Choose one", dataType: "STRING" },
  { value: "MULTISELECT", label: "Choose several", dataType: "STRING" },
  { value: "CHECKBOX", label: "Yes / no", dataType: "BOOLEAN" },
  { value: "DATE", label: "Date", dataType: "DATE" },
];

export const DATA_TYPE_OPTIONS: { value: DataType; label: string }[] = [
  { value: "STRING", label: "String" },
  { value: "NUMBER", label: "Number" },
  { value: "BOOLEAN", label: "Boolean" },
  { value: "DATE", label: "Date only" },
  { value: "DATETIME", label: "Date and time" },
];

const VALUE_TYPES_BY_DATA_TYPE: Record<DataType, FieldType[]> = {
  STRING: ["INPUT", "TEXTAREA", "SELECT", "MULTISELECT"],
  NUMBER: ["NUMBER"],
  BOOLEAN: ["CHECKBOX"],
  DATE: ["DATE"],
  DATETIME: ["DATE"],
};

export function valueTypeOptionsFor(dataType: DataType): typeof FIELD_TYPE_OPTIONS {
  return VALUE_TYPES_BY_DATA_TYPE[dataType]
    .map((value) => FIELD_TYPE_OPTIONS.find((option) => option.value === value))
    .filter(
      (option): option is (typeof FIELD_TYPE_OPTIONS)[number] =>
        option !== undefined,
    );
}

export function defaultValueTypeFor(dataType: DataType): FieldType {
  return VALUE_TYPES_BY_DATA_TYPE[dataType][0] ?? "INPUT";
}

export const EXECUTION_TYPE_OPTIONS: {
  value: ExecutionType;
  label: string;
}[] = [
  { value: "API", label: "API" },
  { value: "REACT_ROUTE", label: "REACT_ROUTE" },
  { value: "CLIENT_ACTION", label: "CLIENT_ACTION" },
];

export const HTTP_METHOD_OPTIONS: HttpMethod[] = [
  "POST",
  "GET",
  "PUT",
  "PATCH",
  "DELETE",
];

export const HTTP_SUCCESS_STATUS_OPTIONS = [
  { value: 200, label: "200 — OK: Request succeeded" },
  { value: 201, label: "201 — Created: Resource created" },
  { value: 202, label: "202 — Accepted: Request accepted for processing" },
  { value: 204, label: "204 — No Content: Succeeded without a response body" },
  { value: 206, label: "206 — Partial Content: Partial response returned" },
];

export const HTTP_FAILURE_STATUS_OPTIONS = [
  { value: 400, label: "400 — Bad Request: Invalid request" },
  { value: 401, label: "401 — Unauthorized: Authentication required" },
  { value: 403, label: "403 — Forbidden: Access is not allowed" },
  { value: 404, label: "404 — Not Found: Resource does not exist" },
  { value: 405, label: "405 — Method Not Allowed: HTTP method is unsupported" },
  { value: 408, label: "408 — Request Timeout: Request took too long" },
  { value: 409, label: "409 — Conflict: Request conflicts with current state" },
  { value: 410, label: "410 — Gone: Resource is no longer available" },
  { value: 413, label: "413 — Content Too Large: Request body is too large" },
  { value: 415, label: "415 — Unsupported Media Type: Request format is unsupported" },
  { value: 422, label: "422 — Unprocessable Content: Request data is invalid" },
  { value: 429, label: "429 — Too Many Requests: Rate limit exceeded" },
  { value: 500, label: "500 — Internal Server Error: Server failed" },
  { value: 501, label: "501 — Not Implemented: Feature is unsupported" },
  { value: 502, label: "502 — Bad Gateway: Invalid upstream response" },
  { value: 503, label: "503 — Service Unavailable: Server is temporarily unavailable" },
  { value: 504, label: "504 — Gateway Timeout: Upstream server timed out" },
];

const VALIDATION_KEYS = [
  "min",
  "max",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
] as const;

type ValidationFieldKey = (typeof VALIDATION_KEYS)[number];

export const VALIDATION_FIELD_DEFINITIONS: {
  key: ValidationFieldKey;
  label: string;
  hint: string;
}[] = [
  { key: "min", label: "Minimum value", hint: "Numbers only" },
  { key: "max", label: "Maximum value", hint: "Numbers only" },
  { key: "minLength", label: "Minimum length", hint: "Characters" },
  { key: "maxLength", label: "Maximum length", hint: "Characters" },
  { key: "minItems", label: "Minimum choices", hint: "Multi-select" },
  { key: "maxItems", label: "Maximum choices", hint: "Multi-select" },
];

const VALIDATION_KEYS_BY_DATA_TYPE: Record<DataType, ValidationFieldKey[]> = {
  STRING: ["minLength", "maxLength"],
  NUMBER: ["min", "max"],
  BOOLEAN: [],
  DATE: [],
  DATETIME: [],
};

const VALIDATION_KEYS_BY_FIELD_TYPE: Partial<
  Record<FieldType, ValidationFieldKey[]>
> = {
  SELECT: [],
  MULTISELECT: ["minItems", "maxItems"],
};

export function validationFieldsFor(
  dataType: DataType,
  fieldType: FieldType,
): typeof VALIDATION_FIELD_DEFINITIONS {
  const keys =
    VALIDATION_KEYS_BY_FIELD_TYPE[fieldType] ??
    VALIDATION_KEYS_BY_DATA_TYPE[dataType];
  return VALIDATION_FIELD_DEFINITIONS.filter((field) =>
    keys.includes(field.key),
  );
}

export function filterValidationForType(
  validation: Record<string, string>,
  dataType: DataType,
  fieldType: FieldType,
): Record<string, string> {
  const allowed = new Set(validationFieldsFor(dataType, fieldType).map((field) => field.key));
  return Object.fromEntries(
    Object.entries(validation).filter(([key]) =>
      allowed.has(key as ValidationFieldKey),
    ),
  );
}

export const UNSECTIONED_FIELDS_CODE = "__UNSECTIONED_FIELDS__";

export function isUnsectionedFieldsSection(section: {
  sectionCode?: string;
}): boolean {
  return section.sectionCode === UNSECTIONED_FIELDS_CODE;
}

export function unsectionedPositionFor(
  draft: Pick<
    FormDraft,
    "sections" | "unsectionedFields" | "unsectionedPosition"
  >,
): number {
  const maximum = draft.sections.length;
  if (!draft.unsectionedFields.length) return maximum;
  const requested = draft.unsectionedPosition ?? maximum;
  if (!Number.isFinite(requested)) return maximum;
  return Math.min(Math.max(Math.trunc(requested), 0), maximum);
}

export function emptyField(code = "", displayOrder = 0): DraftField {
  return {
    fieldCode: code,
    label: "",
    type: "INPUT",
    dataType: "STRING",
    isRequired: false,
    isEnabled: true,
    displayOrder,
    placeholder: "",
    optionsDisplayType: "DROPDOWN",
    validation: {},
    options: [],
  };
}

export function emptySection(index: number): DraftSection {
  return {
    sectionCode: "",
    title: "",
    fields: [emptyField("", 0)],
  };
}

export function emptyButton(index: number): DraftButton {
  return {
    ButtonCode: "",
    Buttonlabel: index === 0 ? "Submit" : `Button ${index + 1}`,
    description: "",
    executionType: "API",
    displayOrder: index,
    isEnabled: true,
    request: {
      endpoint: "",
      httpMethod: "POST",
      contentType: "application/json",
      pathParams: {},
      queryParams: {},
      payloadMapping: [],
    },
    responseHandling: {
      successStatusCodes: [],
      failureStatusCodes: [],
      onSuccess: { navigateTo: null, responseMessage: "" },
      onFailure: { navigateTo: null, responseMessage: "" },
    },
  };
}

export function emptyDraft(): FormDraft {
  return {
    formCode: "",
    organizationId: "",
    name: "",
    title: "",
    description: "",
    formType: "CUSTOM",
    layout: "SINGLE_PAGE",
    sections: [emptySection(0)],
    unsectionedFields: [],
    unsectionedPosition: 0,
    Buttons: [],
  };
}

function validationHasContent(validation: Record<string, string>): boolean {
  return Object.values(validation ?? {}).some(
    (value) => String(value ?? "").trim() !== "",
  );
}

function fieldHasContent(field: DraftField): boolean {
  return Boolean(
    field.fieldCode.trim() ||
      field.label.trim() ||
      field.placeholder.trim() ||
      field.isRequired ||
      !field.isEnabled ||
      field.defaultValue !== undefined ||
      field.type !== "INPUT" ||
      field.dataType !== "STRING" ||
      validationHasContent(field.validation) ||
      field.options.some(
        (option) => option.value.trim() || option.label.trim(),
      ),
  );
}

function sectionHasContent(section: DraftSection): boolean {
  return Boolean(
    section.title.trim() ||
      section.sectionCode.trim() ||
      section.fields.some(fieldHasContent),
  );
}

export function draftHasContent(draft: FormDraft): boolean {
  return Boolean(
    draft.formCode.trim() ||
      draft.name.trim() ||
      draft.title.trim() ||
      draft.description.trim() ||
      draft.formType !== "CUSTOM" ||
      draft.layout !== "SINGLE_PAGE" ||
      draft.sections.some(sectionHasContent) ||
      draft.unsectionedFields.some(fieldHasContent) ||
      draft.Buttons.length > 0,
  );
}

function validationToDraft(
  validation:
    | DraftField["validation"]
    | ValidationRules
    | RuleReference[]
    | null
    | undefined,
): Record<string, string> {
  if (!validation) return {};
  if (Array.isArray(validation)) {
    const result: Record<string, string> = {};
    for (const item of validation) {
      const rule = item?.rule?.code;
      if (rule && VALIDATION_KEYS.includes(rule as (typeof VALIDATION_KEYS)[number])) {
        result[rule] = String(item.value ?? "");
      }
    }
    return result;
  }
  const result: Record<string, string> = {};
  for (const key of VALIDATION_KEYS) {
    const value = (validation as Record<string, unknown>)[key];
    if (value !== null && value !== undefined && value !== "") {
      result[key] = String(value);
    }
  }
  return result;
}

function responseHandlingFrom(
  handling: ResponseHandling | undefined,
): ResponseHandling {
  return {
    successStatusCodes: handling?.successStatusCodes ?? [],
    failureStatusCodes: handling?.failureStatusCodes ?? [],
    onSuccess: {
      navigateTo: handling?.onSuccess?.navigateTo ?? null,
      responseMessage: handling?.onSuccess?.responseMessage ?? "",
    },
    onFailure: {
      navigateTo: handling?.onFailure?.navigateTo ?? null,
      responseMessage: handling?.onFailure?.responseMessage ?? "",
    },
  };
}

function fieldFromForm(field: FormField, index: number): DraftField {
  const type = (codeOf(field.type) || "INPUT") as FieldType;
  return {
    fieldCode: field.fieldCode,
    label: field.label,
    type,
    dataType: (codeOf(field.dataType) || "STRING") as DataType,
    isRequired: Boolean(field.isRequired),
    isEnabled: field.isEnabled !== false,
    displayOrder: field.displayOrder ?? index,
    placeholder: field.placeholder ?? "",
    optionsDisplayType:
      type === "SELECT"
        ? "RADIO"
        : field.optionsDisplayType ??
          (type === "MULTISELECT" ? "CHECKBOXES" : "DROPDOWN"),
    defaultValue:
      type === "SELECT" || type === "MULTISELECT"
        ? undefined
        : field.defaultValue,
    validation: validationToDraft(field.validation),
    options: (field.options ?? []).map((option) => ({
      value: option.value,
      label: option.label,
    })),
  };
}

export function draftFromForm(form: MasterForm | null | undefined): FormDraft {
  if (!form) return emptyDraft();
  const formSections = form.sections ?? [];
  const unsectionedSectionIndex = formSections.findIndex(
    isUnsectionedFieldsSection,
  );
  const namedFormSections = formSections.filter(
    (section) => !isUnsectionedFieldsSection(section),
  );
  const unsectionedPosition =
    unsectionedSectionIndex === -1
      ? namedFormSections.length
      : formSections
          .slice(0, unsectionedSectionIndex)
          .filter((section) => !isUnsectionedFieldsSection(section)).length;
  return {
    formCode: form.formCode,
    organizationId: form.organizationId ?? "",
    name: form.name,
    title: form.title ?? form.name,
    description: form.description ?? "",
    formType: (codeOf(form.formType) || "CUSTOM") as FormType,
    layout: (codeOf(form.layout) || "SINGLE_PAGE") as FormLayout,
    sections: namedFormSections.map((section) => ({
      sectionCode: section.sectionCode,
      title: section.title,
      fields: (section.fields ?? []).map(fieldFromForm),
    })),
    unsectionedFields: formSections
      .filter(isUnsectionedFieldsSection)
      .flatMap((section) => (section.fields ?? []).map(fieldFromForm)),
    unsectionedPosition,
    Buttons: (form.Buttons ?? []).map((button, index) => ({
      ButtonCode: button.ButtonCode,
      Buttonlabel: button.Buttonlabel,
      description: button.description ?? "",
      executionType: (codeOf(button.executionType) || "API") as ExecutionType,
      displayOrder: button.displayOrder ?? index,
      isEnabled: button.isEnabled !== false,
      request: button.request
        ? {
            ...button.request,
            httpMethod: (codeOf(button.request.httpMethod) ||
              "POST") as HttpMethod,
            payloadMapping: button.request.payloadMapping ?? [],
            pathParams: button.request.pathParams ?? {},
            queryParams: button.request.queryParams ?? {},
          }
        : null,
      responseHandling: responseHandlingFrom(button.responseHandling),
    })),
  };
}

export function formFromVersion(
  form: MasterForm,
  version: VersionEntry,
): MasterForm {
  return {
    ...form,
    ...version.snapshot,
    _id: form._id,
    currentVersion: version.version,
    status: form.status,
    isDeleted: form.isDeleted,
  };
}

function cleanValidation(
  values: Record<string, string>,
  dataType?: DataType,
  fieldType?: FieldType,
): ValidationRules | null {
  const result: ValidationRules = {};
  const keys: readonly ValidationFieldKey[] =
    dataType && fieldType
      ? validationFieldsFor(dataType, fieldType).map((field) => field.key)
      : VALIDATION_KEYS;
  for (const key of keys) {
    const raw = values[key];
    if (raw === undefined || raw === null || String(raw).trim() === "") continue;
    const number = Number(raw);
    if (Number.isFinite(number)) result[key] = number;
  }
  return Object.keys(result).length ? result : null;
}

function cleanDisplayOrder(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : fallback;
}

function buildOptions(
  field: DraftField,
  usedValues: Set<string>,
): FieldOption[] {
  return field.options
    .filter((option) => option.label.trim())
    .map((option, index) => ({
      label: option.label.trim(),
      value: uniqueCode(
        option.value || option.label,
        usedValues,
        `OPTION_${index + 1}`,
      ),
    }));
}

function cleanParams(
  params: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    const name = key.trim();
    if (name) result[name] = value;
  }
  return result;
}

function buildButton(
  button: DraftButton,
  usedCodes: Set<string>,
): Record<string, unknown> {
  const code = uniqueCode(
    button.ButtonCode || button.Buttonlabel,
    usedCodes,
    "BUTTON",
  );
  const request =
    button.executionType === "API"
      ? {
          ...(button.request ?? {}),
          endpoint: button.request?.endpoint?.trim() || null,
          httpMethod: button.request?.httpMethod ?? "POST",
          contentType: button.request?.contentType?.trim() || "application/json",
          pathParams: cleanParams(button.request?.pathParams),
          queryParams: cleanParams(button.request?.queryParams),
          payloadMapping: (button.request?.payloadMapping ?? [])
            .filter(
              (mapping) =>
                mapping.targetField.trim() &&
                mapping.sourceType.trim() &&
                mapping.sourceFieldCode.trim(),
            )
            .map((mapping) => ({
              targetField: mapping.targetField.trim(),
              sourceType: mapping.sourceType.trim(),
              sourceFieldCode: mapping.sourceFieldCode.trim(),
              required: Boolean(mapping.required),
            })),
        }
      : null;

  return {
    ButtonCode: code,
    Buttonlabel: button.Buttonlabel.trim(),
    description: button.description.trim() || null,
    executionType: button.executionType,
    displayOrder: Number.isFinite(button.displayOrder)
      ? Math.max(0, Math.trunc(button.displayOrder))
      : 0,
    isEnabled: button.isEnabled,
    request,
    responseHandling: {
      successStatusCodes: (button.responseHandling.successStatusCodes ?? [])
        .map(Number)
        .filter(Number.isFinite)
        .map(Math.trunc),
      failureStatusCodes: (button.responseHandling.failureStatusCodes ?? [])
        .map(Number)
        .filter(Number.isFinite)
        .map(Math.trunc),
      onSuccess: {
        navigateTo: button.responseHandling.onSuccess?.navigateTo?.trim() || null,
        responseMessage:
          button.responseHandling.onSuccess?.responseMessage?.trim() || null,
      },
      onFailure: {
        navigateTo: button.responseHandling.onFailure?.navigateTo?.trim() || null,
        responseMessage:
          button.responseHandling.onFailure?.responseMessage?.trim() || null,
      },
    },
  };
}

export function buildFormPayload(
  draft: FormDraft,
  mode: "create" | "update",
): Record<string, unknown> {
  const sectionCodes = new Set<string>();
  sectionCodes.add(UNSECTIONED_FIELDS_CODE);
  const fieldCodes = new Set<string>();

  const sections = draft.sections.map((section, sectionIndex) => ({
    sectionCode: uniqueCode(
      section.sectionCode || section.title,
      sectionCodes,
      `SECTION_${sectionIndex + 1}`,
    ),
    title: section.title.trim(),
    displayOrder: sectionIndex,
    fields: section.fields.map((field, fieldIndex) => {
      const optionValues = new Set<string>();
      const payload: Record<string, unknown> = {
        fieldCode: uniqueCode(
          field.fieldCode || field.label,
          fieldCodes,
          `FIELD_${fieldIndex + 1}`,
        ),
        label: field.label.trim(),
        type: field.type,
        dataType: field.dataType,
        isRequired: field.isRequired,
        isEnabled: field.isEnabled,
        displayOrder: cleanDisplayOrder(field.displayOrder, fieldIndex),
        placeholder: field.placeholder.trim() || null,
        validation: cleanValidation(
          field.validation,
          field.dataType,
          field.type,
        ),
      };
      if (field.type === "SELECT" || field.type === "MULTISELECT") {
        payload.optionsDisplayType =
          field.type === "SELECT" ? "RADIO" : field.optionsDisplayType;
      }
      if (
        field.type !== "SELECT" &&
        field.type !== "MULTISELECT" &&
        field.defaultValue !== undefined
      ) {
        payload.defaultValue = field.defaultValue;
      }
      if (field.type === "SELECT" || field.type === "MULTISELECT") {
        payload.options = buildOptions(field, optionValues);
      }
      return payload;
    }),
  }));
  if (draft.unsectionedFields.length) {
    const fields = draft.unsectionedFields.map((field, fieldIndex) => {
      const optionValues = new Set<string>();
      const payload: Record<string, unknown> = {
        fieldCode: uniqueCode(
          field.fieldCode || field.label,
          fieldCodes,
          `FIELD_${fieldIndex + 1}`,
        ),
        label: field.label.trim(),
        type: field.type,
        dataType: field.dataType,
        isRequired: field.isRequired,
        isEnabled: field.isEnabled,
        displayOrder: cleanDisplayOrder(field.displayOrder, fieldIndex),
        placeholder: field.placeholder.trim() || null,
        validation: cleanValidation(
          field.validation,
          field.dataType,
          field.type,
        ),
      };
      if (
        field.type !== "SELECT" &&
        field.type !== "MULTISELECT" &&
        field.defaultValue !== undefined
      ) {
        payload.defaultValue = field.defaultValue;
      }
      if (field.type === "SELECT" || field.type === "MULTISELECT") {
        payload.options = buildOptions(field, optionValues);
        payload.optionsDisplayType =
          field.type === "SELECT" ? "RADIO" : field.optionsDisplayType;
      }
      return payload;
    });
    sections.splice(unsectionedPositionFor(draft), 0, {
      sectionCode: UNSECTIONED_FIELDS_CODE,
      title: "Fields",
      displayOrder: 0,
      fields,
    });
  }
  sections.forEach((section, index) => {
    section.displayOrder = index;
  });

  const buttonCodes = new Set<string>();
  const buttons = draft.Buttons.map((button) =>
    buildButton(button, buttonCodes),
  );

  const payload: Record<string, unknown> = {
    name: draft.name.trim(),
    title: draft.title.trim(),
    description: draft.description.trim() || null,
    formType: draft.formType,
    layout: draft.layout,
    Buttons: buttons,
    sections,
  };

  if (mode === "create") {
    payload.organizationId = draft.organizationId.trim() || null;
    payload.formCode = draft.formCode.trim();
    payload.status = "DRAFT";
  }

  return payload;
}

export function countFields(sections: DraftSection[] | undefined): number {
  return (sections ?? []).reduce(
    (total, section) => total + section.fields.length,
    0,
  );
}
