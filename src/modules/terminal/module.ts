import type {
  PanelDefinition,
  WorkspaceModuleDefinition,
} from "../../core/types";
import { staticSemantic } from "../../core/panelSemantics";
import { TerminalPanel } from "./panels/TerminalPanel";

const panel: PanelDefinition = {
  moduleId: "terminal",
  panelType: "shell",
  title: "Terminal",
  description: "Native Linux PTY terminal.",
  category: "domain",

  defaultGeometry: {
    x: 200,
    y: 140,
    width: 1060,
    height: 700,
  },

  minGeometry: {
    width: 400,
    height: 250,
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

  normalizeState: (input) => {
    const launch = (input ?? {}) as { cwd?: unknown; command?: unknown };
    const state: { cwd?: string; command?: string[] } = {};
    if (typeof launch.cwd === "string") state.cwd = launch.cwd;
    if (
      Array.isArray(launch.command) &&
      launch.command.length > 0 &&
      launch.command.every((arg) => typeof arg === "string")
    ) {
      state.command = launch.command;
    }
    return { state, repaired: false, warnings: [] };
  },

  semanticStrategy: staticSemantic(() => ({
    kind: "native-terminal",
    summary: "Interactive local Linux PTY shell.",
    sections: [],
  })),

  Component: TerminalPanel,
};

export const terminalModule: WorkspaceModuleDefinition = {
  moduleId: "terminal",
  title: "Terminal",
  version: "0.1.0",
  panels: [panel],
};
