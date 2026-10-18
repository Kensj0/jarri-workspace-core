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
  up: "Tjänsten körs",
  down: "Tjänsten ligger nere",
  unknown: "Ingen tjänst",
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
    return <p className="module-store__empty">Inga moduler är registrerade.</p>;
  }

  return (
    <ul className="module-store__list" style={{ listStyle: "none", padding: 8, margin: 0 }}>
      {modules.map((module) => {
        const hasService = module.moduleId in SERVICE_PORTS;
        const status: Health = hasService ? (health[module.moduleId] ?? "unknown") : "unknown";
        const isOpen = openId === module.moduleId;

        return (
          <li key={module.moduleId} className="module-store__row" style={{ padding: "8px 4px", borderBottom: "1px solid #8884" }}>
            <button
              type="button"
              onClick={() => setOpenId(isOpen ? null : module.moduleId)}
              style={{ all: "unset", cursor: "pointer", display: "flex", gap: 8, alignItems: "center", width: "100%" }}
            >
              <span
                aria-label={LABEL[status]}
                title={LABEL[status]}
                style={{ width: 10, height: 10, borderRadius: 5, background: DOT[status], flex: "0 0 auto" }}
              />
              <strong>{module.moduleId}</strong>
              <span style={{ opacity: 0.7 }}>version {module.version}</span>
              <span style={{ marginLeft: "auto", opacity: 0.6 }}>{isOpen ? "▲" : "Mer ▼"}</span>
            </button>

            {isOpen && (
              <div className="module-store__details" style={{ marginTop: 6, marginLeft: 18, fontSize: "0.9em" }}>
                <div>Paneler: {module.registeredPanelTypes.join(", ") || "inga"}</div>
                <div>Status: {LABEL[status]}{hasService ? ` (port ${SERVICE_PORTS[module.moduleId]})` : ""}</div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
