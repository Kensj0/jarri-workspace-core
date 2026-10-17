import { createId, nowIso } from "./id";
import { geometryFromPanelDefinition } from "./layoutEngine";
import type { PanelRegistry } from "./panelRegistry";
import type { PanelInstance, WorkspaceState } from "./types";
import {
  DEFAULT_PANEL_RADIUS,
  DEFAULT_WORKSPACE_CANVAS_BOUNDS,
  DEFAULT_WORKSPACE_SYSTEM_SURFACE_POSITIONS,
} from "./types";
import { WORKSPACE_SCHEMA_VERSION } from "./types";

export function createDefaultWorkspace(registry: PanelRegistry): WorkspaceState {
  const now = nowIso();
  const definitions = [
    registry.getPanel("demo", "truth"),
    registry.getPanel("demo", "timeline"),
    registry.getPanel("demo", "advisory-log"),
  ].filter((definition) => definition !== null);

  const panels = definitions.map((definition, index): PanelInstance => ({
    id: createId("panel"),
    moduleId: definition.moduleId,
    panelType: definition.panelType,
    title: definition.title,
    geometry: geometryFromPanelDefinition(definition),
    focusOrder: index + 1,
    stateVersion: definition.stateVersion,
    panelState: definition.createInitialState({ now }),
    createdAt: now,
    updatedAt: now,
  }));

  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    workspaceId: "default",
    activeTabId: "home",
    tabs: [
      {
        id: "home",
        title: "Core Demo",
        canvasBounds: { ...DEFAULT_WORKSPACE_CANVAS_BOUNDS },
        canvasScale: 1,
        canvasCamera: {
          x: DEFAULT_WORKSPACE_CANVAS_BOUNDS.x,
          y: DEFAULT_WORKSPACE_CANVAS_BOUNDS.y,
        },
        panels,
        createdAt: now,
        updatedAt: now,
      },
    ],
    surfacePresentationMemory: {},
    preferences: {
      scale: 1,
      fontSize: 14,
      showGrid: true,
      gridSize: 12,
      panelSpacing: 0,
      workspaceZoomIncrement: 10,
      workspaceZoomAnchorMode: "active-panel-center",
      panelNavigationAlignment: "panel-center",
      systemSurfacePositions: {
        settings: { ...DEFAULT_WORKSPACE_SYSTEM_SURFACE_POSITIONS.settings },
        addPanel: { ...DEFAULT_WORKSPACE_SYSTEM_SURFACE_POSITIONS.addPanel },
        frameSettings: { ...DEFAULT_WORKSPACE_SYSTEM_SURFACE_POSITIONS.frameSettings },
      },
      clock: {
        enabled: true,
        timeFormat: "24h",
        dateFormat: "text",
      },
      density: "compact",
      themeMode: "system",
      fontFamily: "system",
      themePreset: "neutral",
      colorOverrides: {},
      panelRadius: DEFAULT_PANEL_RADIUS,
      panelMenu: {
        moduleOrder: ["core", "demo"],
        hiddenModuleIds: [],
        panelSort: "registered",
        expandedModuleIds: ["core", "demo"],
      },
      frameControls: {
        visibility: {},
      },
      panelViews: {},
    },
    registryVersion: "runtime-v1",
  };
}
