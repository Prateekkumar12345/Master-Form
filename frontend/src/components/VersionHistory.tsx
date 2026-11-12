import { useEffect, useState } from "react";

import type {
  FieldOption,
  FormButton,
  FormField,
  MasterForm,
  VersionEntry,
} from "../types";
import {
  codeOf,
  formatDateTime,
  labelize,
  pretty,
  shortId,
  validationSummary,
} from "../utils";
import { isUnsectionedFieldsSection } from "../formModel";
import { Icon } from "./Icon";
import { Notice } from "./Notice";

interface VersionHistoryProps {
  form: MasterForm;
  versions: VersionEntry[];
  loading?: boolean;
  busy?: string | null;
  canReopenForm: boolean;
  canArchiveForm: boolean;
  canDeleteForm: boolean;
  canPublishSelected: boolean;
  canRestoreVersions: boolean;
  canArchiveVersion: boolean;
  canDeleteVersion: boolean;
  canMoveVersionToDraft: boolean;
  canEditVersion: (version: VersionEntry) => boolean;
  onPublishSelected: (version: VersionEntry) => void;
  onPublishPreviousVersion: (version: VersionEntry) => void;
  onPublishCurrent: () => void;
  onReopenForm: (version?: VersionEntry) => void;
  onArchiveForm: () => void;
  onDeleteForm: () => void;
  onRestoreForm: () => void;
  onArchiveVersion: (version: VersionEntry) => void;
  onMoveVersionToDraft: (version: VersionEntry) => void;
  onDeleteVersion: (version: VersionEntry) => void;
  onEdit: (version: VersionEntry) => void;
  onSelect?: (version: VersionEntry) => void;
  onRestore: (version: VersionEntry) => void;
}

interface SnapshotSection {
  sectionCode?: string;
  title?: string;
  fields?: FormField[];
}

interface SnapshotShape {
  name?: string;
  title?: string;
  description?: string | null;
  formType?: unknown;
  layout?: unknown;
  sections?: SnapshotSection[];
  Buttons?: FormButton[];
}

export function SnapshotPreview({ snapshot }: { snapshot: SnapshotShape }) {
  const [showJson, setShowJson] = useState(false);
  const sections = snapshot.sections ?? [];
  const buttons = snapshot.Buttons ?? [];

  return (
    <div className="snapshot">
      <div className="snapshot-meta">
        <div>
          <small>Form name</small>
          <strong>{snapshot.name || "—"}</strong>
        </div>
        <div>
          <small>Title</small>
          <strong>{snapshot.title || "—"}</strong>
        </div>
        <div>
          <small>Category</small>
          <strong>{labelize(codeOf(snapshot.formType as never))}</strong>
        </div>
        <div>
          <small>Layout</small>
          <strong>{labelize(codeOf(snapshot.layout as never))}</strong>
        </div>
      </div>

      {snapshot.description ? (
        <p className="snapshot-description">{snapshot.description}</p>
      ) : null}

      {sections.length ? (
        sections.map((section, sectionIndex) => (
          <section
            className={`snapshot-section${isUnsectionedFieldsSection(section) ? " snapshot-section-unsectioned" : ""}`}
            key={`${section.sectionCode ?? "section"}-${sectionIndex}`}
          >
            {!isUnsectionedFieldsSection(section) ? (
              <div className="snapshot-section-head">
                <h4>{section.title || `Section ${sectionIndex + 1}`}</h4>
                <span>{section.fields?.length ?? 0} fields</span>
              </div>
            ) : null}
            {(section.fields ?? []).map((field) => {
              const options: FieldOption[] = field.options ?? [];
              const rules = validationSummary(
                Array.isArray(field.validation)
                  ? Object.fromEntries(
                      field.validation
                        .filter((item) => item.rule?.code)
                        .map((item) => [item.rule?.code, item.value]),
                    )
                  : field.validation,
              );
              return (
                <div className="snapshot-field" key={field.fieldCode}>
                  <div className="snapshot-field-main">
                    <strong>{field.label}</strong>
                    <div className="snapshot-tags">
                      <span>{labelize(codeOf(field.type))}</span>
                      <span>{labelize(codeOf(field.dataType))}</span>
                      {field.isRequired ? <span className="required-tag">Required</span> : null}
                      {!field.isEnabled ? <span className="off-tag">Disabled</span> : null}
                    </div>
                  </div>
                  {options.length ? (
                    <small>{options.map((option) => option.label).join(", ")}</small>
                  ) : null}
                  {rules ? <small>{rules}</small> : null}
                </div>
              );
            })}
            {!(section.fields ?? []).length ? (
              <p className="small muted">No fields in this section.</p>
            ) : null}
          </section>
        ))
      ) : (
        <p className="empty-copy">This version has no sections.</p>
      )}

      {buttons.length ? (
        <div className="snapshot-buttons">
          <h4>Buttons</h4>
          {buttons.map((button) => (
            <div className="snapshot-button" key={button.ButtonCode}>
              <Icon name="send" size={15} />
              <strong>{button.Buttonlabel}</strong>
              <span>{labelize(codeOf(button.executionType))}</span>
              <code>{button.request?.endpoint ?? "—"}</code>
            </div>
          ))}
        </div>
      ) : null}

      <button
        className="link-button"
        type="button"
        onClick={() => setShowJson((current) => !current)}
      >
        <Icon name="code" size={14} />
        {showJson ? "Hide raw version data" : "View raw version data"}
      </button>
      {showJson ? (
        <pre className="json-box json-box-tall">{pretty(snapshot)}</pre>
      ) : null}
    </div>
  );
}

