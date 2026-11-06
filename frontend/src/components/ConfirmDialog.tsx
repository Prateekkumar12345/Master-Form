import type { ReactNode } from "react";
import { useEffect } from "react";

import { Icon } from "./Icon";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "primary" | "danger";
  busy?: boolean;
  wide?: boolean;
  closeOnBackdrop?: boolean;
  onBackdropClick?: () => void;
  children?: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "primary",
  busy = false,
  wide = false,
  closeOnBackdrop = true,
  onBackdropClick,
  children,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onCancel, open]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={
        onBackdropClick ?? (closeOnBackdrop ? onCancel : undefined)
      }
    >
      <div
        aria-describedby="confirm-message"
        aria-labelledby="confirm-title"
        aria-modal="true"
        className={`confirm-card${wide ? " confirm-card-wide" : ""}`}
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={`confirm-icon${tone === "danger" ? " danger" : ""}`}>
          <Icon name={tone === "danger" ? "alert" : "check-circle"} size={22} />
        </div>
        <div>
          <h2 id="confirm-title">{title}</h2>
          <p id="confirm-message">{message}</p>
          {children}
        </div>
        <div className="confirm-actions">
          <button
            className="btn btn-ghost"
            disabled={busy}
            type="button"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            className={`btn ${tone === "danger" ? "btn-danger" : "btn-primary"}`}
            disabled={busy}
            type="button"
            onClick={onConfirm}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
