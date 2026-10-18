import type { PersistedModuleRecord } from "../../../core/types";

type Props = {
  getModules: () => PersistedModuleRecord[];
};

// Lists the modules in this Workspace build with their versions.
export function ModuleStorePanel({ getModules }: Props) {
  const modules = getModules();

  if (modules.length === 0) {
    return <p className="module-store__empty">Inga moduler är registrerade.</p>;
  }

  return (
    <ul className="module-store__list">
      {modules.map((module) => (
        <li key={module.moduleId} className="module-store__row">
          <strong>{module.moduleId}</strong>{" "}
          <span className="module-store__meta">
            version {module.version} · {module.registeredPanelTypes.length} paneler
          </span>
        </li>
      ))}
    </ul>
  );
}
