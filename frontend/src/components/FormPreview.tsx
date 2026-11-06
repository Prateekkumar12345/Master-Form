import { useState } from "react";

import { useApi } from "../context/ApiContext";
import type {
  ApiResponse,
  FormButton,
  FormField,
  MasterForm,
  RuleReference,
  ValidationRules,
} from "../types";
import {
  codeOf,
  errorMessage,
  labelize,
  resolveResponseMessage,
  validationSummary,
} from "../utils";
import { isUnsectionedFieldsSection } from "../formModel";
import { resolveQueryParamValue } from "../queryParams";
import { Icon } from "./Icon";
import { Notice } from "./Notice";
import { PreviewMultiSelect } from "./PreviewMultiSelect";
import { ResponsePanel } from "./ResponsePanel";

type Values = Record<string, unknown>;

function fieldRules(field: FormField): ValidationRules {
  const validation = field.validation;
  if (!validation) return {};
  if (Array.isArray(validation)) {
    const result: ValidationRules = {};
    for (const item of validation as RuleReference[]) {
      const code = item?.rule?.code;
      if (code && item.value !== undefined && item.value !== null) {
        result[code as keyof ValidationRules] = item.value;
      }
    }
    return result;
  }
  return validation;
}

function isEmpty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

function asString(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value);
}

function initialValues(form: MasterForm): Values {
  const values: Values = {};
  for (const section of form.sections ?? []) {
    for (const field of section.fields ?? []) {
      if (!field.isEnabled || isEmpty(field.defaultValue)) continue;
      const type = codeOf(field.type);
      if (type === "SELECT" || type === "MULTISELECT") continue;
      values[field.fieldCode] = field.defaultValue;
    }
  }
  return values;
}

function validateValues(form: MasterForm, values: Values): string[] {
  const errors: string[] = [];
  for (const section of form.sections ?? []) {
    for (const field of section.fields ?? []) {
      if (!field.isEnabled) continue;
      const value = values[field.fieldCode];
      const rules = fieldRules(field);
      if (field.isRequired && isEmpty(value)) {
        errors.push(`${field.label} is required.`);
        continue;
      }
      if (isEmpty(value)) continue;
      if (field.type === "CHECKBOX") continue;

      const text = asString(value);
      const number = Number(value);
      if (
        rules.minLength !== undefined &&
        text.length < Number(rules.minLength)
      ) {
        errors.push(`${field.label} needs at least ${rules.minLength} characters.`);
      }
      if (
        rules.maxLength !== undefined &&
        text.length > Number(rules.maxLength)
      ) {
        errors.push(`${field.label} can have at most ${rules.maxLength} characters.`);
      }
      if (rules.min !== undefined && Number.isFinite(number) && number < Number(rules.min)) {
        errors.push(`${field.label} must be at least ${rules.min}.`);
      }
      if (rules.max !== undefined && Number.isFinite(number) && number > Number(rules.max)) {
        errors.push(`${field.label} must be at most ${rules.max}.`);
      }
      if (Array.isArray(value)) {
        if (rules.minItems !== undefined && value.length < Number(rules.minItems)) {
          errors.push(`${field.label} needs at least ${rules.minItems} choices.`);
        }
        if (rules.maxItems !== undefined && value.length > Number(rules.maxItems)) {
          errors.push(`${field.label} can have at most ${rules.maxItems} choices.`);
        }
      }
    }
  }
  return errors;
}

function requestPayload(
  button: FormButton,
  values: Values,
  form: MasterForm,
): { body: Record<string, unknown>; endpoint: string } {
  const request = button.request;
  if (!request?.endpoint) {
    throw new Error("This button has no endpoint configured.");
  }

  let endpoint = request.endpoint;
  for (const [key, value] of Object.entries(request.pathParams ?? {})) {
    endpoint = endpoint.replace(`{${key}}`, encodeURIComponent(String(value)));
  }
  for (const [key, value] of Object.entries(values)) {
    if (!isEmpty(value)) {
      endpoint = endpoint.replace(
        `{${key}}`,
        encodeURIComponent(String(value)),
      );
    }
  }

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(request.queryParams ?? {})) {
    const resolved = resolveQueryParamValue(value, form, values);
    if (!isEmpty(resolved)) query.set(key, String(resolved));
  }
  const queryText = query.toString();
  if (queryText) endpoint += `${endpoint.includes("?") ? "&" : "?"}${queryText}`;

  const mappings = request.payloadMapping ?? [];
  const body: Record<string, unknown> = {};
  if (mappings.length) {
    for (const mapping of mappings) {
      const value =
        mapping.sourceType === "FORM_FIELD"
          ? values[mapping.sourceFieldCode]
          : undefined;
      if (mapping.required && isEmpty(value)) {
        throw new Error(`A required value for ${mapping.targetField} is missing.`);
      }
      if (!isEmpty(value)) body[mapping.targetField] = value;
    }
  } else {
    for (const section of form.sections ?? []) {
      for (const field of section.fields ?? []) {
        if (field.isEnabled && !isEmpty(values[field.fieldCode])) {
          body[field.fieldCode] = values[field.fieldCode];
        }
      }
    }
  }

  return { body, endpoint };
}

