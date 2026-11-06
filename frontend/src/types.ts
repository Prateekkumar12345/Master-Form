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
  value?: number;
}

export interface FormSection {
  sectionCode: string;
  title: string;
  displayOrder: number;
  fields: FormField[];
}

export interface PayloadMapping {
  targetField: string;
  sourceType: string;
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

export interface MasterForm {
  _id: string;
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
  snapshot: Json;
  isDeleted?: boolean;
  createdBy?: string;
  createdAt?: string;
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
