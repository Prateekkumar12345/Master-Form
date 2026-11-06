import type { DraftField, FormDraft } from "../types";
import { unsectionedPositionFor } from "../formModel";
import { labelize, validationSummary } from "../utils";
import { PreviewMultiSelect } from "./PreviewMultiSelect";

function DraftFieldPreview({ field }: { field: DraftField }) {
  const common = {
    className: "input",
    disabled: true,
    required: field.isRequired,
    placeholder: field.placeholder || undefined,
  };

  return (
    <div className="draft-preview-field">
      <label
        className="field-label"
        htmlFor={
          field.type === "MULTISELECT" &&
          field.optionsDisplayType === "DROPDOWN"
            ? field.fieldCode
            : undefined
        }
      >
        {field.label || "Untitled field"}
        {field.isRequired ? <b> *</b> : null}
      </label>
      {field.type === "TEXTAREA" ? (
        <textarea {...common} rows={3} defaultValue="" />
      ) : field.type === "CHECKBOX" ? (
        <label className="checkbox">
          <input checked={Boolean(field.defaultValue)} disabled type="checkbox" />
          <span>{field.placeholder || "Yes"}</span>
        </label>
      ) : field.type === "SELECT" ? (
        field.optionsDisplayType === "RADIO" ? (
          <div className="choice-list">
            {field.options.map((option, index) => (
              <label className="checkbox" key={`${option.value}-${index}`}>
                <input
                  disabled
                  name={field.fieldCode}
                  type="radio"
                />
                <span>{option.label || `Option ${index + 1}`}</span>
              </label>
            ))}
          </div>
        ) : (
          <select {...common} defaultValue="">
            <option value="">Select an option</option>
            {field.options.map((option, index) => (
              <option key={`${option.value}-${index}`} value={option.value}>
                {option.label || `Option ${index + 1}`}
              </option>
            ))}
          </select>
        )
      ) : field.type === "MULTISELECT" ? (
        field.optionsDisplayType === "DROPDOWN" ? (
          <PreviewMultiSelect
            id={field.fieldCode}
            options={field.options.map((option, index) => ({
              ...option,
              label: option.label || `Option ${index + 1}`,
            }))}
            value={[]}
            readOnly
          />
        ) : (
          <div className="choice-list">
            {field.options.map((option, index) => (
              <label className="checkbox" key={`${option.value}-${index}`}>
                <input disabled type="checkbox" />
                <span>{option.label || `Option ${index + 1}`}</span>
              </label>
            ))}
          </div>
        )
      ) : (
        <input
          {...common}
          type={
            field.type === "DATE"
              ? field.dataType === "DATETIME"
                ? "datetime-local"
                : "date"
              : field.type === "NUMBER" || field.dataType === "NUMBER"
                ? "number"
                : "text"
          }
          value={
            field.defaultValue === undefined || field.defaultValue === null
              ? ""
              : String(field.defaultValue)
          }
        />
      )}
      <span className="draft-preview-field-type">
        {labelize(field.type)} · {labelize(field.dataType)}
        {validationSummary(field.validation)
          ? ` · ${validationSummary(field.validation)}`
          : ""}
      </span>
    </div>
  );
}

export function FormDraftPreview({ draft }: { draft: FormDraft }) {
  const orderedSections: {
    key: string;
    title: string;
    fields: DraftField[];
  }[] = draft.sections.map((section, index) => ({
    key: `${section.sectionCode}-${index}`,
    title: section.title,
    fields: section.fields,
  }));
  if (draft.unsectionedFields.length) {
    orderedSections.splice(unsectionedPositionFor(draft), 0, {
      key: "__UNSECTIONED_FIELDS__",
      title: "",
      fields: draft.unsectionedFields,
    });
  }
  return (
    <div className="draft-preview">
      <div className="draft-preview-heading">
        <div>
          <span className="eyebrow">Final review</span>
          <h3>{draft.title || draft.name || "Untitled form"}</h3>
          {draft.description ? <p>{draft.description}</p> : null}
        </div>
        <span className="draft-preview-layout">{labelize(draft.layout)}</span>
      </div>

      {orderedSections.map((section) => (
        <section className="draft-preview-section" key={section.key}>
          {section.title ? <h4>{section.title}</h4> : null}
          <div className="draft-preview-fields">
            {section.fields.map((field, index) => (
              <DraftFieldPreview
                field={field}
                key={`${field.fieldCode}-${index}`}
              />
            ))}
          </div>
        </section>
      ))}

      {draft.Buttons.length ? (
        <div className="draft-preview-actions">
          {draft.Buttons.filter((button) => button.isEnabled).map(
            (button, index) => (
              <button
                className="btn btn-primary"
                disabled
                key={`${button.ButtonCode}-${index}`}
                type="button"
              >
                {button.Buttonlabel || "Button"}
              </button>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}