export function FormPreview({ form }: { form: MasterForm }) {
  const { send } = useApi();
  const [values, setValues] = useState<Values>(() => initialValues(form));
  const [message, setMessage] = useState<{
    tone: "success" | "error" | "info";
    text: string;
  } | null>(null);
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  const setValue = (code: string, value: unknown) => {
    setValues((current) => ({ ...current, [code]: value }));
  };

  const runButton = async (button: FormButton) => {
    setMessage(null);
    setResponse(null);
    const validationErrors = validateValues(form, values);
    if (validationErrors.length) {
      setMessage({ tone: "error", text: validationErrors.join(" ") });
      return;
    }

    if (codeOf(button.executionType) !== "API") {
      const actionMessage =
        button.responseHandling?.onSuccess?.responseMessage ||
        (codeOf(button.executionType) === "REACT_ROUTE"
          ? `This button opens ${button.responseHandling?.onSuccess?.navigateTo ?? "another page"}.`
          : "This button runs a client-side action.");
      setMessage({ tone: "info", text: actionMessage });
      return;
    }

    setRunning(button.ButtonCode);
    try {
      const { body, endpoint } = requestPayload(button, values, form);
      const method = codeOf(button.request?.httpMethod) || "POST";
      const result = await send(
        method,
        endpoint,
        method === "GET" || method === "DELETE" ? undefined : body,
      );
      setResponse(result);
      const successCodes = button.responseHandling?.successStatusCodes ?? [];
      const failureCodes = button.responseHandling?.failureStatusCodes ?? [];
      const succeeded = successCodes.length
        ? successCodes.includes(result.status)
        : failureCodes.includes(result.status)
          ? false
          : result.ok;
      const successText =
        resolveResponseMessage(
          button.responseHandling?.onSuccess?.responseMessage,
          result.payload,
        ) || "Request completed successfully.";
      const failureText =
        resolveResponseMessage(
          button.responseHandling?.onFailure?.responseMessage,
          result.payload,
        ) || errorMessage(result);
      setMessage({
        tone: succeeded ? "success" : "error",
        text: succeeded ? successText : failureText,
      });
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setRunning(null);
    }
  };

  const enabledButtons = (form.Buttons ?? []).filter(
    (button) => button.isEnabled,
  );

  return (
    <div className="preview-layout">
      <div className="preview-card">
        <div className="preview-head">
          <div>
            <p className="eyebrow">Preview</p>
            <h2>{form.title || form.name}</h2>
            {form.description ? <p>{form.description}</p> : null}
          </div>
          <span className="status-badge status-neutral">
            {labelize(codeOf(form.layout))}
          </span>
        </div>

        {message ? (
          <Notice tone={message.tone} onDismiss={() => setMessage(null)}>
            {message.text}
          </Notice>
        ) : null}

        {(form.sections ?? []).length ? (
          (form.sections ?? []).map((section, sectionIndex) => (
            <section
              className={`preview-section${isUnsectionedFieldsSection(section) ? " preview-section-unsectioned" : ""}`}
              key={section.sectionCode}
            >
              {!isUnsectionedFieldsSection(section) ? (
                <div className="preview-section-head">
                  <span className="group-number">
                    {String(sectionIndex + 1).padStart(2, "0")}
                  </span>
                  <h3>{section.title}</h3>
                </div>
              ) : null}
              <div className="preview-fields">
                {(section.fields ?? []).map((field) => {
                  if (!field.isEnabled) return null;
                  const value = values[field.fieldCode];
                  const type = codeOf(field.type);
                  const rules = fieldRules(field);
                  const ruleText = validationSummary(rules);
                  const common = {
                    id: field.fieldCode,
                    disabled: false,
                  };
                  return (
                    <div className="preview-field" key={field.fieldCode}>
                      <label className="field-label" htmlFor={field.fieldCode}>
                        {field.label}
                        {field.isRequired ? <b> *</b> : null}
                      </label>
                      {type === "TEXTAREA" ? (
                        <textarea
                          {...common}
                          className="input textarea"
                          placeholder={field.placeholder ?? ""}
                          rows={3}
                          value={asString(value)}
                          onChange={(event) =>
                            setValue(field.fieldCode, event.target.value)
                          }
                        />
                      ) : type === "CHECKBOX" ? (
                        <label className="checkbox preview-checkbox">
                          <input
                            checked={Boolean(value)}
                            id={field.fieldCode}
                            type="checkbox"
                            onChange={(event) =>
                              setValue(field.fieldCode, event.target.checked)
                            }
                          />
                          <span>{field.placeholder || "Yes"}</span>
                        </label>
                      ) : type === "SELECT" ? (
                        <div className="choice-list option-radio-list">
                          {(field.options ?? []).map((option) => (
                            <label className="checkbox" key={option.value}>
                              <input
                                checked={value === option.value}
                                name={field.fieldCode}
                                type="radio"
                                value={option.value}
                                onChange={() =>
                                  setValue(field.fieldCode, option.value)
                                }
                              />
                              <span>{option.label}</span>
                            </label>
                          ))}
                          {!(field.options ?? []).length ? (
                            <span className="small muted">
                              No choices configured.
                            </span>
                          ) : null}
                        </div>
                      ) : type === "MULTISELECT" &&
                        field.optionsDisplayType === "DROPDOWN" ? (
                        <PreviewMultiSelect
                          id={field.fieldCode}
                          options={field.options ?? []}
                          value={Array.isArray(value) ? value.map(String) : []}
                          onChange={(next) =>
                            setValue(field.fieldCode, next)
                          }
                        />
                      ) : type === "MULTISELECT" ? (
                        <div className="choice-list">
                          {(field.options ?? []).map((option) => {
                            const selected = Array.isArray(value)
                              ? (value as string[])
                              : [];
                            return (
                              <label className="checkbox" key={option.value}>
                                <input
                                  checked={selected.includes(option.value)}
                                  type="checkbox"
                                  onChange={(event) => {
                                    const next = event.target.checked
                                      ? [...selected, option.value]
                                      : selected.filter(
                                          (item) => item !== option.value,
                                        );
                                    setValue(field.fieldCode, next);
                                  }}
                                />
                                <span>{option.label}</span>
                              </label>
                            );
                          })}
                          {!(field.options ?? []).length ? (
                            <span className="small muted">
                              No choices configured.
                            </span>
                          ) : null}
                        </div>
                      ) : type === "DATE" ? (
                        <input
                          {...common}
                          className="input"
                          type={codeOf(field.dataType) === "DATETIME" ? "datetime-local" : "date"}
                          value={asString(value)}
                          onChange={(event) =>
                            setValue(field.fieldCode, event.target.value)
                          }
                        />
                      ) : (
                        <input
                          {...common}
                          className="input"
                          placeholder={field.placeholder ?? ""}
                          type={
                            type === "NUMBER" ||
                            codeOf(field.dataType) === "NUMBER"
                              ? "number"
                              : "text"
                          }
                          value={asString(value)}
                          onChange={(event) =>
                            setValue(field.fieldCode, event.target.value)
                          }
                        />
                      )}
                      {ruleText ? (
                        <span className="field-hint">{ruleText}</span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          ))
        ) : (
          <p className="empty-copy">This form has no fields yet.</p>
        )}

        <div className="preview-actions">
          {enabledButtons.length ? (
            enabledButtons.map((button) => (
              <button
                className={`btn ${
                  codeOf(button.executionType) === "API"
                    ? "btn-primary"
                    : "btn-secondary"
                }`}
                disabled={running === button.ButtonCode}
                key={button.ButtonCode}
                type="button"
                onClick={() => void runButton(button)}
              >
                {running === button.ButtonCode ? (
                  "Working…"
                ) : (
                  <>
                    <Icon
                      name={codeOf(button.executionType) === "API" ? "send" : "play"}
                      size={16}
                    />
                    {button.Buttonlabel}
                  </>
                )}
              </button>
            ))
          ) : (
            <p className="small muted">
              No buttons are configured for this form. You can add buttons in
              the form editor.
            </p>
          )}
        </div>
      </div>

      <div className="preview-response">
        <div className="panel-head">
          <div>
            <h3>Request result</h3>
            <p>A preview button sends a live request to the backend.</p>
          </div>
        </div>
        <ResponsePanel response={response} />
      </div>
    </div>
  );
}
