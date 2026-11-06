import type { MasterForm } from "./types";
import { codeOf } from "./utils";

export const QUERY_PARAM_SOURCE_TYPES = [
  { value: "CONSTANT", label: "Constant" },
  { value: "FORM_FIELD", label: "Form field" },
] as const;

export type QueryParamSourceType =
  (typeof QUERY_PARAM_SOURCE_TYPES)[number]["value"];

export interface QueryParamSource {
  sourceType: QueryParamSourceType;
  sourceValue: string;
  sourceFieldCode: string;
}

export function queryParamSource(value: unknown): QueryParamSource {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return {
      sourceType:
        record.sourceType === "FORM_FIELD" ? "FORM_FIELD" : "CONSTANT",
      sourceValue:
        typeof record.sourceValue === "string" ? record.sourceValue : "",
      sourceFieldCode:
        typeof record.sourceFieldCode === "string"
          ? record.sourceFieldCode
          : "",
    };
  }

  return {
    sourceType: "CONSTANT",
    sourceValue: value === null || value === undefined ? "" : String(value),
    sourceFieldCode: "",
  };
}

export function resolveQueryParamValue(
  value: unknown,
  form: MasterForm,
  values: Record<string, unknown>,
): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const source = queryParamSource(value);
  if (source.sourceType === "FORM_FIELD") {
    return values[source.sourceFieldCode];
  }
  return databaseQueryValue(source.sourceValue, form);
}

function databaseQueryValue(key: string, form: MasterForm): unknown {
  const normalized = key.trim().toLowerCase().replace(/[_\s-]/g, "");
  switch (normalized) {
    case "organizationid":
      return form.organizationId;
    case "masterformid":
    case "formid":
      return form._id;
    case "formcode":
      return form.formCode;
    case "formtype":
      return codeOf(form.formType);
    case "status":
      return codeOf(form.status);
    case "currentversion":
      return form.currentVersion;
    case "createdby":
      return form.createdBy;
    case "createdat":
      return form.createdAt;
    case "updatedby":
      return form.updatedBy;
    case "updatedat":
      return form.updatedAt;
    default:
      // Keep query parameters stored by older versions as literal values.
      return key;
  }
}
