import type {
  PanelBodyProps,
  PanelDefinition,
  PersistedModuleRecord,
  WorkspaceModuleDefinition,
} from "../../core/types";
import { panelSummarySemantic } from "../../core/panelSemantics";
import { ModuleStorePanel } from "./panels/ModuleStorePanel";

// The module store is an app of its own. The header button in Workspace Core
// only opens this panel. The module list is passed in as a function, so this
// module does not import the bootstrap.
export function createModuleStoreModule(
  getModules: () => PersistedModuleRecord[],
): WorkspaceModuleDefinition {
  const panel: PanelDefinition = {
    moduleId: "modules",
    panelType: "store",
    title: "Modules",
    description: "Installed Workspace modules and their versions.",
    category: "domain",
    defaultGeometry: { x: 260, y: 160, width: 520, height: 480 },
    minGeometry: { width: 320, height: 240 },
    stateVersion: 1,
    capabilities: {
      closable: true,
      resizable: true,
      movable: true,
      renameable: false,
      canBeDirty: false,
    },
    createInitialState: () => ({}),
    normalizeState: () => ({ state: {}, repaired: false, warnings: [] }),
    semanticStrategy: panelSummarySemantic(
      "Ready",
      "Installed modules and versions are listed in this panel.",
    ),
    surfacePresentationMemory: {},
    Component: (props: PanelBodyProps) => (
      <ModuleStorePanel getModules={getModules} openPanel={props.openPanel} />
    ),
  };

  return {
    moduleId: "modules",
    title: "Modules",
    version: "0.1.0",
    panels: [panel],
  };
}
