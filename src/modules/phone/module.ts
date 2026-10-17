import type {
  PanelDefinition,
  WorkspaceModuleDefinition,
} from "../../core/types";
import { staticSemantic } from "../../core/panelSemantics";
import { PhonePanel } from "./panels/PhonePanel";

const panel: PanelDefinition = {
  moduleId: "phone",
  panelType: "zorin-connect",
  title: "Phone",
  description: "Phone control through Zorin Connect.",
  category: "domain",

  defaultGeometry: {
    x: 240,
    y: 180,
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
    kind: "zorin-connect",
    summary: "Phone control through the running Zorin Connect service.",
    sections: [],
  })),

  Component: PhonePanel,
};

export const phoneModule: WorkspaceModuleDefinition = {
  moduleId: "phone",
  title: "Phone",
  version: "0.1.0",
  panels: [panel],
};
