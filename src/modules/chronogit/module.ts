import type {
  PanelDefinition,
  WorkspaceModuleDefinition,
} from "../../core/types";
import { staticSemantic } from "../../core/panelSemantics";
import { ChronoGitPanel } from "./panels/ChronoGitPanel";

const panel: PanelDefinition = {
  moduleId: "chronogit",
  panelType: "chronogit-launcher",
  title: "ChronoGit",
  description: "Starts the ChronoGit Git workspace as its own app.",
  category: "domain",

  defaultGeometry: {
    x: 280,
    y: 200,
    width: 360,
    height: 220,
  },

  minGeometry: {
    width: 280,
    height: 180,
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
    kind: "chronogit-launcher",
    summary: "Starts ChronoGit as a separate desktop app.",
    sections: [],
  })),

  Component: ChronoGitPanel,
};

export const chronogitModule: WorkspaceModuleDefinition = {
  moduleId: "chronogit",
  title: "ChronoGit",
  version: "0.1.0",
  panels: [panel],
};
