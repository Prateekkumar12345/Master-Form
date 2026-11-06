import { useEffect, useRef, useState } from "react";

import type { FieldOption } from "../types";
import { Icon } from "./Icon";

interface PreviewMultiSelectProps {
  id: string;
  options: FieldOption[];
  value: string[];
  onChange?: (value: string[]) => void;
  readOnly?: boolean;
}

export function PreviewMultiSelect({
  id,
  options,
  value,
  onChange,
  readOnly = false,
}: PreviewMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedOptions = options.filter((option) =>
    value.includes(option.value),
  );

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const toggleOption = (optionValue: string, checked: boolean) => {
    if (readOnly || !onChange) return;
    onChange(
      checked
        ? [...value, optionValue]
        : value.filter((item) => item !== optionValue),
    );
  };

  return (
    <div className="preview-multiselect" ref={rootRef}>
      <button
        aria-controls={`${id}-options`}
        aria-expanded={open}
        aria-haspopup="true"
        className={`input preview-multiselect-trigger${open ? " is-open" : ""}`}
        id={id}
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <span
          className={`preview-multiselect-value${selectedOptions.length ? " has-value" : ""}`}
        >
          {selectedOptions.length ? (
            <>
              {selectedOptions.slice(0, 2).map((option) => (
                <span className="preview-multiselect-chip" key={option.value}>
                  {option.label}
                </span>
              ))}
              {selectedOptions.length > 2 ? (
                <span className="preview-multiselect-more">
                  +{selectedOptions.length - 2}
                </span>
              ) : null}
            </>
          ) : (
            <span className="preview-multiselect-placeholder">
              Select options
            </span>
          )}
        </span>
        <Icon
          className={`preview-multiselect-chevron${open ? " is-open" : ""}`}
          name="chevron-right"
          size={16}
        />
      </button>
      {open ? (
        <div
          className="preview-multiselect-menu"
          id={`${id}-options`}
          role="group"
          aria-label="Available options"
        >
          {options.length ? (
            options.map((option) => (
              <label
                className={`preview-multiselect-option${readOnly ? " is-readonly" : ""}`}
                key={option.value}
              >
                <input
                  checked={value.includes(option.value)}
                  disabled={readOnly}
                  type="checkbox"
                  onChange={(event) =>
                    toggleOption(option.value, event.target.checked)
                  }
                />
                <span>{option.label}</span>
              </label>
            ))
          ) : (
            <span className="preview-multiselect-empty">
              No choices configured.
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}
