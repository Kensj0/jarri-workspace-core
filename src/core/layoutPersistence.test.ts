import {
  createLayoutPersistence,
  type LayoutStorageProvider,
} from "./layoutPersistence";
import { normalizeGeometry } from "./layoutEngine";
import { createPanelRegistry } from "./panelRegistry";
import type {
  PersistedWorkspaceDocument,
  WorkspaceState,
} from "./types";
import { WORKSPACE_SCHEMA_VERSION } from "./types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(
      `${message}: expected ${String(expected)}, got ${String(actual)}`,
    );
  }
}

function createDefaultWorkspace(): WorkspaceState {
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    workspaceId: "default",
    activeTabId: "home",
    tabs: [
      {
        id: "home",
        title: "Core Demo",
        canvasBounds: {
          x: 0,
          y: 0,
          width: 1800,
          height: 1100,
        },
        canvasScale: 1,
        canvasCamera: {
          x: 0,
          y: 0,
        },
        panels: [],
        createdAt: "2026-08-19T00:00:00.000Z",
        updatedAt: "2026-08-19T00:00:00.000Z",
      },
    ],
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
        settings: { x: 924, y: 408 },
        addPanel: { x: 16, y: 100 },
        frameSettings: { x: 16, y: 100 },
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
    surfacePresentationMemory: {},
    registryVersion: "runtime-v1",
  };
}

function createStorage(
  workspace: Record<string, unknown>,
): LayoutStorageProvider {
  const document = {
    kind: "jarri.workspace.layout",
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    savedAt: "2026-08-19T00:00:00.000Z",
    workspace,
    modules: [],
  } as unknown as PersistedWorkspaceDocument;

  return {
    load: () => document,
    save: () => {},
    remove: () => {},
  };
}

function load(workspace: Record<string, unknown>) {
  const registry = createPanelRegistry();

  const persistence = createLayoutPersistence({
    registry,
    storageProvider: createStorage(workspace),
    defaultWorkspaceFactory: createDefaultWorkspace,
    getModuleRecords: () => [],
  });

  return persistence.loadWorkspace();
}

function basePersistedWorkspace(): Record<string, unknown> {
  const workspace = createDefaultWorkspace();

  return {
    ...workspace,
    tabs: workspace.tabs,
    preferences: workspace.preferences,
  };
}

function testLegacyWorkspaceGetsEmptyPresentationMemory() {
  const legacy = basePersistedWorkspace();
  delete legacy.surfacePresentationMemory;

  const result = load(legacy);

  assertEqual(
    Object.keys(result.state.surfacePresentationMemory).length,
    0,
    "legacy workspace receives empty presentation memory",
  );

  assertEqual(
    result.state.schemaVersion,
    WORKSPACE_SCHEMA_VERSION,
    "legacy workspace normalizes to current schema",
  );
}