export function VersionHistory({
  form,
  versions,
  loading = false,
  busy = null,
  canReopenForm,
  canArchiveForm,
  canDeleteForm,
  canPublishSelected,
  canRestoreVersions,
  canArchiveVersion,
  canDeleteVersion,
  canMoveVersionToDraft,
  canEditVersion,
  onPublishSelected,
  onPublishPreviousVersion,
  onPublishCurrent,
  onReopenForm,
  onArchiveForm,
  onDeleteForm,
  onRestoreForm,
  onArchiveVersion,
  onMoveVersionToDraft,
  onDeleteVersion,
  onEdit,
  onSelect,
  onRestore,
}: VersionHistoryProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!versions.length) {
      setSelectedId(null);
      return;
    }
    if (!versions.some((version) => version._id === selectedId)) {
      const current = versions.find(
        (version) => version.version === form.currentVersion,
      );
      setSelectedId(current?._id ?? versions[0]._id);
    }
  }, [form.currentVersion, selectedId, versions]);

  const selected =
    versions.find((version) => version._id === selectedId) ?? null;
  const isCurrent = selected?.version === form.currentVersion;
  const previousAvailableVersion = versions
    .filter(
      (version) =>
        !version.isDeleted &&
        version.version < form.currentVersion &&
        version.status !== "ARCHIVED",
    )
    .sort((left, right) => right.version - left.version)[0];
  const selectedLifecycleStatus =
    selected && !selected.isDeleted
      ? isCurrent
        ? codeOf(form.status)
        : selected.status ?? "DRAFT"
      : "";
  const canChangeCurrentDraft =
    Boolean(selected) &&
    !form.isDeleted &&
    !selected?.isDeleted &&
    isCurrent &&
    codeOf(form.status) === "DRAFT";
  const availableVersionCount = versions.filter(
    (version) => !version.isDeleted,
  ).length;
  // The active version can be removed only from an archived form that keeps at
  // least one other saved version; the highest remaining version takes over.
  const canDeleteActiveVersion =
    canDeleteVersion &&
    !form.isDeleted &&
    codeOf(form.status) === "ARCHIVED" &&
    availableVersionCount > 1;
  // Only a version that was deleted itself renders as "Deleted". Deleting the
  // form keeps its snapshots intact, so each version keeps its own status.
  const deletedState = (version: VersionEntry) => Boolean(version.isDeleted);
  const selectedDeleted = selected ? deletedState(selected) : false;
  return (
    <div className="version-layout">
      <aside className="version-list">
        <div className="version-list-head">
          <div className="version-list-form">
            <h3>Versions</h3>
            <small>{form.name} · {form.formCode}</small>
          </div>
          <span>{versions.length} total</span>
        </div>
        {versions.map((version) => {
          const lifecycleStatus =
            version.version === form.currentVersion
              ? codeOf(form.status)
              : version.status ?? "DRAFT";
          const isDeletedEntry = deletedState(version);
          return (
            <button
              className={`version-item${
                version._id === selectedId ? " active" : ""
              }${version.isDeleted ? " deleted" : ""}`}
              key={version._id}
              type="button"
              onClick={() => {
                setSelectedId(version._id);
                onSelect?.(version);
              }}
            >
              <span
                className={`version-dot${
                  version.version === form.currentVersion ? " current" : ""
                }`}
              />
              <span className="version-copy">
                <strong>
                  Version {version.version}
                  {isDeletedEntry ? (
                    <em className="deleted-tag">Deleted</em>
                  ) : (
                    <em
                      className={`lifecycle-${lifecycleStatus.toLowerCase()}`}
                    >
                      {labelize(lifecycleStatus)}
                    </em>
                  )}
                </strong>
                <small>
                  {version.isDeleted && version.deletedAt
                    ? `Deleted ${formatDateTime(version.deletedAt)}`
                    : formatDateTime(version.createdAt)}
                </small>
              </span>
              <Icon name="chevron-right" size={15} />
            </button>
          );
        })}
        {!versions.length && !loading ? (
          <p className="small muted version-empty">
            {form.isDeleted
              ? "No saved versions were found for this deleted form."
              : "No versions were returned for this form."}
          </p>
        ) : null}
        {loading ? <p className="small muted version-empty">Loading versions…</p> : null}
      </aside>

      <div className="version-detail">
        {form.isDeleted ? (
          <Notice tone="info">
            <strong>{form.name}</strong> ({form.formCode}) has been deleted from
            the form library. Its saved versions are kept and remain readable
            below. Use <strong>Restore form</strong> to edit, publish, or reuse a
            version again.
          </Notice>
        ) : null}
        {selected ? (
          <>
            <header className="version-detail-head">
              <div>
                <p className="eyebrow">Saved version</p>
                <h3>Version {selected.version}</h3>
                <p className="small muted">
                  {formatDateTime(selected.createdAt)}
                  {selected.createdBy
                    ? ` · saved by ${shortId(selected.createdBy)}`
                    : ""}
                </p>
              </div>
              <div className="button-row">
                <span
                  className={`status-badge ${
                    selectedDeleted
                      ? "status-neutral"
                      : `status-${selectedLifecycleStatus.toLowerCase()}`
                  }`}
                >
                  {selectedDeleted ? "Deleted" : labelize(selectedLifecycleStatus)}
                </span>
                {form.isDeleted ? (
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={busy === "restore-form"}
                    title="Restores the whole form to the library. Saved versions are not changed."
                    type="button"
                    onClick={onRestoreForm}
                  >
                    <Icon name="restore" size={15} />
                    {busy === "restore-form" ? "Restoring…" : "Restore form"}
                  </button>
                ) : null}
                {!selected.isDeleted &&
                !form.isDeleted &&
                selectedLifecycleStatus !== "ARCHIVED" &&
                canEditVersion(selected) ? (
                  <button
                    className="btn btn-danger btn-sm"
                    disabled={busy === `edit-${selected._id}`}
                    type="button"
                    onClick={() => onEdit(selected)}
                  >
                    <Icon name="edit" size={15} />
                    {busy === `edit-${selected._id}`
                      ? "Opening…"
                      : "Edit version"}
                  </button>
                ) : null}
                {!selected.isDeleted &&
                canPublishSelected &&
                ["DRAFT", "PUBLISHED"].includes(codeOf(form.status)) &&
                !isCurrent &&
                selectedLifecycleStatus !== "ARCHIVED" ? (
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={busy === `publish-version-${selected._id}`}
                    type="button"
                    onClick={() => onPublishSelected(selected)}
                  >
                    <Icon name="publish" size={15} />
                    {busy === `publish-version-${selected._id}`
                      ? "Publishing…"
                      : codeOf(form.status) === "DRAFT"
                        ? "Publish form"
                        : "Publish this version"}
                  </button>
                ) : null}
                {canChangeCurrentDraft ? (
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={busy === "publish"}
                    type="button"
                    onClick={onPublishCurrent}
                  >
                    <Icon name="publish" size={15} />
                    {busy === "publish"
                      ? "Publishing…"
                      : "Publish form"}
                  </button>
                ) : null}
                {canReopenForm &&
                !selected.isDeleted &&
                isCurrent &&
                selectedLifecycleStatus === "ARCHIVED" ? (
                  <>
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={
                        busy === "reopen-form" || busy === "status-DRAFT"
                      }
                      type="button"
                      onClick={() => onReopenForm()}
                    >
                      <Icon name="edit" size={15} />
                      {busy === "reopen-form" || busy === "status-DRAFT"
                        ? "Moving to draft…"
                        : "Move form to draft"}
                    </button>
                  </>
                ) : null}
                {canReopenForm &&
                !selected.isDeleted &&
                isCurrent &&
                selectedLifecycleStatus === "PUBLISHED" ? (
                  <>
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={busy === "status-DRAFT"}
                      type="button"
                      onClick={() => onReopenForm(selected)}
                    >
                      <Icon name="edit" size={15} />
                      {busy === "status-DRAFT"
                        ? "Moving to draft…"
                        : "Move form to draft"}
                    </button>
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={
                        !previousAvailableVersion ||
                        busy === `publish-version-${previousAvailableVersion?._id}`
                      }
                      type="button"
                      onClick={() => {
                        if (previousAvailableVersion) {
                          onPublishPreviousVersion(previousAvailableVersion);
                        }
                      }}
                    >
                      <Icon name="publish" size={15} />
                      {previousAvailableVersion &&
                      busy === `publish-version-${previousAvailableVersion._id}`
                        ? "Publishing…"
                        : "Publish previous version"}
                    </button>
                    {canArchiveForm ? (
                      <button
                        className="btn btn-secondary btn-sm"
                        disabled={busy === "status-ARCHIVED"}
                        type="button"
                        onClick={onArchiveForm}
                      >
                        <Icon name="archive" size={15} />
                        {busy === "status-ARCHIVED"
                          ? "Archiving…"
                          : "Archive Form"}
                      </button>
                    ) : null}
                  </>
                ) : null}
                {canArchiveForm &&
                !selected.isDeleted &&
                isCurrent &&
                selectedLifecycleStatus === "DRAFT" ? (
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={busy === "status-ARCHIVED"}
                    type="button"
                    onClick={onArchiveForm}
                  >
                    <Icon name="archive" size={15} />
                    {busy === "status-ARCHIVED"
                      ? "Archiving…"
                      : "Archive Form"}
                  </button>
                ) : null}
                {canArchiveVersion &&
                !selected.isDeleted &&
                !isCurrent &&
                selectedLifecycleStatus !== "ARCHIVED" ? (
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={busy === `archive-version-${selected._id}`}
                    type="button"
                    onClick={() => onArchiveVersion(selected)}
                  >
                    <Icon name="archive" size={15} />
                    {busy === `archive-version-${selected._id}`
                      ? "Archiving…"
                      : "Move version to archive"}
                  </button>
                ) : null}
                {canMoveVersionToDraft &&
                !selected.isDeleted &&
                !isCurrent &&
                selectedLifecycleStatus === "ARCHIVED" ? (
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={busy === `draft-version-${selected._id}`}
                    type="button"
                    onClick={() => onMoveVersionToDraft(selected)}
                  >
                    <Icon name="edit" size={15} />
                    {busy === `draft-version-${selected._id}`
                      ? "Moving to draft…"
                      : "Move version to draft"}
                  </button>
                ) : null}
                {canDeleteVersion &&
                !selected.isDeleted &&
                ((!isCurrent && selectedLifecycleStatus === "ARCHIVED") ||
                  (isCurrent && canDeleteActiveVersion)) ? (
                  <button
                    className="btn btn-danger btn-sm"
                    disabled={busy === `delete-version-${selected._id}`}
                    type="button"
                    onClick={() => onDeleteVersion(selected)}
                  >
                    <Icon name="trash" size={15} />
                    {busy === `delete-version-${selected._id}`
                      ? "Deleting…"
                      : "Delete version"}
                  </button>
                ) : null}
                {selected.isDeleted && !form.isDeleted && canRestoreVersions ? (
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={busy === `restore-${selected._id}`}
                    type="button"
                    onClick={() => onRestore(selected)}
                  >
                    <Icon name="restore" size={15} />
                    {busy === `restore-${selected._id}`
                      ? "Restoring…"
                      : "Restore version"}
                  </button>
                ) : null}
              </div>
            </header>
            {!selected.isDeleted && !form.isDeleted ? (
              isCurrent ? (
                canDeleteActiveVersion ? (
                  <p className="small muted version-action-hint">
                    Deleting the active version makes the highest remaining
                    version active and applies its saved definition to the form.
                  </p>
                ) : (
                  <p className="small muted version-action-hint">
                    {codeOf(form.status) === "ARCHIVED"
                      ? "Keep at least one other saved version to delete the active version."
                      : "This is the active version, so it follows the form lifecycle. Archive the form before deleting it."}
                  </p>
                )
              ) : selectedLifecycleStatus !== "ARCHIVED" && canArchiveVersion ? (
                <p className="small muted version-action-hint">
                  This version is a draft. Archive it first to enable Delete
                  version.
                </p>
              ) : null
            ) : null}
            {selected.isDeleted ? (
              <Notice tone="info">
                This version is deleted. Restore it to make it available for
                review or editing.
              </Notice>
            ) : null}
            <SnapshotPreview snapshot={selected.snapshot as SnapshotShape} />
          </>
        ) : (
          <div className="version-placeholder">
            <Icon name="history" size={28} />
            <h3>Select a version</h3>
            <p>Choose a saved version to see the form as it looked then.</p>
          </div>
        )}
        {canDeleteForm ? (
          <section className="version-danger-zone">
            <div>
              <h4>Delete this form from the library</h4>
              <p>
                Removes the whole form from the form library. Saved versions
                stay stored and can be recovered by restoring the form. To
                remove only a single version, archive it and use Delete version
                instead.
              </p>
            </div>
            <button
              className="btn btn-danger btn-sm"
              disabled={busy === "delete-form"}
              type="button"
              onClick={onDeleteForm}
            >
              <Icon name="trash" size={15} />
              {busy === "delete-form" ? "Deleting…" : "Delete form"}
            </button>
          </section>
        ) : null}
      </div>

      {canPublishSelected && codeOf(form.status) === "PUBLISHED" ? (
        <div className="version-note">
          <Icon name="history" size={16} />
          Create a new version to edit a copy while keeping this published
          version active, or move the form to draft to reactivate the previous
          available version.
        </div>
      ) : null}
    </div>
  );
}
