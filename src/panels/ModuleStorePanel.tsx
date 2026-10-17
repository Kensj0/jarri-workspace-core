import type { PanelBodyProps } from "../core/types";

// Lists the modules compiled into this Workspace build. Installing or
// switching modules off comes later; this panel only shows what is there.
export function ModuleStorePanel({ modules }: PanelBodyProps) {
  if (modules.length === 0) {
    return <p className="module-store__empty">Inga moduler är registrerade.</p>;
  }

  return (
    <ul className="module-store__list">
      {modules.map((module) => (
        <li key={module.moduleId} className="module-store__row">
          <strong>{module.title}</strong>
          <span className="module-store__meta">
            {module.moduleId} · version {module.version}
          </span>
        </li>
      ))}
    </ul>
  );
}
