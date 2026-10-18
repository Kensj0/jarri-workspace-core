import { useEffect, useState } from "react";
import type { PersistedModuleRecord } from "../../../core/types";

type Props = {
  getModules: () => PersistedModuleRecord[];
};

// The app list comes from jarri-apps/apps.json, through the store service.
// A module with an entry there is a service or a web app. A module without
// one is built into Jarri.
type AppEntry = {
  id: string;
  title: string;
  kind: "service" | "web" | "builtin";
  port?: number;
  ui?: string;
};

async function loadApps(): Promise<AppEntry[] | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${STORE_PORT}/apps`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { apps: AppEntry[] };
    return body.apps;
  } catch {
    return null;
  }
}

const STORE_PORT = 8785;
const CHECK_INTERVAL_MS = 15_000;
const UPDATE_CHECK_INTERVAL_MS = 60_000;

type Health = "up" | "down" | "unknown";

type UpdateInfo = {
  version: string;
  latest: string;
  updateAvailable: boolean;
  canUndo: boolean;
};

// A service that answers at all, even with 404, counts as up.
async function checkService(port: number): Promise<Health> {
  try {
    await fetch(`http://127.0.0.1:${port}/`, {
      signal: AbortSignal.timeout(1500),
    });
    return "up";
  } catch {
    return "down";
  }
}

