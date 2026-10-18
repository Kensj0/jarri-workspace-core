import type {
  PanelDefinition,
  WorkspaceModuleDefinition,
} from "../../core/types";
import { panelSummarySemantic } from "../../core/panelSemantics";
import { AppViewPanel } from "./panels/AppViewPanel";

// One generic panel that shows any app from apps.json. Which app it shows is
// stored in the panel state as appId.
const panel: PanelDefinition = {
  moduleId: "app-view",
  panelType: "app",
  title: "App",
  description: "Shows the page of an app from the app list.",
  category: "domain",
  defaultGeometry: { x: 300, y: 180, width: 720, height: 520 },
  minGeometry: { width: 360, height: 260 },
  stateVersion: 1,
  capabilities: {
    closable: true,
    resizable: true,
    movable: true,
    renameable: false,
    canBeDirty: false,
  },
  createInitialState: () => ({}),
  normalizeState: (input) => {
    const appId = (input as { appId?: unknown } | undefined)?.appId;
    return {
      state: typeof appId === "string" ? { appId } : {},
      repaired: false,
      warnings: [],
    };
  },
  semanticStrategy: panelSummarySemantic("Ready", "Shows an app from the app list."),
  surfacePresentationMemory: {},
  Component: AppViewPanel,
};

export const appViewModule: WorkspaceModuleDefinition = {
  moduleId: "app-view",
  title: "App",
  version: "0.1.0",
  panels: [panel],
};
