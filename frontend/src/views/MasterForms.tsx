import { useCallback, useEffect, useRef, useState } from "react";

import { FormBuilder } from "../components/FormBuilder";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon, type IconName } from "../components/Icon";
import { Notice } from "../components/Notice";
import { StatusBadge } from "../components/StatusBadge";
import { useApi } from "../context/ApiContext";
import { FORM_TYPE_OPTIONS } from "../formModel";
import { clearStoredFormDraft } from "../formDraftStorage";
import type { MasterForm } from "../types";
import {
  STATUSES,
  codeOf,
  errorMessage,
  formatDate,
  labelize,
} from "../utils";

interface MasterFormsProps {
  onOpenForm: (id: string) => void;
  createRequest: number;
  onCreateHandled: () => void;
}

type DeleteFilter = "active" | "deleted" | "all";
type LibraryAction = {
  kind: "delete" | "restore";
  form: MasterForm;
};

const SORT_OPTIONS = [
  { value: "updatedAt:desc", label: "Recently updated" },
  { value: "createdAt:desc", label: "Newest first" },
  { value: "name:asc", label: "Name A–Z" },
  { value: "status:asc", label: "Status" },
];

function typeIcon(type: string): IconName {
  if (type === "REGISTRATION") return "forms";
  if (type === "DIET_PLAN") return "sliders";
  if (type === "LOGIN") return "lock";
  if (type === "ASSESSMENT") return "file";
  return "layers";
}

function questionsIn(form: MasterForm): number {
  return (form.sections ?? []).reduce(
    (total, section) => total + (section.fields?.length ?? 0),
    0,
  );
}

