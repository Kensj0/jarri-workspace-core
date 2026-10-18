import type {
  PanelDefinition,
  WorkspaceModuleDefinition,
} from "../../core/types";
import { staticSemantic } from "../../core/panelSemantics";
import { BrowserPanelHost } from "./panels/BrowserPanel";

// The browser service in jarri-apps does the work. This panel shows it and presses its buttons.
const panel: PanelDefinition = {
  moduleId: "browser",
  panelType: "browser",
  title: "Claude i Brave",
  description: "Vad Claude gör i Brave, med paus, stopp och godkännanden.",
  category: "domain",

  defaultGeometry: {
    x: 260,
    y: 200,
    width: 420,
    height: 560,
  },

  minGeometry: {
    width: 300,
    height: 320,
  },

  stateVersion: 1,

  capabilities: {
    closable: true,
    resizable: true,
    movable: true,
    renameable: false,
    canBeDirty: false,
  },

  createInitialState: () => ({}),

  normalizeState: () => ({
    state: {},
    repaired: false,
    warnings: [],
  }),

  semanticStrategy: staticSemantic(() => ({
    kind: "browser",
    summary: "What Claude does in Brave, with pause, stop and approvals.",
    sections: [],
  })),

  Component: BrowserPanelHost,
};

export const browserModule: WorkspaceModuleDefinition = {
  moduleId: "browser",
  title: "Claude i Brave",
  version: "0.1.0",
  panels: [panel],
};
