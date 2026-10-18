import { useEffect, useState } from "react";
import type { PersistedModuleRecord } from "../../../core/types";

type Props = {
  getModules: () => PersistedModuleRecord[];
};

// Which module talks to which service in jarri-apps. Modules without a
// service are shown without a status dot.
const SERVICE_PORTS: Record<string, number> = {
  terminal: 8781,
  phone: 8782,
  "ai-usage": 8783,
  "claude-history": 8784,
};

// Web apps run outside this computer. They get their own label and a link.
const WEB_APPS: Record<string, string> = {
  kennystuner: "https://kennystuner.netlify.app/",
};

const CHECK_INTERVAL_MS = 15_000;

type Health = "up" | "down" | "unknown";

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

type Kind = "service" | "web" | "builtin";

function kindOf(moduleId: string): Kind {
  if (moduleId in SERVICE_PORTS) return "service";
  if (moduleId in WEB_APPS) return "web";
  return "builtin";
}

const BADGE: Record<Exclude<Kind, "service">, { text: string; color: string }> = {
  web: { text: "Web app", color: "#2f6fbf" },
  builtin: { text: "Built-in", color: "#7a6a4f" },
};

export function ModuleStorePanel({ getModules }: Props) {
  const modules = getModules();
  const [health, setHealth] = useState<Record<string, Health>>({});
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      const entries = await Promise.all(
        Object.entries(SERVICE_PORTS).map(async ([id, port]) => {
          return [id, await checkService(port)] as const;
        }),
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
  }, []);

  if (modules.length === 0) {
    return <p className="module-store__empty">No modules are registered.</p>;
  }

  return (
    <ul className="module-store__list" style={{ listStyle: "none", padding: 8, margin: 0 }}>
      {modules.map((module) => {
        const kind = kindOf(module.moduleId);
        const status: Health = kind === "service" ? (health[module.moduleId] ?? "unknown") : "unknown";
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
              <span style={{ marginLeft: "auto", opacity: 0.6 }}>{isOpen ? "▲" : "More ▼"}</span>
            </button>

            {isOpen && (
              <div className="module-store__details" style={{ marginTop: 6, marginLeft: 18, fontSize: "0.9em" }}>
                <div>Panels: {module.registeredPanelTypes.join(", ") || "none"}</div>
                {kind === "service" && (
                  <div>Status: {LABEL[status]} (port {SERVICE_PORTS[module.moduleId]})</div>
                )}
                {kind === "web" && (
                  <div>
                    Web app: <a href={WEB_APPS[module.moduleId]} target="_blank" rel="noreferrer">{WEB_APPS[module.moduleId]}</a>
                  </div>
                )}
                {kind === "builtin" && <div>Built into Jarri. No service to check.</div>}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
