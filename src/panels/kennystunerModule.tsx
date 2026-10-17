import { panelSummarySemantic } from "../core/panelSemantics";
import type { PanelDefinition, WorkspaceModuleDefinition } from "../core/types";

// Kenny's Tuner is its own web app (kennystuner.netlify.app, github.com/Kensj0/kennystuner).
// This panel only shows it. The tuning logic lives in that app.
const KENNYSTUNER_URL = "https://kennystuner.netlify.app/";

function KennystunerPanel() {
  return (
    <iframe
      src={KENNYSTUNER_URL}
      title="Kenny's Tuner"
      allow="microphone"
      style={{ width: "100%", height: "100%", border: 0 }}
    />
  );
}

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
  createInitialState: () => ({}),
  normalizeState: () => ({
    state: {},
    repaired: false,
    warnings: [],
  }),
  semanticStrategy: panelSummarySemantic(
    "Ready",
    "Instrument tuner shown from its own web app.",
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
