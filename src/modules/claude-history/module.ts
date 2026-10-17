import type {
  PanelDefinition,
  WorkspaceModuleDefinition,
} from "../../core/types";
import { staticSemantic } from "../../core/panelSemantics";
import { ClaudeHistoryPanel } from "./panels/ClaudeHistoryPanel";

const panel: PanelDefinition = {
  moduleId: "claude-history",
  panelType: "claude-history",
  title: "Claude-historik",
  description: "Tidigare Claude Code-chattar. Öppnar en chatt i en ny terminal.",
  category: "domain",

  defaultGeometry: {
    x: 240,
    y: 180,
    width: 460,
    height: 620,
  },

  minGeometry: {
    width: 320,
    height: 300,
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
    kind: "claude-history",
    summary: "Earlier Claude Code sessions from the local history.",
    sections: [],
  })),

  Component: ClaudeHistoryPanel,
};

export const claudeHistoryModule: WorkspaceModuleDefinition = {
  moduleId: "claude-history",
  title: "Claude-historik",
  version: "0.1.0",
  panels: [panel],
};