async function loadUpdates(): Promise<Record<string, UpdateInfo> | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${STORE_PORT}/status`, {
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { services: Record<string, UpdateInfo> };
    return body.services;
  } catch {
    return null;
  }
}

const DOT: Record<Health, string> = {
  up: "#2f9e5f",
  down: "#c0392b",
  unknown: "#999999",
};

const LABEL: Record<Health, string> = {
  up: "Service running",
  down: "Service down",
  unknown: "No service",
};

type Kind = "service" | "web" | "builtin" | "unknown";

// Until the app list has loaded, a module's kind is unknown, not built-in.
function kindOf(moduleId: string, apps: AppEntry[] | null): Kind {
  if (apps === null) return "unknown";
  const app = apps.find((entry) => entry.id === moduleId);
  return app ? app.kind : "builtin";
}

const BADGE: Record<Exclude<Kind, "service">, { text: string; color: string }> = {
  web: { text: "Web app", color: "#2f6fbf" },
  builtin: { text: "Built-in", color: "#7a6a4f" },
  unknown: { text: "…", color: "#999999" },
};

export function ModuleStorePanel({ getModules }: Props) {
  const modules = getModules();
  const [apps, setApps] = useState<AppEntry[] | null>(null);
  const [health, setHealth] = useState<Record<string, Health>>({});
  const [updates, setUpdates] = useState<Record<string, UpdateInfo> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function refreshApps() {
      const list = await loadApps();
      if (!cancelled) setApps(list);
    }

    void refreshApps();
    const timer = window.setInterval(() => void refreshApps(), UPDATE_CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const services = (apps ?? []).filter((app) => app.kind === "service" && app.port);

    async function refresh() {
      const entries = await Promise.all(
        services.map(async (app) => [app.id, await checkService(app.port as number)] as const),
      );
      if (!cancelled) {
        setHealth(Object.fromEntries(entries));
      }
    }

    void refresh();
    const timer = window.setInterval(() => void refresh(), CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [apps]);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      const result = await loadUpdates();
      if (!cancelled) setUpdates(result);
    }

    void refresh();
    const timer = window.setInterval(() => void refresh(), UPDATE_CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  async function runUpdate(moduleId: string) {
    setBusy(moduleId);
    setMessage(null);
    try {
      const response = await fetch(`http://127.0.0.1:${STORE_PORT}/update/${moduleId}`, {
        method: "POST",
        signal: AbortSignal.timeout(120_000),
      });
      const body = (await response.json()) as { updated?: boolean; version?: string; error?: string };
      if (!response.ok) {
        setMessage(`Update failed: ${body.error ?? response.status}`);
      } else {
        setMessage(body.updated ? `${moduleId} updated to ${body.version}.` : `${moduleId} is already up to date.`);
      }
    } catch (error) {
      setMessage(`Update failed: ${String(error)}`);
    } finally {
      setBusy(null);
      setUpdates(await loadUpdates());
    }
  }

  async function runUndo(moduleId: string) {
    setBusy(moduleId);
    setMessage(null);
    try {
      const response = await fetch(`http://127.0.0.1:${STORE_PORT}/undo/${moduleId}`, {
        method: "POST",
        signal: AbortSignal.timeout(120_000),
      });
      const body = (await response.json()) as { version?: string; error?: string };
      setMessage(
        response.ok ? `${moduleId} is back on ${body.version}.` : `Undo failed: ${body.error ?? response.status}`,
      );
    } catch (error) {
      setMessage(`Undo failed: ${String(error)}`);
    } finally {
      setBusy(null);
      setUpdates(await loadUpdates());
    }
  }

  if (modules.length === 0) {
    return <p className="module-store__empty">No modules are registered.</p>;
  }

  return (
    <div style={{ padding: 8 }}>
      {updates === null ? (
        <p style={{ opacity: 0.7, margin: "0 0 8px" }}>Update check unavailable. Is the module store service running?</p>
      ) : null}
      {message ? <p style={{ margin: "0 0 8px" }}>{message}</p> : null}

      <ul className="module-store__list" style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {modules.map((module) => {
          const kind = kindOf(module.moduleId, apps);
          const app = apps?.find((entry) => entry.id === module.moduleId);
          const status: Health = kind === "service" ? (health[module.moduleId] ?? "unknown") : "unknown";
          const info = kind === "service" ? updates?.[module.moduleId] : undefined;
          const isOpen = openId === module.moduleId;

          return (
            <li key={module.moduleId} className="module-store__row" style={{ padding: "8px 4px", borderBottom: "1px solid #8884" }}>
              <button
                type="button"
                onClick={() => setOpenId(isOpen ? null : module.moduleId)}
                style={{ all: "unset", cursor: "pointer", display: "flex", gap: 8, alignItems: "center", width: "100%" }}
              >
                {kind === "service" ? (
                  <span
                    aria-label={LABEL[status]}
                    title={LABEL[status]}
                    style={{ width: 10, height: 10, borderRadius: 5, background: DOT[status], flex: "0 0 auto" }}
                  />
                ) : (
                  <span
                    style={{
                      flex: "0 0 auto",
                      fontSize: "0.75em",
                      padding: "1px 6px",
                      borderRadius: 4,
                      color: "#fff",
                      background: BADGE[kind].color,
                    }}
                  >
                    {BADGE[kind].text}
                  </span>
                )}
                <strong>{module.moduleId}</strong>
                <span style={{ opacity: 0.7 }}>version {module.version}</span>
                {info?.updateAvailable ? (
                  <span style={{ fontSize: "0.75em", padding: "1px 6px", borderRadius: 4, color: "#fff", background: "#b7791f" }}>
                    Update
                  </span>
                ) : null}
                <span style={{ marginLeft: "auto", opacity: 0.6 }}>{isOpen ? "▲" : "More ▼"}</span>
              </button>

              {isOpen && (
                <div className="module-store__details" style={{ marginTop: 6, marginLeft: 18, fontSize: "0.9em" }}>
                  <div>Panels: {module.registeredPanelTypes.join(", ") || "none"}</div>
                  {kind === "service" && (
                    <div>Status: {LABEL[status]} (port {app?.port})</div>
                  )}
                  {kind === "service" && info && (
                    <div style={{ marginTop: 4 }}>
                      {info.updateAvailable ? (
                        <>
                          Update available: {info.version} → {info.latest}{" "}
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => void runUpdate(module.moduleId)}
                          >
                            {busy === module.moduleId ? "Updating…" : "Update"}
                          </button>
                        </>
                      ) : (
                        <>Up to date ({info.version})</>
                      )}
                      {info.canUndo && (
                        <button
                          type="button"
                          style={{ marginLeft: 8 }}
                          disabled={busy !== null}
                          onClick={() => void runUndo(module.moduleId)}
                        >
                          {busy === module.moduleId ? "Working…" : "Undo last update"}
                        </button>
                      )}
                    </div>
                  )}
                  {kind === "web" && (
                    <div>
                      Web app: <a href={app?.ui} target="_blank" rel="noreferrer">{app?.ui}</a>
                    </div>
                  )}
                  {kind === "builtin" && <div>Built into Jarri. No service to check.</div>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
