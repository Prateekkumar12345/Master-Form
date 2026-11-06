import { useCallback, useEffect, useState } from "react";

import { ConfirmDialog } from "../components/ConfirmDialog";
import { FormBuilder } from "../components/FormBuilder";
import { Icon } from "../components/Icon";
import { Notice } from "../components/Notice";
import { StatusBadge } from "../components/StatusBadge";
import { VersionHistory } from "../components/VersionHistory";
import { formFromVersion } from "../formModel";
import { useApi } from "../context/ApiContext";
import type { MasterForm, VersionEntry } from "../types";
import { canEditForm, codeOf, errorMessage } from "../utils";

type PendingAction =
  | { kind: "publish"; version: VersionEntry }
  | { kind: "archiveForm" }
  | { kind: "archiveVersion"; version: VersionEntry }
  | { kind: "draftVersion"; version: VersionEntry }
  | { kind: "deleteVersion"; version: VersionEntry };

interface VersionsProps {
  initialId?: string;
  onOpenForm: (id: string) => void;
}

export function Versions({ initialId = "", onOpenForm }: VersionsProps) {
  const { send } = useApi();
  const [forms, setForms] = useState<MasterForm[]>([]);
  const [formId, setFormId] = useState(initialId);
  const [form, setForm] = useState<MasterForm | null>(null);
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [loadingForms, setLoadingForms] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<PendingAction | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [editingVersion, setEditingVersion] = useState<VersionEntry | null>(
    null,
  );

  const loadForms = useCallback(async () => {
    setLoadingForms(true);
    const result = await send(
      "GET",
      "/master-forms?limit=100&sortBy=name&sortOrder=asc",
    );
    setLoadingForms(false);
    if (!result.ok) {
      setError(errorMessage(result));
      return;
    }
    const list = (result.payload?.data ?? []) as MasterForm[];
    setForms(list);
    setFormId((current) => current || list[0]?._id || "");
  }, [send]);

  useEffect(() => {
    void loadForms();
  }, [loadForms]);

  const loadHistory = useCallback(
    async (id: string) => {
      if (!id) {
        setForm(null);
        setVersions([]);
        return;
      }
      setLoading(true);
      setError("");
      const [formResult, versionResult] = await Promise.all([
        send("GET", `/master-forms/${encodeURIComponent(id)}`),
        send(
          "GET",
          `/master-forms/${encodeURIComponent(id)}/versions?limit=100&sortOrder=desc&includeDeleted=true`,
        ),
      ]);
      setLoading(false);
      if (!formResult.ok) {
        setError(errorMessage(formResult));
        setForm(null);
        setVersions([]);
        return;
      }
      if (!versionResult.ok) {
        setError(errorMessage(versionResult));
        setVersions([]);
        setForm(formResult.payload?.data as MasterForm);
        return;
      }
      setForm(formResult.payload?.data as MasterForm);
      setVersions(versionResult.payload?.data ?? []);
    },
    [send],
  );

  useEffect(() => {
    void loadHistory(formId);
  }, [formId, loadHistory]);

  const publishVersion = async (version: VersionEntry) => {
    if (!form) return;
    setBusy(`publish-version-${version._id}`);
    setError("");
    const result = await send(
      "PATCH",
      `/master-forms/${encodeURIComponent(form._id)}/versions/${encodeURIComponent(
        version._id,
      )}`,
      { status: "PUBLISHED" },
    );
    setBusy(null);
    if (!result.ok) {
      setError(errorMessage(result));
      return;
    }
    const updated = result.payload?.data as MasterForm;
    setForm(updated);
    if (codeOf(updated.status) === "PUBLISHED") {
      setNotice(
        `Version ${version.version} is now published. The previously published version is now a draft.`,
      );
    } else if (codeOf(updated.status) === "ARCHIVED") {
      setNotice(
        `Version ${version.version} is now the active version. Reopen the form as a draft when you want to publish it.`,
      );
    } else {
      setNotice(
        `Version ${version.version} is now the active version. Publish it when you are ready; no new version was created.`,
      );
    }
    await loadHistory(form._id);
    await loadForms();
  };

  const archiveVersion = async (version: VersionEntry) => {
    if (!form || version.version === form.currentVersion || busy) return;
    setBusy(`archive-version-${version._id}`);
    setError("");
    const result = await send(
      "PATCH",
      `/master-forms/${encodeURIComponent(form._id)}/versions/${encodeURIComponent(
        version._id,
      )}`,
      { status: "ARCHIVED" },
    );
    setBusy(null);
    if (!result.ok) {
      setError(errorMessage(result));
      return;
    }
    setNotice(`Version ${version.version} was archived.`);
    await loadHistory(form._id);
  };

  const moveVersionToDraft = async (version: VersionEntry) => {
    if (!form || version.version === form.currentVersion || busy) return;
    setBusy(`draft-version-${version._id}`);
    setError("");
    const result = await send(
      "PATCH",
      `/master-forms/${encodeURIComponent(form._id)}/versions/${encodeURIComponent(
        version._id,
      )}`,
      { status: "DRAFT" },
    );
    setBusy(null);
    if (!result.ok) {
      setError(errorMessage(result));
      return;
    }
    setNotice(`Version ${version.version} was moved to draft.`);
    await loadHistory(form._id);
  };

  const deleteVersion = async (version: VersionEntry) => {
    if (!form || version.version === form.currentVersion || busy) return;
    setBusy(`delete-version-${version._id}`);
    setError("");
    const result = await send(
      "DELETE",
      `/master-forms/${encodeURIComponent(form._id)}/versions/${encodeURIComponent(
        version._id,
      )}`,
    );
    setBusy(null);
    if (!result.ok) {
      setError(errorMessage(result));
      return;
    }
    setNotice(`Archived version ${version.version} was moved to Deleted versions.`);
    await loadHistory(form._id);
  };

  const publishCurrentVersion = async () => {
    if (!form || codeOf(form.status) !== "DRAFT" || busy) return;
    setBusy("publish");
    setError("");
    const result = await send(
      "PATCH",
      `/master-forms/${encodeURIComponent(form._id)}`,
      { status: "PUBLISHED" },
    );
    setBusy(null);
    if (!result.ok) {
      setError(errorMessage(result));
      return;
    }
    setForm(result.payload?.data as MasterForm);
    setNotice("The current version is now published.");
    await loadHistory(form._id);
    await loadForms();
  };

  const reopenFormAsDraft = async (version?: VersionEntry) => {
    if (
      !form ||
      !["ARCHIVED", "PUBLISHED"].includes(codeOf(form.status)) ||
      busy
    )
      return;
    setBusy("status-DRAFT");
    setError("");
    const result = await send(
      "PATCH",
      `/master-forms/${encodeURIComponent(form._id)}`,
      {
        status: "DRAFT",
        ...(version ? { masterFormVersionId: version._id } : {}),
      },
    );
    setBusy(null);
    if (!result.ok) {
      setError(errorMessage(result));
      return;
    }
    setForm(result.payload?.data as MasterForm);
    setNotice(
      version && version.version !== form.currentVersion
        ? `Version ${version.version} is now the active draft. The previously published version remains in history as a draft.`
        : "The form is now a draft and can be edited or published.",
    );
    await loadHistory(form._id);
    await loadForms();
  };

  const archiveForm = async () => {
    if (!form || codeOf(form.status) !== "PUBLISHED" || busy) return;
    setBusy("status-ARCHIVED");
    setError("");
    const result = await send(
      "PATCH",
      `/master-forms/${encodeURIComponent(form._id)}`,
      { status: "ARCHIVED" },
    );
    setBusy(null);
    if (!result.ok) {
      setError(errorMessage(result));
      return;
    }
    setNotice("The form is archived. You can reopen it as a draft at any time.");
    await loadHistory(form._id);
    await loadForms();
  };

  const restoreVersion = async (version: VersionEntry) => {
    if (!form) return;
    setBusy(`restore-${version._id}`);
    setError("");
    const result = await send(
      "POST",
      `/master-forms/${encodeURIComponent(form._id)}/versions/${encodeURIComponent(
        version._id,
      )}/restore`,
    );
    setBusy(null);
    if (!result.ok) {
      setError(errorMessage(result));
      return;
    }
    setNotice(`Version ${version.version} was restored.`);
    await loadHistory(form._id);
  };

  const editVersion = async (
    version: VersionEntry,
    payload: Record<string, unknown>,
  ): Promise<boolean> => {
    if (!form) return false;
    setBusy(`edit-${version._id}`);
    setError("");
    const result = await send(
      "PATCH",
      `/master-forms/${encodeURIComponent(form._id)}`,
      { ...payload, masterFormVersionId: version._id },
    );
    setBusy(null);
    if (!result.ok) {
      setError(errorMessage(result));
      return false;
    }
    const updated = result.payload?.data as MasterForm;
    setForm(updated);
    setEditingVersion(null);
    const createdVersion = Math.max(
      updated.currentVersion,
      ...(updated.versions ?? []).map((entry) => entry.version),
    );
    setNotice(
      codeOf(updated.status) === "PUBLISHED"
        ? `Your edits were saved as version ${createdVersion}. The published active version ${updated.currentVersion} is unchanged.`
        : `Your edits were saved as version ${createdVersion}. The selected snapshot remains unchanged.`,
    );
    await loadHistory(form._id);
    await loadForms();
    return true;
  };

  const beginEditVersion = (version: VersionEntry) => {
    setError("");
    setEditingVersion(version);
  };

  const runConfirm = async () => {
    if (!confirm) return;
    setConfirmBusy(true);
    try {
      if (confirm.kind === "publish") await publishVersion(confirm.version);
      else if (confirm.kind === "archiveForm") await archiveForm();
      else if (confirm.kind === "archiveVersion")
        await archiveVersion(confirm.version);
      else if (confirm.kind === "draftVersion")
        await moveVersionToDraft(confirm.version);
      else await deleteVersion(confirm.version);
    } finally {
      setConfirmBusy(false);
      setConfirm(null);
    }
  };

  const confirmation = confirm
    ? confirm.kind === "publish"
      ? {
        title: `Publish version ${confirm.version.version}?`,
        message:
          codeOf(form?.status) === "DRAFT"
            ? "The selected draft version becomes the active published definition, and the form status changes to Published. The previous current version remains saved as a draft."
            : "The selected draft version becomes the published definition, and the previously published version becomes a draft. No new version is created and saved snapshots are unchanged.",
        label:
          codeOf(form?.status) === "DRAFT"
            ? "Publish form"
            : "Publish version",
        tone: "primary" as const,
      }
      : confirm.kind === "archiveForm"
        ? {
            title: "Archive this form?",
            message:
              "Archiving makes the form inactive. It stays in the library and can be reopened as a draft later.",
            label: "Archive Form",
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
        : confirm.kind === "draftVersion"
          ? {
              title: `Move version ${confirm.version.version} to draft?`,
              message:
                "This changes only the selected version to Draft. The master form status and other saved versions will remain unchanged.",
              label: "Move version to draft",
              tone: "primary" as const,
            }
          : {
              title: `Delete archived version ${confirm.version.version}?`,
              message:
                "This moves the archived version to Deleted versions. You can restore it later.",
              label: "Delete version",
              tone: "danger" as const,
            }
    : null;

  const editable = canEditForm(form);
  const selectedForm =
    forms.find((item) => item._id === formId) ?? form ?? null;

  return (
    <div className="view">
      <header className="page-header">
        <div>
          <div className="breadcrumb">
            Workspace <span>/</span> Version history
          </div>
          <h1>Form versions</h1>
          <p>
            Review saved versions or edit one to create a new version. On a
            published form, publish a saved draft version to replace the current
            published definition. Archived forms must be reopened as drafts.
          </p>
        </div>
        {form ? (
          <div className="page-actions">
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => onOpenForm(form._id)}
            >
              Open form details <Icon name="arrow-right" size={16} />
            </button>
          </div>
        ) : null}
      </header>

      {notice ? (
        <Notice tone="success" onDismiss={() => setNotice("")}>
          {notice}
        </Notice>
      ) : null}
      {error ? (
        <Notice tone="error" onDismiss={() => setError("")}>
          {error}
        </Notice>
      ) : null}

      <section className="panel versions-picker">
        <label className="field picker-field">
          <span className="field-label">Choose a form</span>
          <select
            className="input"
            disabled={loadingForms}
            value={formId}
            onChange={(event) => {
              setNotice("");
              setError("");
              setFormId(event.target.value);
            }}
          >
            {!forms.length ? (
              <option value="">No forms available</option>
            ) : null}
            {forms.map((item) => (
              <option key={item._id} value={item._id}>
                {item.name} · {item.formCode}
              </option>
            ))}
          </select>
          <span className="field-hint">
            Showing active forms. Restore a deleted form from the library first.
          </span>
        </label>
        {form ? (
          <div className="picker-summary">
            <div>
              <span>Status</span>
              <strong>
                <StatusBadge status={codeOf(form.status)} />
              </strong>
            </div>
            <div>
              <span>Current version</span>
              <strong>v{form.currentVersion}</strong>
            </div>
            <div>
              <span>Saved versions</span>
              <strong>{versions.length} total</strong>
            </div>
          </div>
        ) : null}
      </section>

      {loadingForms ? (
        <div className="panel detail-loading">
          <span className="spinner" />
          <p>Loading your forms…</p>
        </div>
      ) : !selectedForm ? (
        <div className="panel empty-panel">
          <span className="empty-icon">
            <Icon name="forms" size={28} />
          </span>
          <h2>No forms to show</h2>
          <p>
            Create a form in the library first, then its versions will appear
            here.
          </p>
        </div>
      ) : loading && !form ? (
        <div className="panel detail-loading">
          <span className="spinner" />
          <p>Loading version history…</p>
        </div>
      ) : (
        <section className="panel versions-panel">
          {form ? (
            <VersionHistory
              busy={busy}
              canReopenForm={
                !form.isDeleted &&
                ["ARCHIVED", "PUBLISHED"].includes(codeOf(form.status))
              }
              canArchiveForm={
                !form.isDeleted && codeOf(form.status) === "PUBLISHED"
              }
              canRestoreVersions={!form.isDeleted}
              canArchiveVersion={!form.isDeleted}
              canDeleteVersion={!form.isDeleted}
              canMoveVersionToDraft={!form.isDeleted}
              canPublishSelected={
                !form.isDeleted &&
                ["DRAFT", "PUBLISHED"].includes(codeOf(form.status))
              }
              canEditVersion={(version) =>
                editable ||
                (codeOf(form.status) === "PUBLISHED" &&
                  version.version !== form.currentVersion)
              }
              form={form}
              loading={loading}
              onEdit={beginEditVersion}
              onRestore={restoreVersion}
              onPublishCurrent={() => void publishCurrentVersion()}
              onPublishPreviousVersion={(version) =>
                setConfirm({ kind: "publish", version })
              }
              onReopenForm={(version) => void reopenFormAsDraft(version)}
              onArchiveForm={() => setConfirm({ kind: "archiveForm" })}
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
                setConfirm({ kind: "publish", version })
              }
              versions={versions}
            />
          ) : null}
        </section>
      )}

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
      {editingVersion && form ? (
        <FormBuilder
          key={`${form._id}-${editingVersion._id}`}
          form={formFromVersion(form, editingVersion)}
          saving={busy === `edit-${editingVersion._id}`}
          serverError={error}
          onCancel={() => {
            setEditingVersion(null);
            setError("");
          }}
          onSave={(payload) => editVersion(editingVersion, payload)}
        />
      ) : null}
    </div>
  );
}