export function MasterForms({
  onOpenForm,
  createRequest,
  onCreateHandled,
}: MasterFormsProps) {
  const { send } = useApi();
  const [forms, setForms] = useState<MasterForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [deleteFilter, setDeleteFilter] = useState<DeleteFilter>("active");
  const [sort, setSort] = useState("updatedAt:desc");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState("");
  const [pendingAction, setPendingAction] = useState<LibraryAction | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const requestHandled = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(query.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (createRequest > 0 && !requestHandled.current) {
      requestHandled.current = true;
      setCreating(true);
      setCreateError("");
      onCreateHandled();
    }
    if (createRequest === 0) requestHandled.current = false;
  }, [createRequest, onCreateHandled]);

  const listPath = useCallback(() => {
    const [sortBy, sortOrder] = sort.split(":");
    const params = new URLSearchParams({
      page: String(page),
      limit: "12",
      sortBy,
      sortOrder,
    });
    if (search) params.set("name", search);
    if (filterType) params.set("formType", filterType);
    if (filterStatus) params.set("status", filterStatus);
    if (deleteFilter === "deleted") params.set("isDeleted", "true");
    if (deleteFilter === "all") params.set("includeDeleted", "true");
    return `/master-forms?${params.toString()}`;
  }, [deleteFilter, filterStatus, filterType, page, search, sort]);

  const loadForms = useCallback(async () => {
    setLoading(true);
    const result = await send("GET", listPath());
    setLoading(false);
    if (!result.ok) {
      setError(errorMessage(result));
      return;
    }
    setForms(result.payload?.data ?? []);
    setTotal(result.payload?.meta?.total ?? 0);
    setTotalPages(Math.max(1, result.payload?.meta?.totalPages ?? 1));
    setError("");
  }, [listPath, send]);

  useEffect(() => {
    void loadForms();
  }, [loadForms]);

  const createForm = async (
    payload: Record<string, unknown>,
  ): Promise<boolean> => {
    setSaving(true);
    setCreateError("");
    const result = await send("POST", "/master-forms", payload);
    setSaving(false);
    if (!result.ok) {
      setCreateError(errorMessage(result));
      return false;
    }
    const form = result.payload?.data as MasterForm;
    clearStoredFormDraft();
    setCreating(false);
    setNotice(
      "Your new form is ready as a draft. Add fields and publish it when you are happy with it.",
    );
    await loadForms();
    if (form?._id) onOpenForm(form._id);
    return true;
  };

  const runLibraryAction = async () => {
    if (!pendingAction || actionBusy) return;
    setActionBusy(true);
    setError("");
    const { kind, form } = pendingAction;
    const result = await send(
      kind === "delete" ? "DELETE" : "POST",
      `/master-forms/${encodeURIComponent(form._id)}${
        kind === "restore" ? "/restore" : ""
      }`,
    );
    setActionBusy(false);
    if (!result.ok) {
      setError(errorMessage(result));
      return;
    }

    setNotice(
      kind === "delete"
        ? `"${form.name}" was moved to Deleted forms.`
        : `"${form.name}" was restored to the form library.`,
    );
    setPendingAction(null);
    await loadForms();
  };

  const clearFilters = () => {
    setQuery("");
    setSearch("");
    setFilterType("");
    setFilterStatus("");
    setDeleteFilter("active");
    setPage(1);
  };

  const hasFilters = Boolean(
    search || filterType || filterStatus || deleteFilter !== "active",
  );

  return (
    <div className="view">
      <header className="page-header">
        <div>
          <div className="breadcrumb">
            Workspace <span>/</span> Form library
          </div>
          <h1>Your form library</h1>
          <p>
            Create, edit and publish the forms your clients use. New forms start
            as drafts, so nothing goes live until you are ready.
          </p>
        </div>
        <div className="page-actions">
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => {
              setCreating(true);
              setCreateError("");
              setNotice("");
            }}
          >
            <Icon name="plus" size={16} /> Create form
          </button>
        </div>
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

      <section className="library-panel">
        <div className="library-toolbar">
          <label className="search-box">
            <Icon name="search" size={16} />
            <input
              aria-label="Search forms by name"
              placeholder="Search forms by name…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query ? (
              <button
                aria-label="Clear search"
                className="icon-button"
                type="button"
                onClick={() => setQuery("")}
              >
                <Icon name="x" size={14} />
              </button>
            ) : null}
          </label>
          <select
            aria-label="Filter by category"
            className="input toolbar-select"
            value={filterType}
            onChange={(event) => {
              setFilterType(event.target.value);
              setPage(1);
            }}
          >
            <option value="">All categories</option>
            {FORM_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by status"
            className="input toolbar-select"
            value={filterStatus}
            onChange={(event) => {
              setFilterStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {labelize(status)}
              </option>
            ))}
          </select>
          <select
            aria-label="Sort forms"
            className="input toolbar-select"
            value={sort}
            onChange={(event) => {
              setSort(event.target.value);
              setPage(1);
            }}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="library-subbar">
          <div className="segmented" role="tablist" aria-label="Form state">
            {(
              [
                ["active", "Active", "forms"],
                ["deleted", "Deleted", "trash"],
                ["all", "All forms", "layers"],
              ] as [DeleteFilter, string, IconName][]
            ).map(([key, label, icon]) => (
              <button
                aria-selected={deleteFilter === key}
                className={`segment${deleteFilter === key ? " active" : ""}`}
                key={key}
                role="tab"
                type="button"
                onClick={() => {
                  setDeleteFilter(key);
                  setPage(1);
                }}
              >
                <Icon name={icon} size={15} />
                {label}
              </button>
            ))}
          </div>
          <span className="library-count">
            {loading
              ? "Loading forms…"
              : `${total} ${total === 1 ? "form" : "forms"} in this view`}
          </span>
        </div>

        {loading ? (
          <div className="form-grid">
            {Array.from({ length: 6 }).map((_, index) => (
              <div className="form-card skeleton-card" key={index}>
                <span className="skeleton skeleton-icon" />
                <span className="skeleton skeleton-line wide" />
                <span className="skeleton skeleton-line" />
                <span className="skeleton skeleton-line short" />
              </div>
            ))}
          </div>
        ) : forms.length ? (
          <div className="form-grid">
            {forms.map((form) => (
              <article
                className={`form-card${form.isDeleted ? " form-card-deleted" : ""}`}
                key={form._id}
              >
                <div className="form-card-top">
                  <span
                    className={`form-type-icon type-${codeOf(
                      form.formType,
                    ).toLowerCase()}`}
                  >
                    <Icon name={typeIcon(codeOf(form.formType))} size={20} />
                  </span>
                  <StatusBadge
                    deleted={form.isDeleted}
                    status={codeOf(form.status)}
                  />
                </div>
                <div className="form-card-body">
                  <h2>{form.name}</h2>
                  <p>{form.description || "No description added yet."}</p>
                </div>
                <div className="form-card-tags">
                  <span>{labelize(codeOf(form.formType))}</span>
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
                        onClick={() => setPendingAction({ kind: "delete", form })}
                      >
                        <Icon name="trash" size={14} />
                        Delete
                      </button>
                    ) : null}
                    {form.isDeleted ? (
                      <button
                        aria-label={`Restore ${form.name}`}
                        className="btn btn-secondary btn-sm"
                        disabled={actionBusy}
                        type="button"
                        onClick={() => setPendingAction({ kind: "restore", form })}
                      >
                        <Icon name="restore" size={14} />
                        Restore
                      </button>
                    ) : null}
                    <button
                      aria-label={`Open ${form.name}`}
                      className="card-open card-open-button"
                      type="button"
                      onClick={() => onOpenForm(form._id)}
                    >
                      Open <Icon name="arrow-right" size={14} />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-panel">
            <span className="empty-icon">
              <Icon name={hasFilters ? "search" : "forms"} size={28} />
            </span>
            <h2>{hasFilters ? "No matching forms" : "No forms here yet"}</h2>
            <p>
              {hasFilters
                ? "Try a different search term or clear the filters to see everything."
                : "Create your first form to start collecting information from your clients."}
            </p>
            {hasFilters ? (
              <button
                className="btn btn-secondary"
                type="button"
                onClick={clearFilters}
              >
                Clear filters
              </button>
            ) : (
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => setCreating(true)}
              >
                <Icon name="plus" size={16} /> Create your first form
              </button>
            )}
          </div>
        )}

        <div className="library-footer">
          <span>
            {forms.length
              ? `${(page - 1) * 12 + 1}–${Math.min(
                  page * 12,
                  total,
                )} of ${total}`
              : "0 forms"}
          </span>
          <div className="pagination">
            <button
              className="btn btn-ghost btn-sm"
              disabled={page <= 1 || loading}
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              <Icon name="arrow-left" size={15} /> Previous
            </button>
            <span className="page-number">
              Page {page} of {totalPages}
            </span>
            <button
              className="btn btn-ghost btn-sm"
              disabled={page >= totalPages || loading}
              type="button"
              onClick={() =>
                setPage((current) => Math.min(totalPages, current + 1))
              }
            >
              Next <Icon name="arrow-right" size={15} />
            </button>
          </div>
        </div>
      </section>

      {creating ? (
        <FormBuilder
          saving={saving}
          serverError={createError}
          onCancel={() => {
            setCreating(false);
            setCreateError("");
          }}
          onSave={createForm}
        />
      ) : null}

      <ConfirmDialog
        busy={actionBusy}
        confirmLabel={pendingAction?.kind === "delete" ? "Delete form" : "Restore form"}
        message={
          pendingAction?.kind === "delete"
            ? `"${pendingAction.form.name}" will be moved to Deleted forms. You can restore it later.`
            : `Restore "${pendingAction?.form.name ?? "this form"}" to the form library? Its archived status will remain unchanged.`
        }
        open={Boolean(pendingAction)}
        title={
          pendingAction?.kind === "delete"
            ? "Delete this archived form?"
            : "Restore this form?"
        }
        tone={pendingAction?.kind === "delete" ? "danger" : "primary"}
        onCancel={() => {
          if (!actionBusy) setPendingAction(null);
        }}
        onConfirm={() => void runLibraryAction()}
      />
    </div>
  );
}
