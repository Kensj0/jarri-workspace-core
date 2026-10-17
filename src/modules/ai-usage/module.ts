import type {
  PanelDefinition,
  WorkspaceModuleDefinition,
} from "../../core/types";
import { staticSemantic } from "../../core/panelSemantics";
import { AiUsagePanel } from "./panels/AiUsagePanel";

const panel: PanelDefinition = {
  moduleId: "ai-usage",
  panelType: "ai-usage",
  title: "AI-förbrukning",
  description: "Claudes tokenförbrukning och kvot, från Claude Code-historiken.",
  category: "domain",

  defaultGeometry: {
    x: 260,
    y: 200,
    width: 420,
    height: 560,
  },

  minGeometry: {
    width: 300,
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
    kind: "ai-usage",
    summary: "Claude token usage and quota from the local Claude Code history.",
    sections: [],
  })),

  Component: AiUsagePanel,
};

export const aiUsageModule: WorkspaceModuleDefinition = {
  moduleId: "ai-usage",
  title: "AI-förbrukning",
  version: "0.1.0",
  panels: [panel],
};
