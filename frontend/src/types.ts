export type Json = any;

export interface ApiResponse {
  ok: boolean;
  status: number;
  statusText: string;
  payload: Json;
  durationMs: number;
  method: string;
  path: string;
}

export interface ValueReference {
  valueSetId?: string;
  code: string;
}

export type Coded = string | ValueReference | null | undefined;

export type FormType =
  | "ASSESSMENT"
  | "REGISTRATION"
  | "DIET_PLAN"
  | "MEDICAL_HISTORY"
  | "BODY_MEASUREMENT"
  | "LOGIN"
  | "CUSTOM";

export type FormLayout = "SINGLE_PAGE" | "WIZARD" | "TABS" | "ACCORDION";

export type FormStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export type MasterFormDocumentType = "MASTER_FORM";

export type Gender = "MALE" | "FEMALE" | "OTHER" | "PREFER_NOT_TO_SAY";

export type DietPreference = "VEGETARIAN" | "NON_VEGETARIAN";

export type DietGoal = "WEIGHT_LOSS" | "MUSCLE_GAIN" | "MAINTENANCE";

export type AssessmentStatus = "SUBMITTED";

export type DietPlanStatus = "PENDING_GENERATION";

export type FieldType =
  | "INPUT"
  | "NUMBER"
  | "TEXTAREA"
  | "DATE"
  | "CHECKBOX"
  | "SELECT"
  | "MULTISELECT";

export type OptionDisplayType = "DROPDOWN" | "RADIO" | "CHECKBOXES";

export type DataType = "STRING" | "NUMBER" | "BOOLEAN" | "DATE" | "DATETIME";

export type ExecutionType = "API" | "REACT_ROUTE" | "CLIENT_ACTION";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface ValidationRules {
  min?: number | null;
  max?: number | null;
  minLength?: number | null;
  maxLength?: number | null;
  minItems?: number | null;
  maxItems?: number | null;
}

export interface FieldOption {
  value: string;
  label: string;
}

export interface FormField {
  fieldCode: string;
  label: string;
  type: Coded;
  dataType: Coded;
  isRequired: boolean;
  isEnabled: boolean;
  displayOrder: number;
  placeholder?: string | null;
  defaultValue?: unknown;
  validation?: ValidationRules | RuleReference[] | null;
  options?: FieldOption[] | null;
  optionsDisplayType?: OptionDisplayType | null;
}

export interface RuleReference {
  rule?: ValueReference;
  value?: number | null;
}

export interface FormSection {
  sectionCode: string;
  title: string;
  displayOrder: number;
  fields: FormField[];
}

export interface PayloadMapping {
  targetField: string;
  sourceType: Coded;
  sourceFieldCode: string;
  required: boolean;
}

export interface ButtonRequest {
  endpoint?: string | null;
  httpMethod?: Coded;
  contentType?: string | null;
  pathParams?: Record<string, unknown>;
  queryParams?: Record<string, unknown>;
  payloadMapping?: PayloadMapping[];
}

export interface ResponseAction {
  navigateTo?: string | null;
  responseMessage?: string | null;
}

export interface ResponseHandling {
  successStatusCodes?: number[];
  failureStatusCodes?: number[];
  onSuccess?: ResponseAction;
  onFailure?: ResponseAction;
}

export interface FormButton {
  ButtonCode: string;
  Buttonlabel: string;
  description?: string | null;
  executionType: Coded;
  displayOrder: number;
  isEnabled: boolean;
  request?: ButtonRequest | null;
  responseHandling?: ResponseHandling;
}

export interface LastPublishedSwitch {
  fromVersionId: string;
  toVersionId: string;
}

export interface FormSnapshot {
  name: string;
  title: string;
  description?: string | null;
  formType: Coded;
  layout: Coded;
  Buttons: FormButton[];
  sections: FormSection[];
  [key: string]: Json;
}

export interface MasterForm {
  _id: string;
  documentType?: MasterFormDocumentType;
  organizationId?: string | null;
  formCode: string;
  name: string;
  title?: string;
  description?: string | null;
  formType: Coded;
  status: Coded;
  layout: Coded;
  currentVersion: number;
  isDeleted: boolean;
  Buttons?: FormButton[];
  sections?: FormSection[];
  lastPublishedSwitch?: LastPublishedSwitch | null;
  createdBy?: string;
  updatedBy?: string;
  createdAt?: string;
  updatedAt?: string;
  versions?: VersionEntry[];
  [key: string]: Json;
}

export interface VersionEntry {
  _id: string;
  version: number;
  status?: FormStatus;
  snapshot: FormSnapshot;
  isDeleted?: boolean;
  createdBy?: string;
  createdAt?: string;
  updatedBy?: string;
  updatedAt?: string;
  archivedBy?: string;
  archivedAt?: string;
  deletedBy?: string;
  deletedAt?: string;
  restoredBy?: string;
  restoredAt?: string;
  [key: string]: Json;
}

