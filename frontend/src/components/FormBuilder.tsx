import { useEffect, useState, type DragEvent } from "react";
import { createPortal } from "react-dom";

import {
  DATA_TYPE_OPTIONS,
  EXECUTION_TYPE_OPTIONS,
  FIELD_TYPE_OPTIONS,
  FORM_TYPE_OPTIONS,
  HTTP_FAILURE_STATUS_OPTIONS,
  HTTP_METHOD_OPTIONS,
  HTTP_SUCCESS_STATUS_OPTIONS,
  LAYOUT_OPTIONS,
  buildFormPayload,
  defaultValueTypeFor,
  draftFromForm,
  draftHasContent,
  emptyButton,
  emptyField,
  emptySection,
  filterValidationForType,
  UNSECTIONED_FIELDS_CODE,
  unsectionedPositionFor,
  validationFieldsFor,
  valueTypeOptionsFor,
} from "../formModel";
import type {
  DataType,
  DraftButton,
  DraftField,
  DraftSection,
  ExecutionType,
  FieldType,
  FormDraft,
  HttpMethod,
  MasterForm,
} from "../types";
import {
  clearStoredFormDraft,
  loadStoredFormDraft,
  saveStoredFormDraft,
} from "../formDraftStorage";
import {
  codeOf,
  makeCode,
  uniqueCode,
} from "../utils";
import {
  QUERY_PARAM_SOURCE_TYPES,
  queryParamSource,
  type QueryParamSource,
  type QueryParamSourceType,
} from "../queryParams";
import { ConfirmDialog } from "./ConfirmDialog";
import { FormDraftPreview } from "./FormDraftPreview";
import { Icon } from "./Icon";
import { Notice } from "./Notice";

interface FormBuilderProps {
  form?: MasterForm | null;
  createVersion?: boolean;
  saving?: boolean;
  serverError?: string;
  onCancel: () => void;
  onSave: (payload: Record<string, unknown>) => Promise<boolean>;
}

type Step = "details" | "sections";

function fieldKey(sectionIndex: number, fieldIndex: number): string {
  return `${sectionIndex}:${fieldIndex}`;
}

function draftFieldCodes(draft: FormDraft): string[] {
  const used = new Set<string>();
  const codes: string[] = [];
  const addFields = (fields: DraftField[]) => {
    fields.forEach((field, index) => {
      codes.push(
        uniqueCode(field.fieldCode || field.label, used, `FIELD_${index + 1}`),
      );
    });
  };
  draft.sections.forEach((section) => addFields(section.fields));
  addFields(draft.unsectionedFields);
  return codes;
}

