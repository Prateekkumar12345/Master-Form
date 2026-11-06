import { useCallback, useEffect, useState } from "react";

import { Icon } from "./components/Icon";
import { NAV_ITEMS, type View } from "./navigation";
import { FormDetail } from "./views/FormDetail";
import { MasterForms } from "./views/MasterForms";
import { Overview } from "./views/Overview";
import { Versions } from "./views/Versions";

export function App() {
  const [view, setView] = useState<View>("overview");
  const [formId, setFormId] = useState<string | null>(null);
  const [createRequest, setCreateRequest] = useState(0);

  const navigate = useCallback((next: View) => {
    setView(next);
    if (next === "forms") setFormId(null);
  }, []);

  const openForm = useCallback((id: string) => {
    setFormId(id);
    setView("forms");
  }, []);

  const createForm = useCallback(() => {
    setFormId(null);
    setView("forms");
    setCreateRequest((current) => current + 1);
  }, []);

  const handleCreateHandled = useCallback(() => {
    setCreateRequest(0);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [formId, view]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#overview"
          onClick={(event) => {
            event.preventDefault();
            setFormId(null);
            setView("overview");
          }}
        >
          <span className="brand-mark">N</span>
          <span className="brand-text">
            <strong>Nutri AI</strong>
            <small>Form workspace</small>
          </span>
        </a>

        <nav className="nav-list" aria-label="Main navigation">
          {NAV_ITEMS.map((item) => (
            <button
              aria-current={view === item.id ? "page" : undefined}
              className={`nav-item${view === item.id ? " active" : ""}`}
              key={item.id}
              type="button"
              onClick={() => navigate(item.id)}
            >
              <span className="nav-icon">
                <Icon name={item.icon} size={18} />
              </span>
              <span className="nav-copy">
                <span className="nav-label">{item.label}</span>
                <span className="nav-hint">{item.hint}</span>
              </span>
              <Icon name="chevron-right" size={15} />
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <span className="sidebar-dot" />
          <span>
            <small>ADMIN WORKSPACE</small>
            <strong>Forms · Versions · Actions</strong>
          </span>
        </div>
      </aside>

      <main className="main-content">
        <div className="main-inner">
          {view === "overview" ? (
            <Overview
              onCreate={createForm}
              onNavigate={navigate}
              onOpenForm={openForm}
            />
          ) : null}

          {view === "forms" && formId ? (
            <FormDetail formId={formId} onBack={() => setFormId(null)} />
          ) : null}

          {view === "forms" && !formId ? (
            <MasterForms
              createRequest={createRequest}
              onCreateHandled={handleCreateHandled}
              onOpenForm={openForm}
            />
          ) : null}

          {view === "versions" ? (
            <Versions initialId={formId ?? ""} onOpenForm={openForm} />
          ) : null}

        </div>
        <footer className="app-footer">
          Nutri AI · Your forms, thoughtfully organized
        </footer>
      </main>
    </div>
  );
}
