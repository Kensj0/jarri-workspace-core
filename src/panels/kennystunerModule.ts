import { panelSummarySemantic } from "../core/panelSemantics";
import type { PanelDefinition, WorkspaceModuleDefinition } from "../core/types";
import { KennystunerPanel, normalizeKennystunerState } from "./kennystuner/KennystunerPanel";

const kennystunerPanelDefinition: PanelDefinition = {
  moduleId: "kennystuner",
  panelType: "tuner",
  title: "Kenny's Tuner",
  description: "Instrument tuner with needle, spectrum view and lab settings.",
  category: "domain",
  defaultGeometry: { x: 120, y: 120, width: 420, height: 620 },
  minGeometry: { width: 340, height: 460 },
  stateVersion: 1,
  capabilities: {
    closable: true,
    resizable: true,
    movable: true,
    renameable: false,
    canBeDirty: false,
  },
  createInitialState: () => normalizeKennystunerState(undefined),
  normalizeState: (input) => {
    const state = normalizeKennystunerState(input);
    return {
      state,
      repaired: JSON.stringify(input) !== JSON.stringify(state),
      warnings: [],
    };
  },
  semanticStrategy: panelSummarySemantic(
    "Ready",
    "Instrument tuner. The needle and spectrum are live from the microphone.",
  ),
  surfacePresentationMemory: {},
  Component: KennystunerPanel,
};

export const kennystunerModule: WorkspaceModuleDefinition = {
  moduleId: "kennystuner",
  title: "Kenny's Tuner",
  version: "1.0.0",
  panels: [kennystunerPanelDefinition],
};
