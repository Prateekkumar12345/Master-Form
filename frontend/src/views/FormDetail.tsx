import { useCallback, useEffect, useMemo, useState } from "react";

import { ConfirmDialog } from "../components/ConfirmDialog";
import { FormBuilder } from "../components/FormBuilder";
import { FormPreview } from "../components/FormPreview";
import { Icon } from "../components/Icon";
import { Notice } from "../components/Notice";
import { StatusBadge } from "../components/StatusBadge";
import { VersionHistory } from "../components/VersionHistory";
import { useApi } from "../context/ApiContext";
import { formFromVersion } from "../formModel";
import type {
  FormButton,
  FormStatus,
  MasterForm,
  VersionEntry,
} from "../types";
import {
  STATUS_TRANSITIONS,
  canEditForm,
  codeOf,
  errorMessage,
  formatDateTime,
  labelize,
  transitionHint,
  transitionLabel,
  validationSummary,
} from "../utils";

type Tab = "overview" | "questions" | "versions" | "preview";

type PendingAction =
  | { kind: "archive" }
  | { kind: "archiveVersion"; version: VersionEntry }
  | { kind: "draftVersion"; version: VersionEntry }
  | { kind: "deleteVersion"; version: VersionEntry }
  | { kind: "publishVersion"; version: VersionEntry }
  | { kind: "deleteForm" };

interface FormDetailProps {
  formId: string;
  onBack: () => void;
}

function fieldCount(form: MasterForm | null): number {
  return (form?.sections ?? []).reduce(
    (total, section) => total + (section.fields?.length ?? 0),
    0,
  );
}

function buttonEndpoint(button: FormButton): string {
  if (!button.request?.endpoint) return "No endpoint configured";
  return `${codeOf(button.request.httpMethod) || "POST"} ${button.request.endpoint}`;
}