export interface ListMeta {
  masterFormId?: string;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginationMeta extends ListMeta {}

export interface ApiEnvelope<T> {
  success: boolean;
  message: string;
  data: T;
  meta: ListMeta | null;
}

export interface ApiErrorDetail {
  code: string;
  message: string;
  details?: Json;
}

export interface ApiErrorResponse {
  success: false;
  error: ApiErrorDetail;
  meta: null;
}

export interface ApiRootInfo {
  docs: string;
  openapi: string;
}

/* ------------------------------------------------------------------ */
/* Master form request/query contracts                                 */
/* ------------------------------------------------------------------ */

export interface ButtonRequestPayload {
  endpoint?: string | null;
  httpMethod?: HttpMethod | null;
  contentType?: string | null;
  pathParams?: Record<string, unknown>;
  queryParams?: Record<string, unknown>;
  payloadMapping?: PayloadMapping[];
}

export interface FormFieldPayload {
  fieldCode: string;
  label: string;
  type: FieldType;
  dataType: DataType;
  isRequired: boolean;
  isEnabled: boolean;
  displayOrder: number;
  placeholder?: string | null;
  defaultValue?: unknown;
  validation?: ValidationRules | null;
  options?: FieldOption[] | null;
  optionsDisplayType?: OptionDisplayType | null;
}

export interface FormSectionPayload {
  sectionCode: string;
  title: string;
  displayOrder: number;
  fields: FormFieldPayload[];
}

export interface FormButtonPayload {
  ButtonCode: string;
  Buttonlabel: string;
  description?: string | null;
  executionType: ExecutionType;
  displayOrder: number;
  isEnabled: boolean;
  request?: ButtonRequestPayload | null;
  responseHandling?: ResponseHandling;
}

export type FormContentsPayload = {
  name: string;
  description: string | null;
  formType: FormType;
  title: string;
  layout: FormLayout;
  Buttons: FormButtonPayload[];
  sections: FormSectionPayload[];
};

export type MasterFormCreatePayload = FormContentsPayload & {
  organizationId: string | null;
  formCode: string;
  status: "DRAFT";
};

export type MasterFormPatchPayload = Partial<FormContentsPayload> & {
  masterFormVersionId?: string | null;
  status?: FormStatus;
};

export interface MasterFormVersionStatusPayload {
  status: FormStatus;
}

export type MasterFormSortBy =
  | "name"
  | "createdAt"
  | "updatedAt"
  | "formCode"
  | "formType"
  | "status";

export type SortOrder = "asc" | "desc";

export interface MasterFormListQuery {
  organizationId?: string | null;
  formCode?: string | null;
  formType?: FormType | null;
  status?: FormStatus | null;
  name?: string | null;
  isDeleted?: boolean;
  includeDeleted?: boolean;
  page?: number;
  limit?: number;
  sortBy?: MasterFormSortBy;
  sortOrder?: SortOrder;
}

export interface MasterFormGetQuery {
  includeVersions?: boolean;
  includeDeleted?: boolean;
}

export interface MasterFormVersionsQuery {
  masterFormVersionId?: string | null;
  includeDeleted?: boolean;
  version?: number | null;
  sortOrder?: SortOrder;
  page?: number;
  limit?: number;
}

/* ------------------------------------------------------------------ */
/* Form action request/response contracts                              */
/* ------------------------------------------------------------------ */

export interface LoginPayload {
  email: string;
  password: string;
}

export interface ClientRegistrationPayload {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  dateOfBirth: string;
  gender: Gender;
}

export interface ClientRegistration extends ClientRegistrationPayload {
  _id: string;
  createdBy: string;
  createdAt: string;
}

export interface AssessmentSubmissionPayload {
  age: number;
  dietPreference?: DietPreference | null;
}

export interface AssessmentSubmission extends AssessmentSubmissionPayload {
  _id: string;
  status: AssessmentStatus;
  createdBy: string;
  createdAt: string;
}

export interface DietPlanRequestPayload {
  clientId: string;
  planName: string;
  goal: DietGoal;
  calorieTarget: number;
  durationWeeks?: number | null;
}

export interface DietPlanRequest extends DietPlanRequestPayload {
  _id: string;
  status: DietPlanStatus;
  generationConfigured: boolean;
  createdBy: string;
  createdAt: string;
}

export interface HealthStatus {
  status: "ok";
}

/* ------------------------------------------------------------------ */
/* Editable draft types used by the form builder                       */
/* ------------------------------------------------------------------ */

export interface DraftSection {
  sectionCode: string;
  title: string;
  fields: DraftField[];
}

export interface DraftField {
  fieldCode: string;
  label: string;
  type: FieldType;
  dataType: DataType;
  isRequired: boolean;
  isEnabled: boolean;
  displayOrder: number;
  placeholder: string;
  optionsDisplayType: OptionDisplayType;
  defaultValue?: unknown;
  validation: Record<string, string>;
  options: FieldOption[];
}

export interface DraftButton {
  ButtonCode: string;
  Buttonlabel: string;
  description: string;
  executionType: ExecutionType;
  displayOrder: number;
  isEnabled: boolean;
  request: ButtonRequest | null;
  responseHandling: ResponseHandling;
}

export interface FormDraft {
  formCode: string;
  organizationId: string;
  name: string;
  title: string;
  description: string;
  formType: FormType;
  layout: FormLayout;
  sections: DraftSection[];
  unsectionedFields: DraftField[];
  unsectionedPosition?: number;
  Buttons: DraftButton[];
}
