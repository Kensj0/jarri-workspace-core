import type {
  PanelDefinition,
  WorkspaceModuleDefinition,
} from "../../core/types";
import { staticSemantic } from "../../core/panelSemantics";
import { BrowserPanelHost } from "./panels/BrowserPanel";
import { BrowserViewHost } from "./panels/BrowserViewPanel";

// The browser service in jarri-apps does the work. This panel shows it and presses its buttons.
const panel: PanelDefinition = {
  moduleId: "browser",
  panelType: "browser",
  title: "Claude in Brave",
  description: "What Claude does in Brave, with pause, stop and approvals.",
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

// The view of Claude's Brave: the page, an address bar, and clicks and typing sent to Brave.
const viewPanel: PanelDefinition = {
  moduleId: "browser",
  panelType: "browser-view",
  title: "Brave",
  description: "Claude's Brave as a live picture, with an address bar. Clicks and typing go to Brave.",
  category: "domain",
  defaultGeometry: { x: 700, y: 200, width: 760, height: 620 },
  minGeometry: { width: 360, height: 300 },
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
  semanticStrategy: staticSemantic(() => ({
    kind: "browser-view",
    summary: "Claude's Brave, shown as a live picture.",
    sections: [],
  })),
  Component: BrowserViewHost,
};

export const browserModule: WorkspaceModuleDefinition = {
  moduleId: "browser",
  title: "Claude in Brave",
  version: "0.2.0",
  panels: [panel, viewPanel],
};
