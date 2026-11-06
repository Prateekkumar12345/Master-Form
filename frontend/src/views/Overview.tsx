import { useCallback, useEffect, useState } from "react";

import { Icon } from "../components/Icon";
import { Notice } from "../components/Notice";
import { StatusBadge } from "../components/StatusBadge";
import { useApi } from "../context/ApiContext";
import type { View } from "../navigation";
import type { MasterForm } from "../types";
import {
  codeOf,
  errorMessage,
  formatDate,
  labelize,
} from "../utils";

interface OverviewProps {
  onOpenForm: (id: string) => void;
  onNavigate: (view: View) => void;
  onCreate: () => void;
}

interface Stats {
  active: number;
  drafts: number;
  published: number;
  archived: number;
  deleted: number;
}

const EMPTY_STATS: Stats = {
  active: 0,
  drafts: 0,
  published: 0,
  archived: 0,
  deleted: 0,
};

type Health = "checking" | "online" | "offline";

export function Overview({
  onOpenForm,
  onNavigate,
  onCreate,
}: OverviewProps) {
  const { send } = useApi();
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [recent, setRecent] = useState<MasterForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<Health>("checking");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    setHealth("checking");

    const [active, drafts, published, archived, deleted, recentResult, healthResult] =
      await Promise.all([
        send("GET", "/master-forms?limit=1"),
        send("GET", "/master-forms?status=DRAFT&limit=1"),
        send("GET", "/master-forms?status=PUBLISHED&limit=1"),
        send("GET", "/master-forms?status=ARCHIVED&limit=1"),
        send("GET", "/master-forms?isDeleted=true&limit=1"),
        send("GET", "/master-forms?limit=5&sortBy=updatedAt&sortOrder=desc"),
        send("GET", "/health"),
      ]);

    setHealth(healthResult.ok ? "online" : "offline");

    if (!active.ok) {
      setError(errorMessage(active));
      setLoading(false);
      return;
    }

    setStats({
      active: active.payload?.meta?.total ?? 0,
      drafts: drafts.payload?.meta?.total ?? 0,
      published: published.payload?.meta?.total ?? 0,
      archived: archived.payload?.meta?.total ?? 0,
      deleted: deleted.payload?.meta?.total ?? 0,
    });
    setRecent(recentResult.ok ? recentResult.payload?.data ?? [] : []);
    setLoading(false);
  }, [send]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="view">
      <section className="hero">
        <div className="hero-copy">
          <span className="hero-kicker">
            <Icon name="layers" size={15} />
            Form workspace
          </span>
          <h1>Every form, every version, in one clear place.</h1>
          <p>
            Build forms for your clients, publish them when they are ready, and
            move between saved versions without losing a thing.
          </p>
          <div className="hero-actions">
            <button className="btn btn-light" type="button" onClick={onCreate}>
              <Icon name="plus" size={16} /> Create a form
            </button>
          </div>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <div className="hero-card hero-card-back">
            <span className="hero-card-dot" />
            <span className="hero-line" />
            <span className="hero-line short" />
          </div>
          <div className="hero-card hero-card-mid">
            <span className="hero-line" />
            <span className="hero-line short" />
            <span className="hero-check">
              <Icon name="check" size={13} />
            </span>
          </div>
          <div className="hero-card hero-card-front">
            <span className="hero-card-label">Current version</span>
            <strong>Published</strong>
            <div className="hero-versions">
              <span>v3</span>
              <span className="active">v4</span>
              <span>v5</span>
            </div>
          </div>
        </div>
      </section>

      {health === "offline" ? (
        <Notice tone="error">
          The API could not be reached. Start the backend on port 8000 and
          refresh this page.
        </Notice>
      ) : null}
      {error ? (
        <Notice tone="error" onDismiss={() => setError("")}>
          {error}
        </Notice>
      ) : null}

      <section className="stat-grid" aria-label="Form totals">
        <button
          className="stat-card"
          type="button"
          onClick={() => onNavigate("forms")}
        >
          <span className="stat-icon stat-teal">
            <Icon name="forms" size={19} />
          </span>
          <span className="stat-caption">Forms in library</span>
          <strong>{loading ? "—" : stats.active}</strong>
          <small>Not deleted</small>
        </button>
        <button
          className="stat-card"
          type="button"
          onClick={() => onNavigate("forms")}
        >
          <span className="stat-icon stat-amber">
            <Icon name="edit" size={19} />
          </span>
          <span className="stat-caption">Drafts</span>
          <strong>{loading ? "—" : stats.drafts}</strong>
          <small>Ready to edit</small>
        </button>
        <button
          className="stat-card"
          type="button"
          onClick={() => onNavigate("forms")}
        >
          <span className="stat-icon stat-green">
            <Icon name="check-circle" size={19} />
          </span>
          <span className="stat-caption">Published</span>
          <strong>{loading ? "—" : stats.published}</strong>
          <small>Available to use</small>
        </button>
        <button
          className="stat-card"
          type="button"
          onClick={() => onNavigate("forms")}
        >
          <span className="stat-icon stat-slate">
            <Icon name="archive" size={19} />
          </span>
          <span className="stat-caption">Archived</span>
          <strong>{loading ? "—" : stats.archived}</strong>
          <small>
            {stats.deleted
              ? `${stats.deleted} deleted`
              : "None deleted"}
          </small>
        </button>
      </section>

      <div className="dashboard-grid">
        <section className="panel recent-panel">
          <div className="panel-head">
            <div>
              <h2>Recently updated</h2>
              <p>Pick up where you left off.</p>
            </div>
            <button
              className="text-button"
              type="button"
              onClick={() => onNavigate("forms")}
            >
              View all <Icon name="arrow-right" size={14} />
            </button>
          </div>

          {loading ? (
            <div className="recent-list">
              {Array.from({ length: 4 }).map((_, index) => (
                <div className="recent-row skeleton-row" key={index}>
                  <span className="skeleton skeleton-icon" />
                  <span className="skeleton skeleton-line wide" />
                </div>
              ))}
            </div>
          ) : recent.length ? (
            <div className="recent-list">
              {recent.map((form) => (
                <button
                  className="recent-row"
                  key={form._id}
                  type="button"
                  onClick={() => onOpenForm(form._id)}
                >
                  <span className="recent-icon">
                    <Icon name="file" size={17} />
                  </span>
                  <span className="recent-copy">
                    <strong>{form.name}</strong>
                    <small>
                      {labelize(codeOf(form.formType))} · Version{" "}
                      {form.currentVersion} · Updated {formatDate(form.updatedAt)}
                    </small>
                  </span>
                  <StatusBadge
                    deleted={form.isDeleted}
                    status={codeOf(form.status)}
                  />
                  <Icon name="chevron-right" size={15} />
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-panel compact">
              <span className="empty-icon">
                <Icon name="forms" size={24} />
              </span>
              <h3>No forms yet</h3>
              <p>Create your first form to get started.</p>
              <button className="btn btn-primary" type="button" onClick={onCreate}>
                Create a form
              </button>
            </div>
          )}
        </section>

        <aside className="dashboard-aside">
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Quick actions</h2>
                <p>Common things you can do.</p>
              </div>
            </div>
            <div className="quick-list">
              <button className="quick-link" type="button" onClick={onCreate}>
                <span className="quick-icon">
                  <Icon name="plus" size={17} />
                </span>
                <span>
                  <strong>Create a form</strong>
                  <small>Start from a blank draft</small>
                </span>
                <Icon name="chevron-right" size={15} />
              </button>
              <button
                className="quick-link"
                type="button"
                onClick={() => onNavigate("versions")}
              >
                <span className="quick-icon">
                  <Icon name="history" size={17} />
                </span>
                <span>
                  <strong>Review version history</strong>
                  <small>Compare or restore saved versions</small>
                </span>
                <Icon name="chevron-right" size={15} />
              </button>
            </div>
          </section>

          <section
            className={`panel connection-card${
              health === "offline" ? " offline" : ""
            }`}
          >
            <span
              className={`connection-dot${
                health === "online"
                  ? " online"
                  : health === "offline"
                    ? " offline"
                    : ""
              }`}
            />
            <div>
              <strong>
                {health === "online"
                  ? "Backend connected"
                  : health === "offline"
                    ? "Backend unavailable"
                    : "Checking connection…"}
              </strong>
              <small>
                {health === "online"
                  ? "The API is ready for requests."
                  : health === "offline"
                    ? "Start the FastAPI server on port 8000."
                    : "Checking the health endpoint."}
              </small>
            </div>
            <button
              aria-label="Refresh workspace"
              className="icon-button"
              disabled={loading}
              type="button"
              onClick={() => void refresh()}
            >
              <Icon name="refresh" size={15} />
            </button>
          </section>
        </aside>
      </div>
    </div>
  );
}
