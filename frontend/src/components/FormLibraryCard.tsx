import { Icon, type IconName } from "./Icon";
import { StatusBadge } from "./StatusBadge";
import type { MasterForm } from "../types";
import { codeOf, formatDate, labelize } from "../utils";

interface FormLibraryCardProps {
  form: MasterForm;
  actionBusy?: boolean;
  typeIcon: IconName;
  onOpen: (id: string) => void;
  onDelete: (form: MasterForm) => void;
  onRestore: (form: MasterForm) => void;
}

function questionsIn(form: MasterForm): number {
  return (form.sections ?? []).reduce(
    (total, section) => total + (section.fields?.length ?? 0),
    0,
  );
}

export function FormLibraryCard({
  form,
  actionBusy = false,
  typeIcon,
  onOpen,
  onDelete,
  onRestore,
}: FormLibraryCardProps) {
  const status = codeOf(form.status);
  const formType = codeOf(form.formType);

  return (
    <article
      className={`form-card${form.isDeleted ? " form-card-deleted" : ""}`}
    >
      <div className="form-card-top">
        <span className={`form-type-icon type-${formType.toLowerCase()}`}>
          <Icon name={typeIcon} size={20} />
        </span>
        <StatusBadge deleted={form.isDeleted} status={status} />
      </div>
      <div className="form-card-body">
        <h2>{form.name}</h2>
        <p>{form.description || "No description added yet."}</p>
      </div>
      <div className="form-card-tags">
        <span>{labelize(formType)}</span>
        <span>v{form.currentVersion}</span>
        <span>{questionsIn(form)} fields</span>
      </div>
      <div className="form-card-footer">
        <span>Updated {formatDate(form.updatedAt)}</span>
        <div className="card-actions">
          {!form.isDeleted ? (
            <button
              aria-label={`Delete ${form.name}`}
              className="btn btn-danger btn-sm"
              disabled={actionBusy}
              type="button"
              onClick={() => onDelete(form)}
            >
              <Icon name="trash" size={14} />
              Delete
            </button>
          ) : (
            <button
              aria-label={`Restore ${form.name}`}
              className="btn btn-secondary btn-sm"
              disabled={actionBusy}
              type="button"
              onClick={() => onRestore(form)}
            >
              <Icon name="restore" size={14} />
              Restore
            </button>
          )}
          <button
            aria-label={`Open ${form.name}`}
            className="card-open card-open-button"
            type="button"
            onClick={() => onOpen(form._id)}
          >
            Open <Icon name="arrow-right" size={14} />
          </button>
        </div>
      </div>
    </article>
  );
}