function SearchableStatusCodeInput({
  label,
  status,
  options,
  onChange,
}: {
  label: string;
  status: number;
  options: readonly { value: number; label: string }[];
  onChange: (status: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selectedOption = options.find((option) => option.value === status);
  const filteredOptions = options.filter((option) =>
    option.label.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div className="status-code-combobox">
      <input
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-haspopup="listbox"
        autoComplete="off"
        className="input"
        placeholder="Search HTTP status codes"
        role="combobox"
        value={open ? query : selectedOption?.label ?? String(status)}
        onBlur={() => setOpen(false)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setQuery("");
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
          if (event.key === "Enter" && filteredOptions[0]) {
            event.preventDefault();
            onChange(filteredOptions[0].value);
            setOpen(false);
          }
        }}
      />
      {open ? (
        <div className="status-code-options" role="listbox" aria-label={label}>
          {filteredOptions.length ? (
            filteredOptions.map((option) => (
              <button
                aria-selected={option.value === status}
                className="status-code-option"
                key={option.value}
                role="option"
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(option.value);
                  setQuery("");
                  setOpen(false);
                }}
              >
                {option.label}
              </button>
            ))
          ) : (
            <p className="status-code-no-results">No matching HTTP codes.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function HttpStatusCodeEditor({
  label,
  hint,
  codes,
  options,
  onChange,
  searchable = false,
}: {
  label: string;
  hint: string;
  codes: number[];
  options: readonly { value: number; label: string }[];
  onChange: (codes: number[]) => void;
  searchable?: boolean;
}) {
  const status = codes[0];
  const selectedOptionExists = options.some(
    (option) => option.value === status,
  );

  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <span className="field-hint">{hint}</span>
      {status !== undefined ? (
        <div className="option-editor-row">
          {searchable ? (
            <SearchableStatusCodeInput
              label={label}
              onChange={(nextStatus) => onChange([nextStatus])}
              options={options}
              status={status}
            />
          ) : (
            <select
              aria-label={label}
              className="input"
              value={status}
              onChange={(event) => onChange([Number(event.target.value)])}
            >
              {!selectedOptionExists ? (
                <option value={status}>
                  {status} — Existing HTTP status code
                </option>
              ) : null}
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          )}
          <button
            aria-label={`Remove ${label.toLowerCase()}`}
            className="icon-button danger-icon"
            type="button"
            onClick={() => onChange([])}
          >
            <Icon name="trash" size={15} />
          </button>
        </div>
      ) : (
        <button
          className="add-inline option-add-button"
          type="button"
          onClick={() => onChange([options[0].value])}
        >
          <Icon name="plus" size={15} /> Add status code
        </button>
      )}
    </div>
  );
}

const RESPONSE_PATH_PREFIX = "response.";

function responsePathPart(value: string): string {
  return value.startsWith(RESPONSE_PATH_PREFIX)
    ? value.slice(RESPONSE_PATH_PREFIX.length)
    : value;
}

function ResponseMessageField({
  label,
  value,
  hint,
  onChange,
}: {
  label: string;
  value: string;
  hint: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="response-message-path">
        <span className="response-message-prefix">{RESPONSE_PATH_PREFIX}</span>
        <input
          aria-label={label}
          className="input mono"
          value={responsePathPart(value)}
          onChange={(event) => {
            const next = event.target.value;
            onChange(next.trim() ? `${RESPONSE_PATH_PREFIX}${next}` : "");
          }}
        />
      </div>
      <span className="field-hint">{hint}</span>
    </div>
  );
}

export function FormBuilder({
  form,
  createVersion = false,
  saving = false,
  serverError = "",
  onCancel,
  onSave,
}: FormBuilderProps) {
  const [draft, setDraft] = useState<FormDraft>(() => {
    if (!form) {
      const stored = loadStoredFormDraft();
      if (stored) return stored.draft;
    }
    return draftFromForm(form);
  });
  const [step, setStep] = useState<Step>(() => {
    if (!form) {
      const stored = loadStoredFormDraft();
      if (stored) return stored.step;
    }
    return "details";
  });
  const [error, setError] = useState("");
  const [confirmCreate, setConfirmCreate] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [expandedField, setExpandedField] = useState<string | null>(
    form ? null : fieldKey(0, 0),
  );
  const [expandedButton, setExpandedButton] = useState<number | null>(null);
  const [draggingSection, setDraggingSection] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<{
    key: string;
    position: "before" | "after";
  } | null>(null);

  useEffect(() => {
    if (form) return;
    saveStoredFormDraft(draft, step);
  }, [draft, step, form]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const update = <K extends keyof FormDraft>(key: K, value: FormDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const updateSection = (
    index: number,
    updater: (section: DraftSection) => DraftSection,
  ) => {
    setDraft((current) => ({
      ...current,
      sections: current.sections.map((section, sectionIndex) =>
        sectionIndex === index ? updater(section) : section,
      ),
    }));
  };

  const dropPositionFor = (event: DragEvent<HTMLElement>): "before" | "after" => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY - rect.top < rect.height / 2 ? "before" : "after";
  };

  const moveSectionToTarget = (
    from: number,
    targetKey: string,
    position: "before" | "after",
  ) => {
    setDraft((current) => {
      const items: (
        | { kind: "section"; index: number }
        | { kind: "unsectioned" }
      )[] = current.sections.map((_, index) => ({
        kind: "section" as const,
        index,
      }));
      if (current.unsectionedFields.length) {
        items.splice(unsectionedPositionFor(current), 0, {
          kind: "unsectioned",
        });
      }
      const fromIndex = items.findIndex(
        (item) => item.kind === "section" && item.index === from,
      );
      if (fromIndex === -1) return current;

      let insertAt: number;
      if (targetKey === "unsectioned") {
        const targetIndex = items.findIndex(
          (item) => item.kind === "unsectioned",
        );
        if (targetIndex === -1) return current;
        insertAt = position === "before" ? targetIndex : targetIndex + 1;
      } else {
        const targetSection = Number(targetKey);
        const targetIndex = items.findIndex(
          (item) =>
            item.kind === "section" && item.index === targetSection,
        );
        if (targetIndex === -1) return current;
        insertAt = position === "before" ? targetIndex : targetIndex + 1;
      }

      const [moved] = items.splice(fromIndex, 1);
      if (fromIndex < insertAt) insertAt -= 1;
      items.splice(insertAt, 0, moved);

      const sections = items.flatMap((item) =>
        item.kind === "section" ? [current.sections[item.index]] : [],
      );
      const unsectionedIndex = items.findIndex(
        (item) => item.kind === "unsectioned",
      );
      return {
        ...current,
        sections,
        unsectionedPosition:
          unsectionedIndex === -1 ? sections.length : unsectionedIndex,
      };
    });
  };

  const updateField = (
    sectionIndex: number,
    fieldIndex: number,
    updater: (field: DraftField) => DraftField,
  ) => {
    setDraft((current) => {
      const hasUnsectioned = current.unsectionedFields.length > 0;
      const unsectionedPosition = unsectionedPositionFor(current);
      if (hasUnsectioned && sectionIndex === unsectionedPosition) {
        return {
          ...current,
          unsectionedFields: current.unsectionedFields.map((field, index) =>
            index === fieldIndex ? updater(field) : field,
          ),
        };
      }
      const actualSectionIndex =
        sectionIndex -
        (hasUnsectioned && sectionIndex > unsectionedPosition ? 1 : 0);
      return {
        ...current,
        sections: current.sections.map((section, index) =>
          index === actualSectionIndex
            ? {
                ...section,
                fields: section.fields.map((field, fieldPosition) =>
                  fieldPosition === fieldIndex ? updater(field) : field,
                ),
              }
            : section,
        ),
      };
    });
  };

  const removeField = (sectionIndex: number, fieldIndex: number) => {
    setDraft((current) => {
      const hasUnsectioned = current.unsectionedFields.length > 0;
      const unsectionedPosition = unsectionedPositionFor(current);
      if (hasUnsectioned && sectionIndex === unsectionedPosition) {
        return {
          ...current,
          unsectionedFields: current.unsectionedFields.filter(
            (_, index) => index !== fieldIndex,
          ),
        };
      }
      const actualIndex =
        sectionIndex -
        (hasUnsectioned && sectionIndex > unsectionedPosition ? 1 : 0);
      return {
        ...current,
        sections: current.sections.map((section, index) =>
          index === actualIndex
            ? {
                ...section,
                fields: section.fields.filter(
                  (_, fieldPosition) => fieldPosition !== fieldIndex,
                ),
              }
            : section,
        ),
      };
    });
  };

  const updateButton = (
    index: number,
    updater: (button: DraftButton) => DraftButton,
  ) => {
    setDraft((current) => ({
      ...current,
      Buttons: current.Buttons.map((button, buttonIndex) =>
        buttonIndex === index ? updater(button) : button,
      ),
    }));
  };

  const updateRequest = (
    index: number,
    updater: (
      request: NonNullable<DraftButton["request"]>,
    ) => NonNullable<DraftButton["request"]>,
  ) => {
    updateButton(index, (current) => ({
      ...current,
      request: updater(
        current.request ?? {
          endpoint: "",
          httpMethod: "POST",
          contentType: "application/json",
          pathParams: {},
          queryParams: {},
          payloadMapping: [],
        },
      ),
    }));
  };

  const renderParamEditor = (
    buttonIndex: number,
    button: DraftButton,
    field: "pathParams" | "queryParams",
    title: string,
    hint: string,
  ) => {
    const entries = Object.entries(button.request?.[field] ?? {});
    return (
      <div className="field field-full">
        <span className="field-label">{title}</span>
        <span className="field-hint">{hint}</span>
        <div className="option-editor-list">
          {entries.map(([key, value], entryIndex) => (
            <div className="option-editor-row" key={`${field}-${entryIndex}`}>
              <input
                aria-label={`${title} name ${entryIndex + 1}`}
                className="input mono"
                placeholder="name"
                value={key}
                onChange={(event) => {
                  const next = Object.entries(button.request?.[field] ?? {});
                  next[entryIndex] = [
                    event.target.value,
                    next[entryIndex]?.[1] ?? "",
                  ];
                  updateRequest(buttonIndex, (request) => ({
                    ...request,
                    [field]: Object.fromEntries(next),
                  }));
                }}
              />
              <input
                aria-label={`${title} value ${entryIndex + 1}`}
                className="input"
                placeholder="value"
                value={String(value ?? "")}
                onChange={(event) => {
                  const next = Object.entries(button.request?.[field] ?? {});
                  next[entryIndex] = [
                    next[entryIndex]?.[0] ?? "",
                    event.target.value,
                  ];
                  updateRequest(buttonIndex, (request) => ({
                    ...request,
                    [field]: Object.fromEntries(next),
                  }));
                }}
              />
              <button
                aria-label={`Remove ${title.toLowerCase()} ${entryIndex + 1}`}
                className="icon-button danger-icon"
                type="button"
                onClick={() => {
                  const next = Object.entries(
                    button.request?.[field] ?? {},
                  ).filter((_, index) => index !== entryIndex);
                  updateRequest(buttonIndex, (request) => ({
                    ...request,
                    [field]: Object.fromEntries(next),
                  }));
                }}
              >
                <Icon name="trash" size={15} />
              </button>
            </div>
          ))}
        </div>
        <button
          className="add-inline option-add-button"
          type="button"
          onClick={() =>
            updateRequest(buttonIndex, (request) => ({
              ...request,
              [field]: { ...(request[field] ?? {}), "": "" },
            }))
          }
        >
          <Icon name="plus" size={15} /> Add {title.toLowerCase()}
        </button>
      </div>
    );
  };

  const renderQueryParamEditor = (
    buttonIndex: number,
    button: DraftButton,
  ) => {
    const entries = Object.entries(button.request?.queryParams ?? {});

    const setParam = (entryIndex: number, nextSource: QueryParamSource) => {
      const next = Object.entries(button.request?.queryParams ?? {});
      next[entryIndex] = [next[entryIndex]?.[0] ?? "", nextSource];
      updateRequest(buttonIndex, (request) => ({
        ...request,
        queryParams: Object.fromEntries(next),
      }));
    };

    const setParamName = (entryIndex: number, name: string) => {
      const next = Object.entries(button.request?.queryParams ?? {});
      next[entryIndex] = [name, next[entryIndex]?.[1] ?? ""];
      updateRequest(buttonIndex, (request) => ({
        ...request,
        queryParams: Object.fromEntries(next),
      }));
    };

    const removeParam = (entryIndex: number) => {
      const next = Object.entries(button.request?.queryParams ?? {}).filter(
        (_, index) => index !== entryIndex,
      );
      updateRequest(buttonIndex, (request) => ({
        ...request,
        queryParams: Object.fromEntries(next),
      }));
    };

    const addParam = () => {
      updateRequest(buttonIndex, (request) => {
        const current = request.queryParams ?? {};
        let suffix = 1;
        let name = `param${suffix}`;
        while (Object.prototype.hasOwnProperty.call(current, name)) {
          suffix += 1;
          name = `param${suffix}`;
        }
        return {
          ...request,
          queryParams: {
            ...current,
            [name]: {
              sourceType: "CONSTANT",
              sourceValue: "",
              sourceFieldCode: "",
            },
          },
        };
      });
    };

    return (
      <div className="field field-full">
        <span className="field-label">Query parameters</span>
        <span className="field-hint">
          Added to the endpoint as ?name=value. Database values like
          organizationId resolve automatically; other text is sent as-is.
        </span>
        <div className="option-editor-list">
          {entries.map(([key, value], entryIndex) => {
            const source = queryParamSource(value);

            return (
              <div
                className="field-grid compact mapping-editor"
                key={`queryParams-${entryIndex}`}
              >
                <label className="field">
                  <span className="field-label">Name</span>
                  <input
                    className="input mono"
                    placeholder="name"
                    value={key}
                    onChange={(event) =>
                      setParamName(entryIndex, event.target.value)
                    }
                  />
                </label>
                <label className="field">
                  <span className="field-label">Source type</span>
                  <select
                    className="input"
                    value={source.sourceType}
                    onChange={(event) =>
                      setParam(entryIndex, {
                        ...source,
                        sourceType: event.target
                          .value as QueryParamSourceType,
                      })
                    }
                  >
                    {QUERY_PARAM_SOURCE_TYPES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                {source.sourceType === "CONSTANT" ? (
                  <label className="field">
                    <span className="field-label">Database value</span>
                    <input
                      className="input mono"
                      placeholder="e.g. organizationId"
                      value={source.sourceValue}
                      onChange={(event) =>
                        setParam(entryIndex, {
                          ...source,
                          sourceValue: event.target.value,
                        })
                      }
                    />
                  </label>
                ) : (
                  <label className="field">
                    <span className="field-label">Source field code</span>
                    <input
                      className="input mono"
                      list="builder-field-codes"
                      placeholder="e.g. CLIENT_AGE"
                      value={source.sourceFieldCode}
                      onChange={(event) =>
                        setParam(entryIndex, {
                          ...source,
                          sourceFieldCode: event.target.value,
                        })
                      }
                    />
                  </label>
                )}
                <div className="query-param-remove">
                  <button
                    aria-label={`Remove query parameter ${entryIndex + 1}`}
                    className="icon-button danger-icon"
                    type="button"
                    onClick={() => removeParam(entryIndex)}
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <button
          className="add-inline option-add-button"
          type="button"
          onClick={addParam}
        >
          <Icon name="plus" size={15} /> Add query parameter
        </button>
      </div>
    );
  };

  const renderDefaultValue = (
    sectionIndex: number,
    fieldIndex: number,
    field: DraftField,
  ) => {
    const value = field.defaultValue;
    const setDefault = (next: unknown) =>
      updateField(sectionIndex, fieldIndex, (current) => ({
        ...current,
        defaultValue: next,
      }));
    const label = (
      <span className="field-label">
        Default value
      </span>
    );

    if (field.type === "CHECKBOX" || field.dataType === "BOOLEAN") {
      return (
        <label className="field">
          {label}
          <select
            className="input"
            value={value === true ? "true" : value === false ? "false" : ""}
            onChange={(event) =>
              setDefault(
                event.target.value === ""
                  ? undefined
                  : event.target.value === "true",
              )
            }
          >
            <option value="">No default</option>
            <option value="true">True</option>
            <option value="false">False</option>
          </select>
        </label>
      );
    }

    if (field.dataType === "NUMBER") {
      return (
        <label className="field">
          {label}
          <input
            className="input"
            inputMode="decimal"
            placeholder="e.g. 42"
            type="number"
            value={
              typeof value === "number" && Number.isFinite(value) ? value : ""
            }
            onChange={(event) =>
              setDefault(
                event.target.value === ""
                  ? undefined
                  : Number(event.target.value),
              )
            }
          />
        </label>
      );
    }

    if (field.dataType === "DATE" || field.dataType === "DATETIME") {
      return (
        <label className="field">
          {label}
          <input
            className="input"
            type={field.dataType === "DATETIME" ? "datetime-local" : "date"}
            value={typeof value === "string" ? value : ""}
            onChange={(event) =>
              setDefault(event.target.value || undefined)
            }
          />
        </label>
      );
    }

    return (
      <label className="field">
        {label}
        <input
          className="input"
          placeholder="e.g. Starting answer"
          value={
            typeof value === "string"
              ? value
              : value === undefined || value === null
                ? ""
                : String(value)
          }
          onChange={(event) => setDefault(event.target.value || undefined)}
        />
      </label>
    );
  };

  const validateDetails = (): boolean => {
    if (!draft.name.trim() || !draft.title.trim()) {
      setStep("details");
      setError("Add a form name and a title for people filling it out.");
      return false;
    }
    if (!form && !draft.formCode.trim()) {
      setStep("details");
      setError("Enter a unique form code.");
      return false;
    }
    return true;
  };

  const validateSections = (): boolean => {
    if (draft.sections.some((section) => !section.title.trim())) {
      setError("Give every section a name.");
      return false;
    }
    const allFields = [
      ...draft.unsectionedFields,
      ...draft.sections.flatMap((section) => section.fields),
    ];
    if (
      allFields.some((field) => !field.label.trim())
    ) {
      setError("Give every field a label, or remove the empty field.");
      return false;
    }
    if (
      allFields.some(
        (field) =>
          !Number.isInteger(field.displayOrder) || field.displayOrder < 0,
      )
    ) {
      setError("Field display order must be a whole number (0 or more).");
      return false;
    }
    if (
      allFields.some(
        (field) =>
          (field.type === "SELECT" || field.type === "MULTISELECT") &&
          !field.options.some((option) => option.label.trim()),
      )
    ) {
      setError("Add at least one answer choice to each choice field.");
      return false;
    }
    const invalidApiButton = draft.Buttons.find(
      (button) =>
        button.executionType === "API" &&
        (!button.request?.endpoint?.trim() || !button.request?.httpMethod),
    );
    if (invalidApiButton) {
      setError("API buttons need an endpoint and an HTTP method.");
      return false;
    }
    const invalidRouteButton = draft.Buttons.find(
      (button) =>
        button.executionType === "REACT_ROUTE" &&
        !button.responseHandling.onSuccess?.navigateTo?.trim(),
    );
    if (invalidRouteButton) {
      setError("REACT_ROUTE buttons need a redirect route.");
      return false;
    }
    const invalidClientActionButton = draft.Buttons.find(
      (button) =>
        button.executionType === "CLIENT_ACTION" &&
        !button.responseHandling.onSuccess?.responseMessage?.trim(),
    );
    if (invalidClientActionButton) {
      setError("CLIENT_ACTION buttons need a message to show to the user.");
      return false;
    }
    if (draft.Buttons.some((button) => !button.Buttonlabel.trim())) {
      setError("Give every button a label.");
      return false;
    }
    if (
      draft.Buttons.some(
        (button) =>
          !Number.isInteger(button.displayOrder) || button.displayOrder < 0,
      )
    ) {
      setError("Button display order must be a whole number (0 or more).");
      return false;
    }
    const knownFieldCodes = new Set(draftFieldCodes(draft));
    for (const button of draft.Buttons) {
      if (button.executionType !== "API") continue;
      for (const mapping of button.request?.payloadMapping ?? []) {
        if (
          !mapping.targetField.trim() ||
          !mapping.sourceType.trim() ||
          !mapping.sourceFieldCode.trim()
        ) {
          setError(
            "Complete every payload mapping: target field, source type and source field code are required.",
          );
          return false;
        }
        if (
          mapping.sourceType === "FORM_FIELD" &&
          !knownFieldCodes.has(mapping.sourceFieldCode)
        ) {
          setError(
            `Payload mapping source field "${mapping.sourceFieldCode}" does not match any field in this form.`,
          );
          return false;
        }
      }
      if (
        [
          ...(button.responseHandling.successStatusCodes ?? []),
          ...(button.responseHandling.failureStatusCodes ?? []),
        ].some(
          (status) => !Number.isInteger(status) || status < 100 || status > 599,
        )
      ) {
        setError("HTTP status codes must be valid whole numbers (100–599).");
        return false;
      }
    }
    return true;
  };

  const submit = () => {
    setError("");
    if (!validateDetails()) return;
    if (!validateSections()) {
      setStep("sections");
      return;
    }
    if (!form) {
      setConfirmCreate(true);
      return;
    }
    void onSave(buildFormPayload(draft, "update"));
  };

  const createDraft = async () => {
    setConfirmCreate(false);
    const saved = await onSave(buildFormPayload(draft, "create"));
    if (saved) clearStoredFormDraft();
  };

  const cancelBuilder = () => {
    if (form) {
      onCancel();
      return;
    }
    if (!draftHasContent(draft)) {
      clearStoredFormDraft();
      onCancel();
      return;
    }
    setConfirmCancel(true);
  };

  const keepDraftAndClose = () => {
    saveStoredFormDraft(draft, step);
    setConfirmCancel(false);
    onCancel();
  };

  const discardDraftAndClose = () => {
    clearStoredFormDraft();
    setConfirmCancel(false);
    onCancel();
  };

  const next = () => {
    setError("");
    if (validateDetails()) setStep("sections");
  };

  const hasUnsectionedFields = draft.unsectionedFields.length > 0;
  const unsectionedPosition = unsectionedPositionFor(draft);
  const editorSections: DraftSection[] = [...draft.sections];
  if (hasUnsectionedFields) {
    editorSections.splice(unsectionedPosition, 0, {
      sectionCode: UNSECTIONED_FIELDS_CODE,
      title: "",
      fields: draft.unsectionedFields,
    });
  }
  const editorIndexForNamedSection = (namedIndex: number): number =>
    namedIndex +
    (hasUnsectionedFields && namedIndex >= unsectionedPosition ? 1 : 0);
  const unsectionedEditorIndex = hasUnsectionedFields
    ? unsectionedPosition
    : draft.sections.length;
  const fieldCodeSuggestions = draftFieldCodes(draft);

  return createPortal(
    <div
      aria-labelledby="builder-title"
      aria-modal="true"
      className="builder-screen"
      role="dialog"
    >
      <header className="builder-header">
        <section className="builder-hero">
          <div className="builder-brandbar">
            <div className="builder-brand">
              <span className="builder-brand-mark">N</span>
              <span className="builder-brand-text">
                <strong>Nutri AI</strong>
                <small>Form workspace</small>
              </span>
            </div>
          </div>
          <div className="builder-hero-content">
            <div className="builder-breadcrumb" aria-label="Breadcrumb">
              <Icon name="home" size={16} />
              <Icon name="chevron-right" size={14} />
              <span>Form workspace</span>
              <Icon name="chevron-right" size={14} />
              <strong>
                {createVersion
                  ? "Create a new version"
                  : form
                    ? "Edit form"
                    : "Create a form"}
              </strong>
            </div>
            <h1 id="builder-title">
              {createVersion
                ? `New version of ${draft.name || "form"}`
                : form
                  ? draft.name || "Edit form"
                  : "Create a form"}
            </h1>
            <p className="builder-subtitle">
              {createVersion
                ? `Changes will be saved as a new draft version. Version ${form?.currentVersion ?? 1} stays published.`
                : form
                ? `Changes are saved as version ${(form.currentVersion ?? 0) + 1} when the definition changes.`
                : "Design and configure your dynamic form with ease."}
            </p>
          </div>
          <div className="builder-hero-visual" aria-hidden="true">
            <div className="builder-visual-edit">
              <Icon name="edit" size={30} />
            </div>
            <div className="builder-visual-card">
              {[0, 1, 2].map((item) => (
                <div className="builder-visual-row" key={item}>
                  <span className="builder-visual-check">
                    <Icon name="check" size={13} />
                  </span>
                  <span className="builder-visual-line" />
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="builder-stepbar">
          <nav className="builder-nav-steps" aria-label="Form builder steps">
            <div className="builder-nav-step-list">
              <button
                aria-current={step === "details" ? "step" : undefined}
                className={`builder-nav-step${step === "details" ? " active" : ""}`}
                type="button"
                onClick={() => setStep("details")}
              >
                <span className="step-number">1</span>
                <span className="builder-nav-step-text">
                  <strong>Form details</strong>
                </span>
              </button>
              <button
                aria-current={step === "sections" ? "step" : undefined}
                className={`builder-nav-step${step === "sections" ? " active" : ""}`}
                type="button"
                onClick={() => {
                  if (validateDetails()) setStep("sections");
                }}
              >
                <span className="step-number">2</span>
                <span className="builder-nav-step-text">
                  <strong>Sections &amp; fields</strong>
                </span>
              </button>
            </div>
          </nav>
          <span className="builder-stepbar-divider" aria-hidden="true" />
          <button className="builder-cancel" type="button" onClick={cancelBuilder}>
            <Icon name="arrow-left" size={15} />
            Cancel
          </button>
        </div>
      </header>

      <div className="builder-workspace">
        <main className="builder-main">
          <div className="builder-content">
            {error ? (
              <Notice tone="error" onDismiss={() => setError("")}>
                {error}
              </Notice>
            ) : null}
            {serverError ? (
              <Notice tone="error">{serverError}</Notice>
            ) : null}

            {step === "details" ? (
              <section className="builder-card">
                <header className="builder-card-head">
                  <p className="eyebrow">Step 1</p>
                  <h2>Organize your form details</h2>
                </header>
                <div className="builder-card-body">
                  <div className="field-grid">
                <label className={`field${form ? " field-full" : ""}`}>
                  <span className="field-label">
                    Form name <b>*</b>
                  </span>
                  <input
                    autoFocus
                    className="input"
                    placeholder="e.g. New client intake"
                    value={draft.name}
                    onChange={(event) => update("name", event.target.value)}
                  />
                </label>
                {!form ? (
                  <label className="field">
                    <span className="field-label">
                      Form code <b>*</b>
                    </span>
                    <input
                      className="input mono"
                      placeholder="e.g. MEDICAL_HISTORY"
                      required
                      value={draft.formCode}
                      onChange={(event) =>
                        update("formCode", event.target.value)
                      }
                    />
                    <span className="field-hint">
                      Enter a unique, stable code for this form.
                    </span>
                  </label>
                ) : null}
                <label className="field field-full">
                  <span className="field-label">
                    Title shown to the person filling it out <b>*</b>
                  </span>
                  <input
                    className="input"
                    placeholder="e.g. Tell us about yourself"
                    value={draft.title}
                    onChange={(event) => update("title", event.target.value)}
                  />
                </label>
                <label className="field field-full">
                  <span className="field-label">
                    Description
                  </span>
                  <textarea
                    className="input textarea"
                    placeholder="What is this form used for?"
                    rows={3}
                    value={draft.description}
                    onChange={(event) =>
                      update("description", event.target.value)
                    }
                  />
                </label>
                <label className="field">
                  <span className="field-label">Category</span>
                  <select
                    className="input"
                    value={draft.formType}
                    onChange={(event) =>
                      update("formType", event.target.value as FormDraft["formType"])
                    }
                  >
                    {FORM_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">Form layout</span>
                  <select
                    className="input"
                    value={draft.layout}
                    onChange={(event) =>
                      update("layout", event.target.value as FormDraft["layout"])
                    }
                  >
                    {LAYOUT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

                </div>
              </section>
            ) : (
              <section className="builder-card">
                <header className="builder-card-head">
                  <p className="eyebrow">Step 2</p>
                  <h2>Organize your form into sections and fields</h2>
                  <p>
                    Sections are optional. Add fields directly to the form or
                    organize them into named sections.
                  </p>
                </header>
                <div className="builder-card-body">
                  <div className="section-stack">
                {editorSections.map((section, sectionIndex) => {
                  const isUnsectioned =
                    section.sectionCode === UNSECTIONED_FIELDS_CODE;
                  const actualSectionIndex =
                    sectionIndex -
                    (hasUnsectionedFields && sectionIndex > unsectionedPosition
                      ? 1
                      : 0);
                  const dropKey = isUnsectioned
                    ? "unsectioned"
                    : String(actualSectionIndex);
                  const dropPosition =
                    dragOver?.key === dropKey ? dragOver.position : null;
                  const isDragging =
                    !isUnsectioned && draggingSection === actualSectionIndex;
                  return (
                  <section
                    className={`section-editor${isUnsectioned ? " section-editor-unsectioned" : ""}${isDragging ? " is-dragging" : ""}${dropPosition ? ` is-drop-${dropPosition}` : ""}`}
                    key={isUnsectioned ? UNSECTIONED_FIELDS_CODE : actualSectionIndex}
                    onDragEnter={(event) => {
                      event.preventDefault();
                    }}
                    onDragOver={(event) => {
                      if (draggingSection === null) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      const position = dropPositionFor(event);
                      setDragOver((current) =>
                        current?.key === dropKey &&
                        current.position === position
                          ? current
                          : { key: dropKey, position },
                      );
                    }}
                    onDragLeave={(event) => {
                      if (
                        !event.currentTarget.contains(
                          event.relatedTarget as Node | null,
                        )
                      ) {
                        setDragOver((current) =>
                          current?.key === dropKey ? null : current,
                        );
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const raw = event.dataTransfer.getData("text/plain");
                      const from =
                        draggingSection ?? (raw ? Number(raw) : null);
                      const position = dropPositionFor(event);
                      setDraggingSection(null);
                      setDragOver(null);
                      if (from === null || !Number.isFinite(from)) return;
                      moveSectionToTarget(from, dropKey, position);
                    }}
                  >
                    <header className="section-editor-head">
                      <div className="section-editor-tools">
                        {!isUnsectioned ? (
                          <>
                            <span
                              aria-hidden="true"
                              className="section-drag-handle"
                              draggable
                              title="Drag to reorder this section"
                              onDragEnd={() => {
                                setDraggingSection(null);
                                setDragOver(null);
                              }}
                              onDragStart={(event) => {
                                event.dataTransfer.effectAllowed = "move";
                                event.dataTransfer.setData(
                                  "text/plain",
                                  String(actualSectionIndex),
                                );
                                setDraggingSection(actualSectionIndex);
                              }}
                            >
                              <Icon name="grip" size={16} />
                            </span>
                            <span className="section-badge">
                              Section {actualSectionIndex + 1}
                            </span>
                          </>
                        ) : null}
                      </div>
                      {!isUnsectioned ? (
                        <button
                          className="btn btn-ghost btn-sm danger-text section-remove"
                          title="Remove section"
                          type="button"
                          onClick={() => {
                            const removed =
                              draft.sections[actualSectionIndex];
                            const removedFields = removed?.fields ?? [];
                            update(
                              "sections",
                              draft.sections.filter(
                                (_, index) => index !== actualSectionIndex,
                              ),
                            );
                            if (removedFields.length) {
                              update("unsectionedFields", [
                                ...draft.unsectionedFields,
                                ...removedFields,
                              ]);
                            }
                            if (hasUnsectionedFields) {
                              if (actualSectionIndex < unsectionedPosition) {
                                update(
                                  "unsectionedPosition",
                                  Math.max(0, unsectionedPosition - 1),
                                );
                              }
                            } else if (removedFields.length) {
                              update(
                                "unsectionedPosition",
                                actualSectionIndex,
                              );
                            }
                          }}
                        >
                          <Icon name="trash" size={15} /> Remove
                        </button>
                      ) : null}
                    </header>

                    {!isUnsectioned ? (
                      <div className="field-grid">
                        <label className="field">
                          <span className="field-label">
                            Section title <b aria-hidden="true">*</b>
                          </span>
                          <input
                            aria-required="true"
                            className="input"
                            placeholder="e.g. Personal details"
                            required
                            value={section.title}
                            onChange={(event) =>
                              updateSection(actualSectionIndex, (current) => ({
                                ...current,
                                title: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <label className="field">
                          <span className="field-label">Section code</span>
                          <input
                            className="input mono"
                            placeholder="Generated from the section title"
                            value={section.sectionCode}
                            onChange={(event) =>
                              updateSection(actualSectionIndex, (current) => ({
                                ...current,
                                sectionCode: event.target.value,
                              }))
                            }
                          />
                        </label>
                      </div>
                    ) : (
                      <div className="section-editor-note">
                        <strong>Fields without a section</strong>
                        <span>
                          These fields are not part of a named section.
                        </span>
                      </div>
                    )}

                    <div className="field-stack">
                      {section.fields.map((field, fieldIndex) => {
                        const key = fieldKey(sectionIndex, fieldIndex);
                        const isExpanded = expandedField === key;
                        const compatibleValueTypes = valueTypeOptionsFor(
                          field.dataType,
                        );
                        const currentTypeOption = FIELD_TYPE_OPTIONS.find(
                          (option) => option.value === field.type,
                        );
                        const valueTypeOptions =
                          currentTypeOption &&
                          !compatibleValueTypes.some(
                            (option) => option.value === field.type,
                          )
                            ? [...compatibleValueTypes, currentTypeOption]
                            : compatibleValueTypes;
                        const validationFields = validationFieldsFor(
                          field.dataType,
                          field.type,
                        );
                        return (
                        <article
                          className={`field-editor ${isExpanded ? "is-expanded" : "is-collapsed"}`}
                          key={fieldIndex}
                        >
                          <header className="field-editor-head">
                            <button
                              aria-expanded={isExpanded}
                              className="field-editor-toggle"
                              title={
                                isExpanded
                                  ? "Collapse this field"
                                  : "Show all field settings"
                              }
                              type="button"
                              onClick={() =>
                                setExpandedField(isExpanded ? null : key)
                              }
                            >
                              <span className="field-index">
                                F{fieldIndex + 1}
                              </span>
                              <span className="field-editor-title">
                                <strong>
                                  {field.label.trim() || "Field"}
                                </strong>
                                <span>
                                  {FIELD_TYPE_OPTIONS.find(
                                    (option) => option.value === field.type,
                                  )?.label ?? field.type}
                                  {" · "}
                                  {DATA_TYPE_OPTIONS.find(
                                    (option) =>
                                      option.value === field.dataType,
                                  )?.label ?? field.dataType}
                                </span>
                              </span>
                              <Icon name="chevron-right" size={16} />
                            </button>
                            <button
                              className="btn btn-ghost btn-sm danger-text field-remove"
                              title="Remove field"
                              type="button"
                              onClick={() =>
                                removeField(sectionIndex, fieldIndex)
                              }
                            >
                              <Icon name="trash" size={15} /> Remove
                            </button>
                          </header>

                          {isExpanded ? (
                            <>
                          <label className="field">
                            <span className="field-label">
                              Field <b>*</b>
                            </span>
                            <input
                              className="input"
                              placeholder="e.g. What is your date of birth?"
                              value={field.label}
                              onChange={(event) =>
                                updateField(sectionIndex, fieldIndex, (current) => ({
                                  ...current,
                                  label: event.target.value,
                                }))
                              }
                            />
                          </label>

                          <div className="field-grid compact">
                            <label className="field">
                              <span className="field-label">Field code</span>
                              <input
                                className="input mono"
                                placeholder="Generated from the field label"
                                value={field.fieldCode}
                                onChange={(event) =>
                                  updateField(
                                    sectionIndex,
                                    fieldIndex,
                                    (current) => ({
                                      ...current,
                                      fieldCode: event.target.value,
                                    }),
                                  )
                                }
                              />
                            </label>
                            <label className="field">
                              <span className="field-label">Data type</span>
                              <select
                                className="input"
                                value={field.dataType}
                                onChange={(event) => {
                                  const dataType = event.target
                                    .value as DataType;
                                  const allowed = valueTypeOptionsFor(dataType);
                                  updateField(
                                    sectionIndex,
                                    fieldIndex,
                                    (current) => {
                                      const type = allowed.some(
                                        (option) =>
                                          option.value === current.type,
                                      )
                                        ? current.type
                                        : defaultValueTypeFor(dataType);
                                      return {
                                        ...current,
                                        dataType,
                                        type,
                                        defaultValue: undefined,
                                        validation: filterValidationForType(
                                          current.validation,
                                          dataType,
                                          type,
                                        ),
                                        optionsDisplayType:
                                          type === "SELECT"
                                            ? "RADIO"
                                            : type === "MULTISELECT"
                                              ? current.optionsDisplayType ===
                                                "DROPDOWN"
                                                ? "DROPDOWN"
                                                : "CHECKBOXES"
                                              : "DROPDOWN",
                                        options:
                                          type === "SELECT" ||
                                          type === "MULTISELECT"
                                            ? current.options
                                            : [],
                                      };
                                    },
                                  );
                                }}
                              >
                                {DATA_TYPE_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                              <span className="field-hint">
                                {field.dataType === "DATE" ||
                                field.dataType === "DATETIME"
                                  ? "Choose Date and time to also collect a time."
                                  : "The available value types are limited to those that fit this data type."}
                              </span>
                            </label>
                            <label className="field">
                              <span className="field-label">Value type</span>
                              <select
                                className="input"
                                value={field.type}
                                onChange={(event) => {
                                  const type = event.target.value as FieldType;
                                  updateField(
                                    sectionIndex,
                                    fieldIndex,
                                    (current) => ({
                                      ...current,
                                      type,
                                      defaultValue: undefined,
                                      validation: filterValidationForType(
                                        current.validation,
                                        current.dataType,
                                        type,
                                      ),
                                      optionsDisplayType:
                                        type === "SELECT"
                                          ? "RADIO"
                                          : type === "MULTISELECT"
                                            ? current.optionsDisplayType ===
                                              "DROPDOWN"
                                              ? "DROPDOWN"
                                              : "CHECKBOXES"
                                            : "DROPDOWN",
                                      options:
                                        type === "SELECT" ||
                                        type === "MULTISELECT"
                                          ? current.options
                                          : [],
                                    }),
                                  );
                                }}
                              >
                                {valueTypeOptions.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                              <span className="field-hint">
                                How the answer is entered. Options depend on the
                                data type.
                              </span>
                            </label>
                            <label className="field">
                              <span className="field-label">
                                Placeholder
                              </span>
                              <input
                                className="input"
                                placeholder="Hint inside the answer box"
                                value={field.placeholder}
                                onChange={(event) =>
                                  updateField(
                                    sectionIndex,
                                    fieldIndex,
                                    (current) => ({
                                      ...current,
                                      placeholder: event.target.value,
                                    }),
                                  )
                                }
                              />
                            </label>
                            {field.type === "SELECT" ||
                            field.type === "MULTISELECT"
                              ? null
                              : renderDefaultValue(
                                  sectionIndex,
                                  fieldIndex,
                                  field,
                                )}
                            <label className="field">
                              <span className="field-label">Display order</span>
                              <input
                                className="input"
                                inputMode="numeric"
                                min={0}
                                step={1}
                                type="number"
                                value={
                                  Number.isFinite(field.displayOrder)
                                    ? field.displayOrder
                                    : ""
                                }
                                onChange={(event) =>
                                  updateField(
                                    sectionIndex,
                                    fieldIndex,
                                    (current) => ({
                                      ...current,
                                      displayOrder:
                                        event.target.value === ""
                                          ? Number.NaN
                                          : Number(event.target.value),
                                    }),
                                  )
                                }
                              />
                              <span className="field-hint">
                                Position within its section.
                              </span>
                            </label>
                            <div className="checkbox-row">
                              <label className="checkbox">
                                <input
                                  checked={field.isRequired}
                                  type="checkbox"
                                  onChange={(event) =>
                                    updateField(
                                      sectionIndex,
                                      fieldIndex,
                                      (current) => ({
                                        ...current,
                                        isRequired: event.target.checked,
                                      }),
                                    )
                                  }
                                />
                                <span>Required</span>
                              </label>
                              <label className="checkbox">
                                <input
                                  checked={field.isEnabled}
                                  type="checkbox"
                                  onChange={(event) =>
                                    updateField(
                                      sectionIndex,
                                      fieldIndex,
                                      (current) => ({
                                        ...current,
                                        isEnabled: event.target.checked,
                                      }),
                                    )
                                  }
                                />
                                <span>Enabled</span>
                              </label>
                            </div>
                          </div>

                          {field.type === "SELECT" ||
                          field.type === "MULTISELECT" ? (
                            <div className="field-grid compact">
                              {field.type === "MULTISELECT" ? (
                                <label className="field">
                                  <span className="field-label">Display style</span>
                                  <select
                                    className="input"
                                    value={field.optionsDisplayType}
                                    onChange={(event) =>
                                      updateField(
                                        sectionIndex,
                                        fieldIndex,
                                        (current) => ({
                                          ...current,
                                          optionsDisplayType: event.target
                                            .value as DraftField["optionsDisplayType"],
                                        }),
                                      )
                                    }
                                  >
                                    <option value="DROPDOWN">
                                      Dropdown (multiple selection)
                                    </option>
                                    <option value="CHECKBOXES">
                                      Checkboxes
                                    </option>
                                  </select>
                                </label>
                              ) : (
                                <p className="field-hint">
                                  Choose one displays answer choices as radio
                                  buttons.
                                </p>
                              )}
                              <div className="field field-full">
                                <span className="field-label">Answer choices</span>
                                <div className="option-editor-list">
                                  {field.options.map((option, optionIndex) => (
                                    <div
                                      className="option-editor-row"
                                      key={optionIndex}
                                    >
                                      <span className="option-editor-index">
                                        {optionIndex + 1}
                                      </span>
                                      <input
                                        aria-label={`Option ${optionIndex + 1}`}
                                        className="input"
                                        placeholder={`Option ${optionIndex + 1}`}
                                        value={option.label}
                                        onChange={(event) =>
                                          updateField(
                                            sectionIndex,
                                            fieldIndex,
                                            (current) => ({
                                              ...current,
                                              options: current.options.map(
                                                (item, index) =>
                                                  index === optionIndex
                                                    ? {
                                                        ...item,
                                                        label: event.target.value,
                                                        value: makeCode(
                                                          event.target.value,
                                                          `OPTION_${index + 1}`,
                                                        ),
                                                      }
                                                    : item,
                                              ),
                                            }),
                                          )
                                        }
                                      />
                                      <button
                                        aria-label={`Remove option ${optionIndex + 1}`}
                                        className="icon-button danger-icon"
                                        type="button"
                                        onClick={() =>
                                          updateField(
                                            sectionIndex,
                                            fieldIndex,
                                            (current) => ({
                                              ...current,
                                              options: current.options.filter(
                                                (_, index) =>
                                                  index !== optionIndex,
                                              ),
                                            }),
                                          )
                                        }
                                      >
                                        <Icon name="trash" size={15} />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                                <button
                                  className="add-inline option-add-button"
                                  type="button"
                                  onClick={() =>
                                    updateField(
                                      sectionIndex,
                                      fieldIndex,
                                      (current) => ({
                                        ...current,
                                        options: [
                                          ...current.options,
                                          {
                                            value: "",
                                            label: "",
                                          },
                                        ],
                                      }),
                                    )
                                  }
                                >
                                  <Icon name="plus" size={15} /> Add option
                                </button>
                              </div>
                            </div>
                          ) : null}

                          {validationFields.length ? (
                            <div className="field-advanced">
                              <h4 className="field-advanced-title">
                                Validation rules
                              </h4>
                              <div className="validation-grid">
                                {validationFields.map((rule) => (
                                  <label className="field" key={rule.key}>
                                    <span className="field-label">
                                      {rule.label}
                                    </span>
                                    <input
                                      className="input"
                                      inputMode="numeric"
                                      placeholder={rule.hint}
                                      type="number"
                                      value={field.validation[rule.key] ?? ""}
                                      onChange={(event) =>
                                        updateField(
                                          sectionIndex,
                                          fieldIndex,
                                          (current) => ({
                                            ...current,
                                            validation: {
                                              ...current.validation,
                                              [rule.key]: event.target.value,
                                            },
                                          }),
                                        )
                                      }
                                    />
                                  </label>
                                ))}
                              </div>
                            </div>
                          ) : null}
                            </>
                          ) : null}
                        </article>
                        );
                      })}
                    </div>

                  </section>
                  );
                })}
              </div>

              <div className="builder-add-row">
                <button
                  className="add-inline add-action-button"
                  disabled={!draft.sections.length}
                  type="button"
                  onClick={() => {
                    const targetSectionIndex = draft.sections.length - 1;
                    const targetSection = draft.sections[targetSectionIndex];
                    if (!targetSection) return;
                    const nextIndex = targetSection.fields.length;
                    updateSection(targetSectionIndex, (current) => ({
                      ...current,
                      fields: [...current.fields, emptyField("", nextIndex)],
                    }));
                    setExpandedField(
                      fieldKey(
                        editorIndexForNamedSection(targetSectionIndex),
                        nextIndex,
                      ),
                    );
                  }}
                >
                  <Icon name="plus" size={15} /> Add a field
                </button>
                <button
                  className="add-inline add-action-button"
                  type="button"
                  onClick={() => {
                    const newSectionIndex = draft.sections.length;
                    update("sections", [
                      ...draft.sections,
                      emptySection(newSectionIndex),
                    ]);
                    setExpandedField(
                      fieldKey(editorIndexForNamedSection(newSectionIndex), 0),
                    );
                  }}
                >
                  <Icon name="plus" size={15} /> Add a section
                </button>
                <button
                  className="add-inline add-action-button"
                  type="button"
                  onClick={() => {
                    const nextIndex = draft.unsectionedFields.length;
                    update("unsectionedPosition", unsectionedEditorIndex);
                    update("unsectionedFields", [
                      ...draft.unsectionedFields,
                      emptyField("", nextIndex),
                    ]);
                    setExpandedField(
                      fieldKey(unsectionedEditorIndex, nextIndex),
                    );
                  }}
                >
                  <Icon name="plus" size={15} /> Add a field without a section
                </button>
              </div>

              <details className="advanced-block">
                <summary>
                  <Icon name="send" size={16} />
                  Form buttons
                  {draft.Buttons.length ? (
                    <span>{`${draft.Buttons.length} configured`}</span>
                  ) : null}
                </summary>
                <p className="small muted detail-intro">
                  Buttons can call an API, open a page, or show a message. API
                  buttons are available in the preview.
                </p>
                <datalist id="builder-field-codes">
                  {fieldCodeSuggestions.map((code) => (
                    <option key={code} value={code} />
                  ))}
                </datalist>
                <datalist id="builder-source-types">
                  <option value="FORM_FIELD" />
                </datalist>
                <div className="field-stack">
                  {draft.Buttons.map((button, index) => (
                    <article
                      className={`field-editor button-editor ${
                        expandedButton === index ? "is-expanded" : "is-collapsed"
                      }`}
                      key={index}
                    >
                      <header className="field-editor-head">
                        <button
                          aria-expanded={expandedButton === index}
                          className="field-editor-toggle"
                          title={
                            expandedButton === index
                              ? "Collapse this button"
                              : "Show all button settings"
                          }
                          type="button"
                          onClick={() =>
                            setExpandedButton(
                              expandedButton === index ? null : index,
                            )
                          }
                        >
                          <span className="field-index">B{index + 1}</span>
                          <span className="field-editor-title">
                            <strong>
                              {button.Buttonlabel.trim() || "Button label"}
                            </strong>
                            <span>
                              {EXECUTION_TYPE_OPTIONS.find(
                                (option) =>
                                  option.value === button.executionType,
                              )?.label ?? button.executionType}
                              {" · "}
                              {button.isEnabled ? "Enabled" : "Disabled"}
                            </span>
                          </span>
                          <Icon name="chevron-right" size={16} />
                        </button>
                        <button
                          className="btn btn-ghost btn-sm danger-text field-remove"
                          title="Remove button"
                          type="button"
                          onClick={() => {
                            update(
                              "Buttons",
                              draft.Buttons.filter(
                                (_, buttonIndex) => buttonIndex !== index,
                              ),
                            );
                            setExpandedButton((current) =>
                              current === null || current === index
                                ? null
                                : current > index
                                  ? current - 1
                                  : current,
                            );
                          }}
                        >
                          <Icon name="trash" size={15} /> Remove
                        </button>
                      </header>
                      {expandedButton === index ? (
                        <>
                      <div className="field-grid compact">
                        <label className="field">
                          <span className="field-label">
                            Button code
                          </span>
                          <input
                            className="input mono"
                            placeholder="e.g. SUBMIT_INTAKE"
                            value={button.ButtonCode}
                            onChange={(event) =>
                              updateButton(index, (current) => ({
                                ...current,
                                ButtonCode: event.target.value,
                              }))
                            }
                          />
                          <span className="field-hint">
                            Generated from the label when left blank.
                          </span>
                        </label>
                        <label className="field">
                          <span className="field-label">
                            Button label <b>*</b>
                          </span>
                          <input
                            className="input"
                            value={button.Buttonlabel}
                            onChange={(event) =>
                              updateButton(index, (current) => ({
                                ...current,
                                Buttonlabel: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <label className="field field-full">
                          <span className="field-label">Description</span>
                          <input
                            className="input"
                            placeholder="What does this button do?"
                            value={button.description}
                            onChange={(event) =>
                              updateButton(index, (current) => ({
                                ...current,
                                description: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <label className="field">
                          <span className="field-label">Action</span>
                          <select
                            className="input"
                            value={button.executionType}
                            onChange={(event) => {
                              const executionType = event.target
                                .value as ExecutionType;
                              updateButton(index, (current) => ({
                                ...current,
                                executionType,
                                request:
                                  executionType === "API"
                                    ? current.request ?? {
                                        endpoint: "",
                                        httpMethod: "POST",
                                        contentType: "application/json",
                                        pathParams: {},
                                        queryParams: {},
                                        payloadMapping: [],
                                      }
                                    : null,
                              }));
                            }}
                          >
                            {EXECUTION_TYPE_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          <span className="field-label">Display order</span>
                          <input
                            className="input"
                            inputMode="numeric"
                            min={0}
                            step={1}
                            type="number"
                            value={
                              Number.isFinite(button.displayOrder)
                                ? button.displayOrder
                                : ""
                            }
                            onChange={(event) =>
                              updateButton(index, (current) => ({
                                ...current,
                                displayOrder:
                                  event.target.value === ""
                                    ? Number.NaN
                                    : Number(event.target.value),
                              }))
                            }
                          />
                        </label>
                        <div className="checkbox-row">
                          <label className="checkbox">
                            <input
                              checked={button.isEnabled}
                              type="checkbox"
                              onChange={(event) =>
                                updateButton(index, (current) => ({
                                  ...current,
                                  isEnabled: event.target.checked,
                                }))
                              }
                            />
                            <span>Enabled</span>
                          </label>
                        </div>
                      </div>

                      {button.executionType === "API" ? (
                        <>
                          <div className="field-grid compact">
                            <label className="field field-wide">
                              <span className="field-label">
                                API endpoint <b>*</b>
                              </span>
                              <input
                                className="input mono"
                                placeholder="/assessments/submit"
                                value={button.request?.endpoint ?? ""}
                                onChange={(event) =>
                                  updateRequest(index, (request) => ({
                                    ...request,
                                    endpoint: event.target.value,
                                  }))
                                }
                              />
                            </label>
                            <label className="field">
                              <span className="field-label">Method</span>
                              <select
                                className="input"
                                value={
                                  codeOf(button.request?.httpMethod) || "POST"
                                }
                                onChange={(event) =>
                                  updateRequest(index, (request) => ({
                                    ...request,
                                    httpMethod: event.target.value as HttpMethod,
                                  }))
                                }
                              >
                                {HTTP_METHOD_OPTIONS.map((method) => (
                                  <option key={method} value={method}>
                                    {method}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="field">
                              <span className="field-label">Content type</span>
                              <input
                                className="input mono"
                                placeholder="application/json"
                                value={button.request?.contentType ?? ""}
                                onChange={(event) =>
                                  updateRequest(index, (request) => ({
                                    ...request,
                                    contentType: event.target.value,
                                  }))
                                }
                              />
                            </label>
                          </div>

                          <div className="field-grid compact">
                            {renderParamEditor(
                              index,
                              button,
                              "pathParams",
                              "Path parameters",
                              "Values replace {name} placeholders in the endpoint.",
                            )}
                            {renderQueryParamEditor(index, button)}
                          </div>

                          <div className="field field-full">
                            <span className="field-label">Payload mapping</span>
                            <span className="field-hint">
                              Map form answers to the fields the API expects.
                              When empty, every enabled answer is sent.
                            </span>
                            <div className="option-editor-list">
                              {(button.request?.payloadMapping ?? []).map(
                                (mapping, mappingIndex) => (
                                  <div
                                    className="field-grid compact mapping-editor"
                                    key={mappingIndex}
                                  >
                                    <label className="field">
                                      <span className="field-label">
                                        Target field <b>*</b>
                                      </span>
                                      <input
                                        className="input mono"
                                        placeholder="age"
                                        value={mapping.targetField}
                                        onChange={(event) =>
                                          updateRequest(index, (request) => ({
                                            ...request,
                                            payloadMapping: (
                                              request.payloadMapping ?? []
                                            ).map((item, itemIndex) =>
                                              itemIndex === mappingIndex
                                                ? {
                                                    ...item,
                                                    targetField:
                                                      event.target.value,
                                                  }
                                                : item,
                                            ),
                                          }))
                                        }
                                      />
                                    </label>
                                    <label className="field">
                                      <span className="field-label">
                                        Source type <b>*</b>
                                      </span>
                                      <input
                                        className="input mono"
                                        list="builder-source-types"
                                        placeholder="FORM_FIELD"
                                        value={mapping.sourceType}
                                        onChange={(event) =>
                                          updateRequest(index, (request) => ({
                                            ...request,
                                            payloadMapping: (
                                              request.payloadMapping ?? []
                                            ).map((item, itemIndex) =>
                                              itemIndex === mappingIndex
                                                ? {
                                                    ...item,
                                                    sourceType:
                                                      event.target.value,
                                                  }
                                                : item,
                                            ),
                                          }))
                                        }
                                      />
                                    </label>
                                    <label className="field">
                                      <span className="field-label">
                                        Source field code <b>*</b>
                                      </span>
                                      <input
                                        className="input mono"
                                        list="builder-field-codes"
                                        placeholder="CLIENT_AGE"
                                        value={mapping.sourceFieldCode}
                                        onChange={(event) =>
                                          updateRequest(index, (request) => ({
                                            ...request,
                                            payloadMapping: (
                                              request.payloadMapping ?? []
                                            ).map((item, itemIndex) =>
                                              itemIndex === mappingIndex
                                                ? {
                                                    ...item,
                                                    sourceFieldCode:
                                                      event.target.value,
                                                  }
                                                : item,
                                            ),
                                          }))
                                        }
                                      />
                                    </label>
                                    <div className="checkbox-row">
                                      <label className="checkbox">
                                        <input
                                          checked={mapping.required}
                                          type="checkbox"
                                          onChange={(event) =>
                                            updateRequest(
                                              index,
                                              (request) => ({
                                                ...request,
                                                payloadMapping: (
                                                  request.payloadMapping ?? []
                                                ).map((item, itemIndex) =>
                                                  itemIndex === mappingIndex
                                                    ? {
                                                        ...item,
                                                        required:
                                                          event.target.checked,
                                                      }
                                                    : item,
                                                ),
                                              }),
                                            )
                                          }
                                        />
                                        <span>Required</span>
                                      </label>
                                      <button
                                        aria-label={`Remove payload mapping ${mappingIndex + 1}`}
                                        className="icon-button danger-icon"
                                        type="button"
                                        onClick={() =>
                                          updateRequest(index, (request) => ({
                                            ...request,
                                            payloadMapping: (
                                              request.payloadMapping ?? []
                                            ).filter(
                                              (_, itemIndex) =>
                                                itemIndex !== mappingIndex,
                                            ),
                                          }))
                                        }
                                      >
                                        <Icon name="trash" size={15} />
                                      </button>
                                    </div>
                                  </div>
                                ),
                              )}
                            </div>
                            <button
                              className="add-inline option-add-button"
                              type="button"
                              onClick={() =>
                                updateRequest(index, (request) => ({
                                  ...request,
                                  payloadMapping: [
                                    ...(request.payloadMapping ?? []),
                                    {
                                      targetField: "",
                                      sourceType: "FORM_FIELD",
                                      sourceFieldCode: "",
                                      required: false,
                                    },
                                  ],
                                }))
                              }
                            >
                              <Icon name="plus" size={15} /> Add payload mapping
                            </button>
                          </div>
                        </>
                      ) : null}

                      {button.executionType === "API" ? (
                        <section className="response-handling field-full">
                          <h4>Response handling</h4>
                          <div className="response-handling-grid">
                            <div className="response-outcome">
                              <h5>Success</h5>
                              <HttpStatusCodeEditor
                                codes={
                                  button.responseHandling.successStatusCodes ??
                                  []
                                }
                                hint="Optional. Empty means any 2xx response is successful."
                                label="Success status codes"
                                options={HTTP_SUCCESS_STATUS_OPTIONS}
                                onChange={(successStatusCodes) =>
                                  updateButton(index, (current) => ({
                                    ...current,
                                    responseHandling: {
                                      ...current.responseHandling,
                                      successStatusCodes,
                                    },
                                  }))
                                }
                              />
                              <ResponseMessageField
                                hint="Enter the response path."
                                label="Success message"
                                value={
                                  button.responseHandling.onSuccess
                                    ?.responseMessage ?? ""
                                }
                                onChange={(responseMessage) =>
                                  updateButton(index, (current) => ({
                                    ...current,
                                    responseHandling: {
                                      ...current.responseHandling,
                                      onSuccess: {
                                        ...current.responseHandling.onSuccess,
                                        responseMessage,
                                      },
                                    },
                                  }))
                                }
                              />
                              <label className="field">
                                <span className="field-label">
                                  Redirect after success
                                </span>
                                <input
                                  className="input mono"
                                  placeholder="/assessments"
                                  value={
                                    button.responseHandling.onSuccess
                                      ?.navigateTo ?? ""
                                  }
                                  onChange={(event) =>
                                    updateButton(index, (current) => ({
                                      ...current,
                                      responseHandling: {
                                        ...current.responseHandling,
                                        onSuccess: {
                                          ...current.responseHandling.onSuccess,
                                          navigateTo: event.target.value,
                                        },
                                      },
                                    }))
                                  }
                                />
                              </label>
                            </div>
                            <div className="response-outcome">
                              <h5>Failure</h5>
                              <HttpStatusCodeEditor
                                codes={
                                  button.responseHandling.failureStatusCodes ??
                                  []
                                }
                                hint="Optional. Matching codes are treated as failures; non-2xx responses fail by default."
                                label="Failure status codes"
                                options={HTTP_FAILURE_STATUS_OPTIONS}
                                searchable
                                onChange={(failureStatusCodes) =>
                                  updateButton(index, (current) => ({
                                    ...current,
                                    responseHandling: {
                                      ...current.responseHandling,
                                      failureStatusCodes,
                                    },
                                  }))
                                }
                              />
                              <ResponseMessageField
                                hint="Enter the response path."
                                label="Failure message"
                                value={
                                  button.responseHandling.onFailure
                                    ?.responseMessage ?? ""
                                }
                                onChange={(responseMessage) =>
                                  updateButton(index, (current) => ({
                                    ...current,
                                    responseHandling: {
                                      ...current.responseHandling,
                                      onFailure: {
                                        ...current.responseHandling.onFailure,
                                        responseMessage,
                                      },
                                    },
                                  }))
                                }
                              />
                              <label className="field">
                                <span className="field-label">
                                  Redirect after failure
                                </span>
                                <input
                                  className="input mono"
                                  placeholder="/forms/error"
                                  value={
                                    button.responseHandling.onFailure
                                      ?.navigateTo ?? ""
                                  }
                                  onChange={(event) =>
                                    updateButton(index, (current) => ({
                                      ...current,
                                      responseHandling: {
                                        ...current.responseHandling,
                                        onFailure: {
                                          ...current.responseHandling.onFailure,
                                          navigateTo: event.target.value,
                                        },
                                      },
                                    }))
                                  }
                                />
                              </label>
                            </div>
                          </div>
                        </section>
                      ) : null}

                      {button.executionType === "REACT_ROUTE" ? (
                        <div className="field-grid compact">
                          <label className="field field-full">
                            <span className="field-label">
                              Redirect route <b>*</b>
                            </span>
                            <input
                              className="input mono"
                              placeholder="/assessments"
                              value={
                                button.responseHandling.onSuccess?.navigateTo ??
                                ""
                              }
                              onChange={(event) =>
                                updateButton(index, (current) => ({
                                  ...current,
                                  responseHandling: {
                                    ...current.responseHandling,
                                    onSuccess: {
                                      ...current.responseHandling.onSuccess,
                                      navigateTo: event.target.value,
                                    },
                                  },
                                }))
                              }
                            />
                            <span className="field-hint">
                              The person filling the form is sent to this route
                              after clicking the button.
                            </span>
                          </label>
                        </div>
                      ) : null}

                      {button.executionType === "CLIENT_ACTION" ? (
                        <div className="field-grid compact">
                          <label className="field field-full">
                            <span className="field-label">
                              Message <b>*</b>
                            </span>
                            <input
                              className="input"
                              placeholder="e.g. Thanks! Your details have been saved."
                              value={
                                button.responseHandling.onSuccess
                                  ?.responseMessage ?? ""
                              }
                              onChange={(event) =>
                                updateButton(index, (current) => ({
                                  ...current,
                                  responseHandling: {
                                    ...current.responseHandling,
                                    onSuccess: {
                                      ...current.responseHandling.onSuccess,
                                      responseMessage: event.target.value,
                                    },
                                  },
                                }))
                              }
                            />
                            <span className="field-hint">
                              Shown to the person filling the form when they
                              click this button.
                            </span>
                          </label>
                        </div>
                      ) : null}
                        </>
                      ) : null}
                    </article>
                  ))}
                </div>
                <button
                  className="add-inline"
                  type="button"
                  onClick={() => {
                    setExpandedButton(draft.Buttons.length);
                    update("Buttons", [
                      ...draft.Buttons,
                      emptyButton(draft.Buttons.length),
                    ]);
                  }}
                >
                  <Icon name="plus" size={15} /> Add a button
                </button>
              </details>
                </div>
              </section>
            )}

            <div className="builder-form-actions">
              {step === "sections" ? (
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => {
                    setStep("details");
                    setError("");
                  }}
                >
                  Back to details
                </button>
              ) : null}
              {step === "details" ? (
                <button className="btn btn-primary" type="button" onClick={next}>
                  Continue to sections &amp; fields{" "}
                  <Icon name="arrow-right" size={16} />
                </button>
              ) : (
                <button
                  className="btn btn-primary"
                  disabled={saving}
                  type="button"
                  onClick={submit}
                >
                  {saving
                    ? "Saving…"
                    : createVersion
                      ? "Create version"
                      : form
                      ? "Save changes"
                      : "Create form"}
                </button>
              )}
            </div>
          </div>
        </main>
      </div>
      <ConfirmDialog
        open={confirmCreate}
        title="Create this form draft?"
        message="Are you sure you want to create this form as a draft?"
        confirmLabel="Yes, create draft"
        cancelLabel="Cancel"
        busy={saving}
        wide
        onCancel={() => {
          if (!saving) setConfirmCreate(false);
        }}
        onConfirm={createDraft}
      >
        <FormDraftPreview draft={draft} />
      </ConfirmDialog>
      <ConfirmDialog
        open={confirmCancel}
        title="Keep this draft for later?"
        message="You can keep your progress and continue later, or discard the draft and all of its entered details."
        confirmLabel="Discard draft"
        cancelLabel="Keep draft and close"
        tone="danger"
        closeOnBackdrop={false}
        onBackdropClick={() => setConfirmCancel(false)}
        onCancel={keepDraftAndClose}
        onConfirm={discardDraftAndClose}
      />
    </div>,
    document.body,
  );
}