export function FormDetail({ formId, onBack }: FormDetailProps) {
  const { send } = useApi();
  const [form, setForm] = useState<MasterForm | null>(null);
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(false);
  const [creatingVersion, setCreatingVersion] = useState(false);
  const [editingVersion, setEditingVersion] = useState<VersionEntry | null>(
    null,
  );
  const [previewVersionNumber, setPreviewVersionNumber] = useState<number | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [versionBusy, setVersionBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<PendingAction | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [publishableVersions, setPublishableVersions] = useState<VersionEntry[]>(
    [],
  );
  const [publishVersionsLoading, setPublishVersionsLoading] = useState(false);
  const [publishVersionPickerOpen, setPublishVersionPickerOpen] =
    useState(false);
  const [selectedVersionToPublishId, setSelectedVersionToPublishId] =
    useState("");

  useEffect(() => {
    if (!publishVersionPickerOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy && !versionBusy) {
        setPublishVersionPickerOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, publishVersionPickerOpen, versionBusy]);

  const loadVersions = useCallback(
    async (isDeleted: boolean) => {
      if (isDeleted) {
        setVersions([]);
        return;
      }
      setLoadingVersions(true);
      const result = await send(
        "GET",
        `/master-forms/${encodeURIComponent(formId)}/versions?limit=100&sortOrder=desc&includeDeleted=true`,
      );
      setLoadingVersions(false);
      if (result.ok) {
        setVersions(result.payload?.data ?? []);
      } else {
        setError(errorMessage(result));
      }
    },
    [formId, send],
  );

  const loadForm = useCallback(async () => {
    setLoading(true);
    const result = await send(
      "GET",
      `/master-forms/${encodeURIComponent(formId)}?includeDeleted=true`,
    );
    setLoading(false);
    if (!result.ok) {
      setError(errorMessage(result));
      setForm(null);
      return;
    }
    const next = result.payload?.data as MasterForm;
    setForm(next);
    setError("");
    if (next.isDeleted) setVersions([]);
  }, [formId, send]);

  useEffect(() => {
    void loadForm();
  }, [loadForm]);

  useEffect(() => {
    if ((tab !== "versions" && tab !== "preview") || !form) return;
    void loadVersions(Boolean(form.isDeleted));
    // Reload when the current definition changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, form?.isDeleted, form?.currentVersion, loadVersions]);

  const canEdit = canEditForm(form);
  const status = codeOf(form?.status) as FormStatus;
  const previewVersion =
    versions.find(
      (version) =>
        !version.isDeleted &&
        version.version === (previewVersionNumber ?? form?.currentVersion),
    ) ?? null;
  const transitions = useMemo(
    () => (form && !form.isDeleted ? STATUS_TRANSITIONS[status] ?? [] : []),
    [form, status],
  );

  const applyUpdatedForm = (result: {
    ok: boolean;
    payload?: { data?: unknown };
  }): MasterForm | null => {
    if (!result.ok) return null;
    const updated = result.payload?.data as MasterForm | undefined;
    if (!updated) return null;
    setForm(updated);
    return updated;
  };

  const saveForm = async (
    payload: Record<string, unknown>,
  ): Promise<boolean> => {
    setSaving(true);
    setError("");
    const result = await send(
      "PATCH",
      `/master-forms/${encodeURIComponent(formId)}`,
      editingVersion
        ? { ...payload, masterFormVersionId: editingVersion._id }
        : payload,
    );
    setSaving(false);
    if (!result.ok) {
      setError(errorMessage(result));
      return false;
    }
    applyUpdatedForm(result);
    setEditing(false);
    setEditingVersion(null);
    const updated = result.payload?.data as MasterForm;
    const createdVersion = Math.max(
      updated.currentVersion,
      ...(updated.versions ?? []).map((version) => version.version),
    );
    const previousLatestVersion = Math.max(
      form?.currentVersion ?? 0,
      ...versions.map((version) => version.version),
    );
    setPreviewVersionNumber(createdVersion);
    setNotice(
      editingVersion
        ? codeOf(updated.status) === "PUBLISHED"
          ? `Your edits were saved as version ${createdVersion}. The published active version ${updated.currentVersion} is unchanged.`
          : `Your edits were saved as version ${createdVersion}. The selected snapshot remains unchanged.`
        : creatingVersion
          ? createdVersion > previousLatestVersion
            ? `Version ${createdVersion} was created as a draft. Version ${updated.currentVersion} remains published.`
            : "No changes were made, so a new version was not created."
          : "Your changes were saved. If the form definition changed, a new version was created.",
    );
    setCreatingVersion(false);
    await loadVersions(false);
    return true;
  };

  const editVersion = (version: VersionEntry) => {
    setCreatingVersion(false);
    setEditingVersion(version);
    setEditing(true);
    setError("");
  };

  const createVersion = () => {
    setCreatingVersion(true);
    setEditingVersion(null);
    setEditing(true);
    setError("");
    setNotice("");
  };

  const changeStatus = async (
    target: FormStatus,
    selectedVersionId?: string,
  ): Promise<boolean> => {
    if (!form || busy) return false;
    setBusy(`status-${target}`);
    setError("");
    setNotice("");
    const result = await send(
      "PATCH",
      `/master-forms/${encodeURIComponent(form._id)}`,
      {
        status: target,
        ...(selectedVersionId
          ? { masterFormVersionId: selectedVersionId }
          : {}),
      },
    );
    setBusy(null);
    const updated = applyUpdatedForm(result);
    if (!updated) {
      setError(errorMessage(result));
      return false;
    }
    if (target === "PUBLISHED") {
      setNotice(
        `Version ${updated.currentVersion} is now published and available for use.`,
      );
    } else if (target === "ARCHIVED") {
      setNotice("The form is archived. You can reopen it as a draft at any time.");
    } else {
      setNotice(
        selectedVersionId
          ? `Version ${updated.currentVersion} is now the active draft. The previously published version remains saved in history.`
          : "The form is editable again. Editing will create a new version.",
      );
    }
    if (selectedVersionId) setPreviewVersionNumber(updated.currentVersion);
    await loadVersions(false);
    return true;
  };

  const chooseVersionToPublish = async () => {
    if (!form || publishVersionsLoading || busy) return;
    setPublishVersionsLoading(true);
    setError("");
    const result = await send(
      "GET",
      `/master-forms/${encodeURIComponent(form._id)}/versions?limit=100&sortOrder=desc&includeDeleted=true`,
    );
    setPublishVersionsLoading(false);
    if (!result.ok) {
      setError(errorMessage(result));
      return;
    }

    const savedVersions = (
      (result.payload?.data ?? []) as VersionEntry[]
    ).filter(
      (version) =>
        !version.isDeleted &&
        version.version !== form.currentVersion &&
        version.status !== "ARCHIVED",
    );
    if (!savedVersions.length) {
      setError("No saved draft versions are available to publish.");
      return;
    }

    setPublishableVersions(savedVersions);
    setSelectedVersionToPublishId("");
    setPublishVersionPickerOpen(true);
  };

  const confirmPublishSelectedVersion = async () => {
    if (!selectedVersionToPublishId) return;
    const selectedVersion = publishableVersions.find(
      (version) => version._id === selectedVersionToPublishId,
    );
    if (!selectedVersion) {
      setError("The selected version is no longer available. Refresh and try again.");
      return;
    }
    const published = await publishVersion(selectedVersion);
    if (!published) return;
    setPublishVersionPickerOpen(false);
  };

  const restoreForm = async () => {
    if (!form) return;
    setBusy("restore-form");
    setError("");
    const result = await send(
      "POST",
      `/master-forms/${encodeURIComponent(form._id)}/restore`,
    );
    setBusy(null);
    const updated = applyUpdatedForm(result);
    if (!updated) {
      setError(errorMessage(result));
      return;
    }
    setNotice("The form is restored and available in the library again.");
    await loadVersions(false);
  };

  const publishVersion = async (version: VersionEntry): Promise<boolean> => {
    if (!form || versionBusy) return false;
    setVersionBusy(`publish-version-${version._id}`);
    setError("");
    const result = await send(
      "PATCH",
      `/master-forms/${encodeURIComponent(form._id)}/versions/${encodeURIComponent(
        version._id,
      )}`,
      { status: "PUBLISHED" },
    );
    setVersionBusy(null);
    const updated = applyUpdatedForm(result);
    if (!updated) {
      setError(errorMessage(result));
      return false;
    }
    const nextStatus = codeOf(updated.status);
    if (nextStatus === "PUBLISHED") {
      setNotice(
        `Version ${version.version} is now published. The previously published version is now a draft.`,
      );
    } else if (nextStatus === "ARCHIVED") {
      setNotice(
        `Version ${version.version} is now the active version. Reopen the form as a draft when you want to publish it.`,
      );
    } else {
      setNotice(
        `Version ${version.version} is now the active version. Publish it when you are ready; no new version was created.`,
      );
    }
    setPreviewVersionNumber(version.version);
    await loadVersions(false);
    return true;
  };

  const restoreVersion = async (version: VersionEntry) => {
    if (!form) return;
    setVersionBusy(`restore-${version._id}`);
    setError("");
    const result = await send(
      "POST",
      `/master-forms/${encodeURIComponent(form._id)}/versions/${encodeURIComponent(
        version._id,
      )}/restore`,
    );
    setVersionBusy(null);
    if (!result.ok) {
      setError(errorMessage(result));
      return;
    }
    setNotice(`Version ${version.version} was restored.`);
    await loadVersions(false);
  };

  const archiveVersion = async (version: VersionEntry) => {
    if (!form || version.version === form.currentVersion || versionBusy) return;
    setVersionBusy(`archive-version-${version._id}`);
    setError("");
    const result = await send(
      "PATCH",
      `/master-forms/${encodeURIComponent(form._id)}/versions/${encodeURIComponent(
        version._id,
      )}`,
      { status: "ARCHIVED" },
    );
    setVersionBusy(null);
    if (!result.ok) {
      setError(errorMessage(result));
      return;
    }
    setNotice(`Version ${version.version} was archived.`);
    await loadVersions(false);
  };

  const moveVersionToDraft = async (version: VersionEntry) => {
    if (!form || version.version === form.currentVersion || versionBusy) return;
    setVersionBusy(`draft-version-${version._id}`);
    setError("");
    const result = await send(
      "PATCH",
      `/master-forms/${encodeURIComponent(form._id)}/versions/${encodeURIComponent(
        version._id,
      )}`,
      { status: "DRAFT" },
    );
    setVersionBusy(null);
    if (!result.ok) {
      setError(errorMessage(result));
      return;
    }
    setNotice(`Version ${version.version} was moved to draft.`);
    await loadVersions(false);
  };

  const deleteVersion = async (version: VersionEntry) => {
    if (!form || version.version === form.currentVersion || versionBusy) return;
    setVersionBusy(`delete-version-${version._id}`);
    setError("");
    const result = await send(
      "DELETE",
      `/master-forms/${encodeURIComponent(form._id)}/versions/${encodeURIComponent(
        version._id,
      )}`,
    );
    setVersionBusy(null);
    if (!result.ok) {
      setError(errorMessage(result));
      return;
    }
    setNotice(`Archived version ${version.version} was moved to Deleted versions.`);
    await loadVersions(false);
  };

  const deleteForm = async () => {
    if (!form || codeOf(form.status) !== "ARCHIVED") return;
    setBusy("delete-form");
    setError("");
    const result = await send(
      "DELETE",
      `/master-forms/${encodeURIComponent(form._id)}`,
    );
    setBusy(null);
    const updated = applyUpdatedForm(result);
    if (!updated) {
      setError(errorMessage(result));
      return;
    }
    setNotice("The archived form was deleted. You can restore it later.");
    setVersions([]);
  };

  const runConfirm = async () => {
    if (!confirm) return;
    setConfirmBusy(true);
    try {
      if (confirm.kind === "archive") await changeStatus("ARCHIVED");
      else if (confirm.kind === "publishVersion")
        await publishVersion(confirm.version);
      else if (confirm.kind === "archiveVersion")
        await archiveVersion(confirm.version);
      else if (confirm.kind === "draftVersion")
        await moveVersionToDraft(confirm.version);
      else if (confirm.kind === "deleteVersion")
        await deleteVersion(confirm.version);
      else await deleteForm();
    } finally {
      setConfirmBusy(false);
      setConfirm(null);
    }
  };

  const confirmation = confirm
    ? confirm.kind === "archive"
      ? {
          title: "Archive this form?",
          message:
            "Archiving makes the form inactive. It stays in the library and can be reopened as a draft later.",
          label: "Archive form",
          tone: "primary" as const,
        }
      : confirm.kind === "publishVersion"
          ? {
              title: `Publish version ${confirm.version.version}?`,
              message:
                status === "DRAFT"
                  ? "The selected draft version becomes the active published definition, and the form status changes to Published. The previous current version remains saved as a draft."
                  : "The selected draft version becomes the published definition, and the previously published version becomes a draft. No new version is created and saved snapshots are unchanged.",
              label: status === "DRAFT" ? "Publish form" : "Publish version",
              tone: "primary" as const,
            }
          : confirm.kind === "archiveVersion"
            ? {
                title: `Move version ${confirm.version.version} to archive?`,
                message:
                  "This archives only the selected version. The master form lifecycle status and other saved versions will not change.",
                label: "Move version to archive",
                tone: "primary" as const,
              }
            : confirm.kind === "deleteVersion"
              ? {
                  title: `Delete archived version ${confirm.version.version}?`,
                  message:
                    "This moves the archived version to Deleted versions. You can restore it later.",
                  label: "Delete version",
                  tone: "danger" as const,
                }
              : confirm.kind === "draftVersion"
                ? {
                    title: `Move version ${confirm.version.version} to draft?`,
                    message:
                      "This changes only the selected version to Draft. The master form status and other saved versions will remain unchanged.",
                    label: "Move version to draft",
                    tone: "primary" as const,
                  }
          : {
              title: "Delete this archived form?",
              message:
                "The archived form will be removed from the active form library. You can restore it later.",
              label: "Delete form",
              tone: "danger" as const,
            }
    : null;

  if (loading) {
    return (
      <div className="view">
        <div className="detail-loading">
          <span className="spinner" />
          <p>Loading form…</p>
        </div>
      </div>
    );
  }

  if (!form) {
    return (
      <div className="view">
        <button className="back-link" type="button" onClick={onBack}>
          <Icon name="arrow-left" size={16} /> Back to form library
        </button>
        <Notice tone="error">
          {error || "This form could not be found."}
        </Notice>
      </div>
    );
  }

  const questions = fieldCount(form);

  return (
    <div className="view">
      <button className="back-link" type="button" onClick={onBack}>
        <Icon name="arrow-left" size={16} /> Back to form library
      </button>

      <header className="detail-header">
        <div className="detail-heading">
          <div className="breadcrumb">
            Workspace <span>/</span> Form library <span>/</span> {form.name}
          </div>
          <div className="detail-title-row">
            <h1>{form.name}</h1>
            <StatusBadge
              deleted={form.isDeleted}
              status={codeOf(form.status)}
            />
          </div>
          <p className="detail-description">
            {form.description || "No description has been added to this form."}
          </p>
          <div className="detail-meta">
            <span className="mono">{form.formCode}</span>
            <span className="meta-dot" />
            <span>{labelize(codeOf(form.formType))}</span>
            <span className="meta-dot" />
            <span>Version {form.currentVersion}</span>
            <span className="meta-dot" />
            <span>Updated {formatDateTime(form.updatedAt)}</span>
          </div>
        </div>
        <div className="page-actions">
          {canEdit ? (
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => {
                setEditing(true);
                setError("");
              }}
            >
              <Icon name="edit" size={16} /> Edit form
            </button>
          ) : null}
          {!form.isDeleted && !canEdit ? (
            <span className="action-hint">
              <Icon name="lock" size={14} />
              Return to draft to edit
            </span>
          ) : null}
        </div>
      </header>

      {form.isDeleted ? (
        <Notice tone="info">
          This form is deleted. It is hidden from the library and version
          history is unavailable until you restore it.
        </Notice>
      ) : null}
      {notice ? (
        <Notice tone="success" onDismiss={() => setNotice("")}>
          {notice}
        </Notice>
      ) : null}
      {error && !editing ? (
        <Notice tone="error" onDismiss={() => setError("")}>
          {error}
        </Notice>
      ) : null}

      <nav className="tab-bar" aria-label="Form sections">
        {(
          [
            ["overview", "Overview", "layers"],
            ["questions", "Fields", "forms"],
            ["versions", "Version history", "history"],
            ["preview", "Preview", "eye"],
          ] as [Tab, string, "layers" | "forms" | "history" | "eye"][]
        ).map(([key, label, icon]) => (
          <button
            aria-selected={tab === key}
            className={`tab${tab === key ? " active" : ""}`}
            key={key}
            role="tab"
            type="button"
            onClick={() => setTab(key)}
          >
            <Icon name={icon} size={16} />
            {label}
            {key === "questions" ? (
              <span className="tab-count">{questions}</span>
            ) : null}
            {key === "versions" && versions.length ? (
              <span className="tab-count">{versions.length}</span>
            ) : null}
          </button>
        ))}
      </nav>

      {tab === "overview" ? (
        <div className="detail-grid">
          <div className="detail-main">
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>Form summary</h2>
                  <p>Everything about this form at a glance.</p>
                </div>
              </div>
              <div className="summary-grid">
                <div className="summary-item">
                  <span>Status</span>
                  <strong>
                    <StatusBadge
                      deleted={form.isDeleted}
                      status={codeOf(form.status)}
                    />
                  </strong>
                </div>
                <div className="summary-item">
                  <span>Version</span>
                  <strong>{form.currentVersion}</strong>
                </div>
                <div className="summary-item">
                  <span>Category</span>
                  <strong>{labelize(codeOf(form.formType))}</strong>
                </div>
                <div className="summary-item">
                  <span>Layout</span>
                  <strong>{labelize(codeOf(form.layout))}</strong>
                </div>
                <div className="summary-item">
                  <span>Sections</span>
                  <strong>{form.sections?.length ?? 0}</strong>
                </div>
                <div className="summary-item">
                  <span>Fields</span>
                  <strong>{questions}</strong>
                </div>
                <div className="summary-item">
                  <span>Created</span>
                  <strong>{formatDateTime(form.createdAt)}</strong>
                </div>
                <div className="summary-item">
                  <span>Last updated</span>
                  <strong>{formatDateTime(form.updatedAt)}</strong>
                </div>
              </div>
            </section>

            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>About this form</h2>
                  <p>The title and description people see when filling it in.</p>
                </div>
                {canEdit ? (
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => setEditing(true)}
                  >
                    Edit details
                  </button>
                ) : null}
              </div>
              <div className="about-grid">
                <div>
                  <span className="summary-label">Public title</span>
                  <p>{form.title || form.name}</p>
                </div>
                <div>
                  <span className="summary-label">Description</span>
                  <p>{form.description || "No description added."}</p>
                </div>
              </div>
            </section>

            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>Structure</h2>
                  <p>
                    {form.sections?.length ?? 0} sections and {questions} fields.
                  </p>
                </div>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setTab("questions")}
                >
                  View fields <Icon name="arrow-right" size={14} />
                </button>
              </div>
              {(form.sections ?? []).length ? (
                <div className="structure-list">
                  {(form.sections ?? []).map((section, index) => (
                    <div className="structure-row" key={section.sectionCode}>
                      <span className="group-number">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="structure-copy">
                        <strong>{section.title}</strong>
                        <small className="mono">{section.sectionCode}</small>
                      </span>
                      <span className="structure-count">
                        {section.fields?.length ?? 0} fields
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="empty-copy">This form has no sections yet.</p>
              )}
            </section>

            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>Form buttons</h2>
                  <p>
                    Buttons can call an API, open a page, or show a message.
                  </p>
                </div>
                {canEdit ? (
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => setEditing(true)}
                  >
                    Manage buttons
                  </button>
                ) : null}
              </div>
              {(form.Buttons ?? []).length ? (
                <div className="button-list">
                  {(form.Buttons ?? []).map((button) => (
                    <div className="button-row-item" key={button.ButtonCode}>
                      <span className="button-icon">
                        <Icon
                          name={
                            codeOf(button.executionType) === "API"
                              ? "send"
                              : codeOf(button.executionType) === "REACT_ROUTE"
                                ? "arrow-right"
                                : "play"
                          }
                          size={16}
                        />
                      </span>
                      <span className="button-copy">
                        <strong>{button.Buttonlabel}</strong>
                        <small>{labelize(codeOf(button.executionType))}</small>
                      </span>
                      <code className="button-endpoint">
                        {buttonEndpoint(button)}
                      </code>
                      {!button.isEnabled ? (
                        <span className="mini-chip">Disabled</span>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="empty-copy">
                  No buttons are configured for this form.
                </p>
              )}
            </section>
          </div>

          <aside className="detail-aside">
            <section className="panel lifecycle-card">
              <div className="panel-head">
                <div>
                  <h2>Lifecycle</h2>
                  <p>Move this form through draft, published and archived.</p>
                </div>
              </div>

              {form.isDeleted ? (
                <>
                  <p className="small muted">
                    This form is deleted. Restoring it keeps its archived status
                    and does not create a new version.
                  </p>
                  <button
                    className="btn btn-primary btn-block"
                    disabled={busy === "restore-form"}
                    type="button"
                    onClick={() => void restoreForm()}
                  >
                    <Icon name="restore" size={16} />
                    {busy === "restore-form" ? "Restoring…" : "Restore form"}
                  </button>
                </>
              ) : (
                <>
                  <div className="status-card-row">
                    <StatusBadge status={codeOf(form.status)} />
                    <span>Version {form.currentVersion}</span>
                  </div>
                  <div className="lifecycle-actions">
                    {transitions.map((target) => (
                      <button
                        className={`btn btn-block ${
                          target === "PUBLISHED"
                            ? "btn-primary"
                            : target === "ARCHIVED"
                              ? "btn-secondary"
                              : "btn-secondary"
                        }`}
                        disabled={Boolean(busy) || publishVersionsLoading}
                        key={target}
                        type="button"
                        onClick={() => {
                          if (target === "ARCHIVED") {
                            setConfirm({ kind: "archive" });
                          } else if (
                            target === "DRAFT" &&
                            status === "PUBLISHED"
                          ) {
                            void chooseVersionToPublish();
                          } else {
                            void changeStatus(target);
                          }
                        }}
                      >
                        <Icon
                          name={
                            target === "PUBLISHED"
                              ? "publish"
                              : target === "ARCHIVED"
                                ? "archive"
                                : status === "PUBLISHED"
                                  ? "publish"
                                  : "edit"
                          }
                          size={16}
                        />
                        {publishVersionsLoading && target === "DRAFT"
                          ? "Loading versions…"
                          : busy === `status-${target}`
                          ? "Updating…"
                          : transitionLabel(status, target)}
                      </button>
                    ))}
                  </div>
                  {transitions.length ? (
                    <p className="lifecycle-hint">
                      {transitionHint(
                        status,
                        transitions.includes("PUBLISHED")
                          ? "PUBLISHED"
                          : transitions[0],
                      )}
                    </p>
                  ) : null}
                  {status === "ARCHIVED" ? (
                    <button
                      className="btn btn-danger btn-block"
                      disabled={Boolean(busy)}
                      type="button"
                      onClick={() => setConfirm({ kind: "deleteForm" })}
                    >
                      <Icon name="trash" size={16} />
                      Delete form
                    </button>
                  ) : null}
                </>
              )}
            </section>

            <section className="panel quick-links">
              <h2>Quick actions</h2>
              <button
                className="quick-link"
                type="button"
                onClick={() => setTab("versions")}
              >
                <span className="quick-icon">
                  <Icon name="history" size={17} />
                </span>
                <span>
                  <strong>Review version history</strong>
                  <small>View and compare saved form versions</small>
                </span>
                <Icon name="chevron-right" size={15} />
              </button>
              <button
                className="quick-link"
                type="button"
                onClick={() => setTab("preview")}
              >
                <span className="quick-icon">
                  <Icon name="eye" size={17} />
                </span>
                <span>
                  <strong>Preview a form version</strong>
                  <small>Preview the active or any saved version</small>
                </span>
                <Icon name="chevron-right" size={15} />
              </button>
              {canEdit ? (
                <button
                  className="quick-link"
                  type="button"
                  onClick={() => setEditing(true)}
                >
                  <span className="quick-icon">
                    <Icon name="edit" size={17} />
                  </span>
                  <span>
                    <strong>Edit fields</strong>
                    <small>Changes create a new version</small>
                  </span>
                  <Icon name="chevron-right" size={15} />
                </button>
              ) : null}
            </section>
          </aside>
        </div>
      ) : null}

      {tab === "questions" ? (
        <div className="questions-layout">
          <div className="questions-toolbar">
            <div>
              <h2>Fields</h2>
              <p>
                {form.sections?.length ?? 0} sections · {questions} fields
              </p>
            </div>
            {canEdit ? (
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => setEditing(true)}
              >
                <Icon name="edit" size={16} /> Edit fields
              </button>
            ) : (
              <span className="action-hint">
                <Icon name="lock" size={14} />
                {form.isDeleted
                  ? "Restore the form to edit"
                  : "Return to draft to edit"}
              </span>
            )}
          </div>

          {(form.sections ?? []).length ? (
            (form.sections ?? []).map((section, sectionIndex) => (
              <section className="panel question-group" key={section.sectionCode}>
                <header className="question-group-head">
                  <span className="group-number">
                    {String(sectionIndex + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h3>{section.title}</h3>
                    <code>{section.sectionCode}</code>
                  </div>
                  <span className="structure-count">
                    {section.fields?.length ?? 0} fields
                  </span>
                </header>
                <div className="question-list">
                  {(section.fields ?? []).map((field, fieldIndex) => {
                    const validation = validationSummary(
                      Array.isArray(field.validation)
                        ? Object.fromEntries(
                            field.validation
                              .filter((item) => item.rule?.code)
                              .map((item) => [item.rule?.code, item.value]),
                          )
                        : field.validation,
                    );
                    return (
                      <div className="question-row" key={field.fieldCode}>
                        <span className="question-index">
                          Q{fieldIndex + 1}
                        </span>
                        <div className="question-main">
                          <div className="question-label-row">
                            <strong>{field.label}</strong>
                            {field.isRequired ? (
                              <span className="mini-chip required">Required</span>
                            ) : null}
                            {!field.isEnabled ? (
                              <span className="mini-chip">Disabled</span>
                            ) : null}
                          </div>
                          <div className="question-tags">
                            <code>{field.fieldCode}</code>
                            <span>{labelize(codeOf(field.type))}</span>
                            <span>{labelize(codeOf(field.dataType))}</span>
                          </div>
                          {field.placeholder ? (
                            <p className="question-helper">
                              Placeholder: {field.placeholder}
                            </p>
                          ) : null}
                          {validation ? (
                            <p className="question-helper">{validation}</p>
                          ) : null}
                          {field.options?.length ? (
                            <div className="option-chips">
                              {field.options.map((option) => (
                                <span className="option-chip" key={option.value}>
                                  {option.label}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                  {!(section.fields ?? []).length ? (
                    <p className="empty-copy">
                      No fields in this section yet.
                    </p>
                  ) : null}
                </div>
              </section>
            ))
          ) : (
            <div className="panel empty-panel">
              <Icon name="forms" size={30} />
              <h3>No fields yet</h3>
              <p>
                {canEdit
                  ? "Edit this form to add sections and fields."
                  : "This form has no sections."}
              </p>
              {canEdit ? (
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => setEditing(true)}
                >
                  Add fields
                </button>
              ) : null}
            </div>
          )}

          {(form.Buttons ?? []).length ? (
            <section className="panel question-group">
              <header className="question-group-head">
                <span className="group-number">
                  <Icon name="send" size={15} />
                </span>
                <div>
                  <h3>Form buttons</h3>
                  <code>{form.Buttons?.length} configured</code>
                </div>
              </header>
              <div className="question-list">
                {(form.Buttons ?? []).map((button) => (
                  <div className="question-row" key={button.ButtonCode}>
                    <span className="question-index">
                      <Icon name="send" size={14} />
                    </span>
                    <div className="question-main">
                      <div className="question-label-row">
                        <strong>{button.Buttonlabel}</strong>
                        {!button.isEnabled ? (
                          <span className="mini-chip">Disabled</span>
                        ) : null}
                      </div>
                      <div className="question-tags">
                        <code>{button.ButtonCode}</code>
                        <span>{labelize(codeOf(button.executionType))}</span>
                      </div>
                      <p className="question-helper">{buttonEndpoint(button)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}

      {tab === "versions" ? (
        <section className="panel versions-panel">
          <div className="panel-head">
            <div>
              <h2>Version history</h2>
              <p>
                Review saved definitions and choose whether to edit the active
                form or create a separate version.
              </p>
            </div>
            <div className="button-row">
              {status === "PUBLISHED" && !form.isDeleted ? (
                <button
                  className="btn btn-primary btn-sm"
                  disabled={Boolean(busy || saving)}
                  type="button"
                  onClick={createVersion}
                >
                  <Icon name="plus" size={15} />
                  Create new version
                </button>
              ) : null}
              <button
                className="btn btn-ghost btn-sm"
                disabled={loadingVersions}
                type="button"
                onClick={() => void loadVersions(Boolean(form.isDeleted))}
              >
                <Icon name="refresh" size={15} />
                {loadingVersions ? "Refreshing…" : "Refresh"}
              </button>
            </div>
          </div>
          <VersionHistory
            busy={versionBusy ?? busy}
            canReopenForm={
              !form.isDeleted && (status === "ARCHIVED" || status === "PUBLISHED")
            }
            canArchiveForm={!form.isDeleted && status === "PUBLISHED"}
            canRestoreVersions={!form.isDeleted}
            canArchiveVersion={!form.isDeleted}
            canDeleteVersion={!form.isDeleted}
            canMoveVersionToDraft={!form.isDeleted}
            canPublishSelected={
              !form.isDeleted &&
              (status === "DRAFT" || status === "PUBLISHED")
            }
            canEditVersion={(version) =>
              canEdit ||
              (status === "PUBLISHED" &&
                !form.isDeleted &&
                version.version !== form.currentVersion)
            }
            form={form}
            loading={loadingVersions}
            onEdit={editVersion}
            onSelect={(version) => {
              if (!version.isDeleted) {
                setPreviewVersionNumber(version.version);
              }
            }}
            onRestore={restoreVersion}
            onPublishCurrent={() => void changeStatus("PUBLISHED")}
            onPublishPreviousVersion={(version) =>
              setConfirm({ kind: "publishVersion", version })
            }
            onReopenForm={(version) =>
              void changeStatus("DRAFT", version?._id)
            }
            onArchiveForm={() => setConfirm({ kind: "archive" })}
            onArchiveVersion={(version) =>
              setConfirm({ kind: "archiveVersion", version })
            }
            onMoveVersionToDraft={(version) =>
              setConfirm({ kind: "draftVersion", version })
            }
            onDeleteVersion={(version) =>
              setConfirm({ kind: "deleteVersion", version })
            }
            onPublishSelected={(version) =>
              setConfirm({ kind: "publishVersion", version })
            }
            versions={versions}
          />
        </section>
      ) : null}

      {tab === "preview" ? (
        <section className="preview-panel-wrap">
          <label className="field picker-field">
            <span className="field-label">Preview version</span>
            <select
              className="input"
              value={previewVersionNumber ?? form.currentVersion}
              onChange={(event) =>
                setPreviewVersionNumber(Number(event.target.value))
              }
            >
              {versions
                .filter((version) => !version.isDeleted)
                .map((version) => (
                  <option key={version._id} value={version.version}>
                    Version {version.version}
                    {version.version === form.currentVersion ? " · Active" : ""}
                  </option>
                ))}
            </select>
            <span className="field-hint">
              Previewing a saved version does not make it active.
            </span>
          </label>
          {codeOf(form.status) !== "PUBLISHED" && !form.isDeleted ? (
            <Notice tone="info">
              This is a preview of the {labelize(codeOf(form.status)).toLowerCase()}{" "}
              definition. API buttons still send real requests.
            </Notice>
          ) : null}
          <FormPreview
            form={previewVersion ? formFromVersion(form, previewVersion) : form}
            key={`${form._id}-${previewVersionNumber ?? form.currentVersion}`}
          />
        </section>
      ) : null}

      {editing ? (
        <FormBuilder
          createVersion={creatingVersion}
          form={
            editingVersion
              ? formFromVersion(form, editingVersion)
              : form
          }
          saving={saving}
          serverError={error}
          onCancel={() => {
            setEditing(false);
            setCreatingVersion(false);
            setEditingVersion(null);
            setError("");
          }}
          onSave={saveForm}
        />
      ) : null}

      <ConfirmDialog
        busy={confirmBusy}
        confirmLabel={confirmation?.label}
        message={confirmation?.message ?? ""}
        open={Boolean(confirm)}
        title={confirmation?.title ?? ""}
        tone={confirmation?.tone}
        onCancel={() => {
          if (!confirmBusy) setConfirm(null);
        }}
        onConfirm={() => void runConfirm()}
      />
      {publishVersionPickerOpen ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => {
            if (!busy && !versionBusy) setPublishVersionPickerOpen(false);
          }}
        >
          <section
            aria-labelledby="publish-version-title"
            aria-modal="true"
            className="confirm-card reopen-draft-card"
            role="dialog"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <span className="confirm-icon">
              <Icon
                name="publish"
                size={22}
              />
            </span>
            <div>
              <h2 id="publish-version-title">
                Publish a saved version
              </h2>
              <p>
                Select a saved draft version to publish. The form will remain
                published, and the previously published version will remain
                available in history as a draft.
              </p>
            </div>
            <label className="field">
              <span className="field-label">Saved version</span>
              <select
                autoFocus
                className="input"
                value={selectedVersionToPublishId}
                onChange={(event) =>
                  setSelectedVersionToPublishId(event.target.value)
                }
              >
                <option disabled value="">
                  Select a version to publish
                </option>
                {publishableVersions.map((version) => (
                  <option key={version._id} value={version._id}>
                    Version {version.version}
                    {version.createdAt
                      ? ` · ${formatDateTime(version.createdAt)}`
                      : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="confirm-actions">
              <button
                className="btn btn-ghost"
                disabled={Boolean(busy) || Boolean(versionBusy)}
                type="button"
                onClick={() => setPublishVersionPickerOpen(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={
                  !selectedVersionToPublishId ||
                  Boolean(busy) ||
                  Boolean(versionBusy)
                }
                type="button"
                onClick={() => void confirmPublishSelectedVersion()}
              >
                {versionBusy?.startsWith("publish-version-")
                  ? "Publishing…"
                  : "Publish selected version"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