function testValidPresentationMemorySurvivesNormalization() {
  const persisted = basePersistedWorkspace();

  persisted.surfacePresentationMemory = {
    "panel:core:settings": {
      kind: "panel",
      moduleId: "core",
      panelType: "settings",
      geometry: {
        x: 410,
        y: 275,
        width: 860,
        height: 690,
        minWidth: 360,
        minHeight: 336,
      },
      updatedAt: "2026-08-19T12:00:00.000Z",
    },
  };

  /*
   * Presentation memory is only valid for registered panel definitions.
   * Register the smallest definition necessary to establish ownership.
   */
  const registry = createPanelRegistry();

  registry.registerPanel({
    moduleId: "core",
    panelType: "settings",
    title: "Settings",
    description: "Test Settings panel.",
    category: "core",
    defaultGeometry: {
      x: 924,
      y: 408,
      width: 1020,
      height: 540,
    },
    minGeometry: {
      width: 360,
      height: 336,
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
    semanticStrategy: {
      kind: "pending",
      reason: "Persistence contract test.",
    },
    surfacePresentationMemory: {},
    Component: () => null,
  });

  const persistence = createLayoutPersistence({
    registry,
    storageProvider: createStorage(persisted),
    defaultWorkspaceFactory: createDefaultWorkspace,
    getModuleRecords: () => [],
  });

  const result = persistence.loadWorkspace();
  const remembered =
    result.state.surfacePresentationMemory["panel:core:settings"];

  assert(remembered !== undefined, "valid Settings memory should survive");
  assertEqual(remembered.kind, "panel", "remembered surface kind");

  if (remembered.kind !== "panel") {
    throw new Error("remembered Settings surface is not panel memory");
  }

  assert(remembered.geometry !== undefined, "remembered geometry should survive");

  const expectedGeometry = normalizeGeometry(
    {
      x: 410,
      y: 275,
      width: 860,
      height: 690,
      minWidth: 360,
      minHeight: 336,
    },
    {
      x: 924,
      y: 408,
      width: 1020,
      height: 540,
      minWidth: 360,
      minHeight: 336,
    },
  );

  assertEqual(remembered.geometry.x, expectedGeometry.x, "remembered x");
  assertEqual(remembered.geometry.y, expectedGeometry.y, "remembered y");
  assertEqual(
    remembered.geometry.width,
    expectedGeometry.width,
    "remembered width",
  );
  assertEqual(
    remembered.geometry.height,
    expectedGeometry.height,
    "remembered height",
  );
}

function testPinkSparkleThemePresetSurvivesNormalization() {
  const persisted = basePersistedWorkspace();
  const preferences = persisted.preferences as Record<string, unknown>;

  preferences.themePreset = "pink-sparkle";

  const result = load(persisted);

  assertEqual(
    result.state.preferences.themePreset,
    "pink-sparkle",
    "pink-sparkle theme preset survives normalization",
  );

  preferences.themePreset = "chronogit";
  assertEqual(
    load(persisted).state.preferences.themePreset,
    "chronogit",
    "chronogit theme preset survives normalization",
  );
}

function testUnknownThemePresetRepairsToNeutral() {
  const persisted = basePersistedWorkspace();
  const preferences = persisted.preferences as Record<string, unknown>;

  preferences.themePreset = "future-theme-that-does-not-exist";

  const result = load(persisted);

  assertEqual(
    result.state.preferences.themePreset,
    "neutral",
    "unknown theme preset repairs to neutral",
  );
}

function testSchemaTwoCoreLayoutReceivesGenericCameraDefaults() {
  const persisted = basePersistedWorkspace();
  const tab = (persisted.tabs as Array<Record<string, unknown>>)[0];
  const preferences = persisted.preferences as Record<string, unknown>;

  tab.canvasBounds = {
    width: 1800,
    height: 1100,
  };
  delete tab.canvasScale;
  delete preferences.gridSize;
  delete preferences.workspaceZoomIncrement;
  delete preferences.workspaceZoomAnchorMode;
  delete preferences.panelNavigationAlignment;

  const result = load(persisted);
  const normalizedTab = result.state.tabs[0];

  assertEqual(
    result.state.schemaVersion,
    WORKSPACE_SCHEMA_VERSION,
    "schema-2 additive camera repair keeps current schema",
  );
  assertEqual(normalizedTab.canvasBounds.x, 0, "missing canvas x defaults to 0");
  assertEqual(normalizedTab.canvasBounds.y, 0, "missing canvas y defaults to 0");
  assertEqual(normalizedTab.canvasScale, 1, "missing canvasScale defaults to 1");
  assertEqual(normalizedTab.canvasCamera.x, 0, "missing camera x defaults to canvas x");
  assertEqual(normalizedTab.canvasCamera.y, 0, "missing camera y defaults to canvas y");
  assertEqual(result.state.preferences.gridSize, 12, "missing grid size default");
  assertEqual(
    result.state.preferences.workspaceZoomIncrement,
    10,
    "missing zoom increment default",
  );
  assertEqual(
    result.state.preferences.workspaceZoomAnchorMode,
    "active-panel-center",
    "missing zoom anchor default",
  );
  assertEqual(
    result.state.preferences.panelNavigationAlignment,
    "panel-center",
    "missing navigation alignment default",
  );
}

function testInvalidGenericCameraValuesRepairDeterministically() {
  const persisted = basePersistedWorkspace();
  const tab = (persisted.tabs as Array<Record<string, unknown>>)[0];
  const preferences = persisted.preferences as Record<string, unknown>;

  tab.canvasBounds = {
    x: Number.NaN,
    y: Number.POSITIVE_INFINITY,
    width: 120,
    height: "large",
  };
  tab.canvasScale = Number.NEGATIVE_INFINITY;
  tab.canvasCamera = {
    x: Number.NaN,
    y: "far down",
  };
  preferences.gridSize = Number.NaN;
  preferences.workspaceZoomIncrement = "large";
  preferences.workspaceZoomAnchorMode = "future-anchor";
  preferences.panelNavigationAlignment = "future-alignment";
  preferences.panelViews = {
    "demo:truth": {
      fontScale: 1.5,
    },
    "bad key": {
      fontScale: 1.75,
    },
  };

  const result = load(persisted);
  const normalizedTab = result.state.tabs[0];

  assertEqual(normalizedTab.canvasBounds.x, 0, "invalid canvas x repairs to 0");
  assertEqual(normalizedTab.canvasBounds.y, 0, "invalid canvas y repairs to 0");
  assertEqual(
    normalizedTab.canvasBounds.width,
    900,
    "invalid/small canvas width repairs to minimum",
  );
  assertEqual(
    normalizedTab.canvasBounds.height,
    1100,
    "invalid canvas height repairs to fallback",
  );
  assertEqual(normalizedTab.canvasScale, 1, "invalid canvasScale repairs to 1");
  assertEqual(normalizedTab.canvasCamera.x, 0, "invalid camera x repairs to canvas x");
  assertEqual(normalizedTab.canvasCamera.y, 0, "invalid camera y repairs to canvas y");
  assertEqual(result.state.preferences.gridSize, 12, "invalid grid size repairs");
  assertEqual(
    result.state.preferences.workspaceZoomIncrement,
    10,
    "invalid zoom increment repairs",
  );
  assertEqual(
    result.state.preferences.workspaceZoomAnchorMode,
    "active-panel-center",
    "unknown zoom anchor repairs",
  );
  assertEqual(
    result.state.preferences.panelNavigationAlignment,
    "panel-center",
    "unknown navigation alignment repairs",
  );
  assertEqual(
    result.state.preferences.panelViews["demo:truth"]?.fontScale,
    1.5,
    "valid panelViews entry survives camera repairs",
  );
  assert(
    result.state.preferences.panelViews["bad key"] === undefined,
    "invalid panelViews key remains discarded",
  );
}

function testCanvasBoundsPreserveNegativeOriginAndExpandAroundPanels() {
  const persisted = basePersistedWorkspace();
  const tab = (persisted.tabs as Array<Record<string, unknown>>)[0];

  tab.canvasBounds = {
    x: -240,
    y: -120,
    width: 1800,
    height: 1100,
  };
  delete tab.canvasCamera;
  tab.panels = [
    {
      id: "far-positive-panel",
      moduleId: "missing",
      panelType: "missing",
      title: "Far Positive Panel",
      geometry: {
        x: 1900,
        y: 1200,
        width: 300,
        height: 200,
      },
      focusOrder: 1,
      stateVersion: 1,
      panelState: {},
      createdAt: "2026-08-19T00:00:00.000Z",
      updatedAt: "2026-08-19T00:00:00.000Z",
    },
  ];

  const result = load(persisted);
  const normalizedTab = result.state.tabs[0];

  assertEqual(normalizedTab.canvasBounds.x, -240, "canvas preserves negative x origin");
  assertEqual(normalizedTab.canvasBounds.y, -120, "canvas preserves negative y origin");
  assertEqual(
    normalizedTab.canvasCamera.x,
    -240,
    "missing camera x defaults to negative canvas origin",
  );
  assertEqual(
    normalizedTab.canvasCamera.y,
    -120,
    "missing camera y defaults to negative canvas origin",
  );
  assertEqual(
    normalizedTab.canvasBounds.width,
    2484,
    "canvas width expands from negative origin around right panel extent",
  );
  assertEqual(
    normalizedTab.canvasBounds.height,
    1572,
    "canvas height expands from negative origin around bottom panel extent",
  );
}

function testCanvasCameraSurvivesNormalizationPerTab() {
  const persisted = basePersistedWorkspace();
  const baseTab = (persisted.tabs as Array<Record<string, unknown>>)[0];

  persisted.tabs = [
    {
      ...baseTab,
      id: "tab-a",
      canvasCamera: {
        x: -144,
        y: 288,
      },
    },
    {
      ...baseTab,
      id: "tab-b",
      canvasCamera: {
        x: 960,
        y: -72,
      },
      canvasScale: 1.5,
    },
  ];

  const result = load(persisted);
  const [tabA, tabB] = result.state.tabs;

  assertEqual(tabA.canvasCamera.x, -144, "tab A camera x survives");
  assertEqual(tabA.canvasCamera.y, 288, "tab A camera y survives");
  assertEqual(tabB.canvasCamera.x, 960, "tab B camera x survives");
  assertEqual(tabB.canvasCamera.y, -72, "tab B camera y survives");
  assertEqual(tabB.canvasScale, 1.5, "tab B zoom remains tab-local");
  assertEqual(
    result.state.preferences.scale,
    1,
    "global presentation scale remains independent",
  );
}

function testOrganizeSnapshotSurvivesNormalization() {
  const persisted = basePersistedWorkspace();
  const baseTab = (persisted.tabs as Array<Record<string, unknown>>)[0];

  persisted.tabs = [
    {
      ...baseTab,
      id: "tab-organized",
      organizeSnapshot: {
        canvasBounds: { x: -240, y: 0, width: 7728, height: 3384 },
        canvasScale: 0.5,
        canvasCamera: { x: 120, y: 48 },
        geometries: {
          "panel-a": { x: 48, y: 48, width: 420, height: 240, minWidth: 324, minHeight: 180 },
          "panel-broken": { x: "nope", y: 0, width: 10, height: 10 },
        },
      },
    },
  ];

  const result = load(persisted);
  const snapshot = result.state.tabs[0].organizeSnapshot;

  assert(snapshot, "organize snapshot survives normalization");
  assertEqual(snapshot.canvasScale, 0.5, "snapshot zoom survives");
  assertEqual(snapshot.canvasCamera.x, 120, "snapshot camera x survives");
  assertEqual(snapshot.canvasBounds.width, 7728, "snapshot canvas width survives");
  assertEqual(snapshot.geometries["panel-a"].minWidth, 324, "snapshot keeps min width");
  assertEqual(snapshot.geometries["panel-a"].minHeight, 180, "snapshot keeps min height");
  assert(!("panel-broken" in snapshot.geometries), "invalid snapshot geometry is dropped");
}

function testPanelMenuExpandedModulesNormalizeDeterministically() {
  const workspace = basePersistedWorkspace();
  const preferences = workspace.preferences as WorkspaceState["preferences"];
  preferences.panelMenu = {
    moduleOrder: ["demo", "core", "demo"],
    hiddenModuleIds: ["unused", "unused"],
    panelSort: "title",
    expandedModuleIds: ["demo", "core", 42, "demo"],
  } as unknown as WorkspaceState["preferences"]["panelMenu"];

  const panelMenu = load(workspace).state.preferences.panelMenu;

  assertEqual(
    panelMenu.moduleOrder.join(","),
    "demo,core",
    "Panel menu module order preserves unique string entries",
  );
  assertEqual(
    panelMenu.hiddenModuleIds.join(","),
    "unused",
    "Panel menu hidden modules preserve unique string entries",
  );
  assertEqual(
    panelMenu.panelSort,
    "title",
    "Panel menu sort survives expandedModuleIds normalization",
  );
  assertEqual(
    panelMenu.expandedModuleIds.join(","),
    "demo,core",
    "Expanded module ids preserve strings and discard malformed entries",
  );

  const missingExpanded = basePersistedWorkspace();
  delete (
    (missingExpanded.preferences as WorkspaceState["preferences"]).panelMenu as {
      expandedModuleIds?: unknown;
    }
  ).expandedModuleIds;

  assertEqual(
    load(missingExpanded).state.preferences.panelMenu.expandedModuleIds.join(","),
    "core,demo",
    "Missing expandedModuleIds defaults to discoverable Core and demo modules",
  );
}

function main() {
  testLegacyWorkspaceGetsEmptyPresentationMemory();
  testValidPresentationMemorySurvivesNormalization();
  testPinkSparkleThemePresetSurvivesNormalization();
  testUnknownThemePresetRepairsToNeutral();
  testSchemaTwoCoreLayoutReceivesGenericCameraDefaults();
  testInvalidGenericCameraValuesRepairDeterministically();
  testCanvasBoundsPreserveNegativeOriginAndExpandAroundPanels();
  testCanvasCameraSurvivesNormalizationPerTab();
  testOrganizeSnapshotSurvivesNormalization();
  testPanelMenuExpandedModulesNormalizeDeterministically();
  console.log("layout persistence tests passed");
}

main();
