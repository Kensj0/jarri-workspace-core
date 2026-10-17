import {
  DEFAULT_WORKSPACE_CANVAS_BOUNDS,
  DEFAULT_WORKSPACE_SYSTEM_SURFACE_POSITIONS,
  panelSurfacePresentationKey,
} from "./types";
import { createId, nowIso } from "./id";
import { normalizeFrameControlPreferences } from "./frameControls";
import { normalizeGeometry, repairFocusOrder } from "./layoutEngine";
import type { PanelRegistry } from "./panelRegistry";
import type {
  LayoutRepairReport,
  PanelGeometry,
  PanelInstance,
  PersistedModuleRecord,
  PersistedWorkspaceDocument,
  WorkspaceCanvasBounds,
  WorkspaceColorTokens,
  WorkspaceOrganizeSnapshot,
  WorkspacePanelViewPreferences,
  WorkspacePreferences,
  WorkspaceState,
  WorkspaceTab,
} from "./types";
import { WORKSPACE_SCHEMA_VERSION } from "./types";

const STORAGE_KEY = "jarri.workspace.core.layout.v1";
const LEGACY_STORAGE_KEYS: string[] = [];
const DOCUMENT_KIND = "jarri.workspace.layout";
const SAFE_PANEL_GEOMETRY: PanelGeometry = {
  x: 32,
  y: 32,
  width: 420,
  height: 260,
  minWidth: 280,
  minHeight: 180,
};

export type LayoutStorageProvider = {
  load: (workspaceId: string) => PersistedWorkspaceDocument | null;
  save: (workspaceId: string, document: PersistedWorkspaceDocument) => void;
  remove: (workspaceId: string) => void;
};

export type LayoutPersistence = {
  loadWorkspace: () => {
    state: WorkspaceState;
    report: LayoutRepairReport;
  };
  saveWorkspace: (state: WorkspaceState) => void;
  resetWorkspaceStorage: () => void;
};

type LayoutPersistenceDependencies = {
  registry: PanelRegistry;
  storageProvider?: LayoutStorageProvider;
  defaultWorkspaceFactory: () => WorkspaceState;
  getModuleRecords: () => PersistedModuleRecord[];
  workspaceId?: string;
};

export function createLocalStorageProvider(): LayoutStorageProvider {
  return {
    load() {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        return JSON.parse(raw) as PersistedWorkspaceDocument;
      }

      for (const legacyKey of LEGACY_STORAGE_KEYS) {
        const legacyRaw = window.localStorage.getItem(legacyKey);
        if (legacyRaw) {
          return JSON.parse(legacyRaw) as PersistedWorkspaceDocument;
        }
      }

      return null;
    },
    save(_workspaceId, document) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(document));
    },
    remove() {
      window.localStorage.removeItem(STORAGE_KEY);
    },
  };
}

export function createLayoutPersistence({
  registry,
  storageProvider = createLocalStorageProvider(),
  defaultWorkspaceFactory,
  getModuleRecords,
  workspaceId = "default",
}: LayoutPersistenceDependencies): LayoutPersistence {
  function normalizeWorkspace(input: unknown): {
    state: WorkspaceState;
    report: LayoutRepairReport;
  } {
    const warnings: string[] = [];

    if (!isRecord(input)) {
      return {
        state: defaultWorkspaceFactory(),
        report: {
          migrated: false,
          repaired: true,
          toSchemaVersion: WORKSPACE_SCHEMA_VERSION,
          warnings: ["Created default workspace because persisted state was missing."],
        },
      };
    }

    const fromSchemaVersion = finiteNumber(input.schemaVersion, 0);
    const rawPreferences = isRecord(input.preferences) ? input.preferences : {};
    const legacyCanvasBounds = normalizeCanvasBounds(rawPreferences.canvasBounds);
    const seenTabIds = new Set<string>();
    let tabs = Array.isArray(input.tabs)
      ? input.tabs.map((tab, index) =>
          normalizeTab(
            tab,
            index,
            seenTabIds,
            warnings,
            registry,
            legacyCanvasBounds,
          ),
        )
      : [];

    if (tabs.length === 0) {
      tabs = defaultWorkspaceFactory().tabs;
      warnings.push("Repaired empty tab list with default tab.");
    }

    const activeTabId =
      typeof input.activeTabId === "string" &&
      tabs.some((tab) => tab.id === input.activeTabId)
        ? input.activeTabId
        : tabs[0].id;

    if (activeTabId !== input.activeTabId) {
      warnings.push("Repaired invalid active tab id.");
    }

    return {
      state: {
        schemaVersion: WORKSPACE_SCHEMA_VERSION,
        workspaceId:
          typeof input.workspaceId === "string" && input.workspaceId.trim()
            ? input.workspaceId
            : workspaceId,
        activeTabId,
        tabs,
        preferences: normalizePreferences(input.preferences),
        surfacePresentationMemory: normalizeSurfacePresentationMemory(
          input.surfacePresentationMemory,
          warnings,
          registry,
        ),
        registryVersion:
          typeof input.registryVersion === "string" ? input.registryVersion : "runtime-v1",
      },
      report: {
        migrated: fromSchemaVersion !== WORKSPACE_SCHEMA_VERSION,
        repaired: warnings.length > 0,
        fromSchemaVersion,
        toSchemaVersion: WORKSPACE_SCHEMA_VERSION,
        warnings,
      },
    };
  }

  return {
    loadWorkspace() {
      try {
        const document = storageProvider.load(workspaceId);
        if (
          !document ||
          !isRecord(document) ||
          document.kind !== DOCUMENT_KIND ||
          !isRecord(document.workspace)
        ) {
          return normalizeWorkspace(null);
        }
        return normalizeWorkspace(document.workspace);
      } catch (error) {
        try {
          const raw = window.localStorage.getItem(STORAGE_KEY);
          if (raw) {
            const backupKey = `${STORAGE_KEY}.corrupted.${Date.now()}`;
            window.localStorage.setItem(backupKey, raw);
          }
          console.error("[workspace-persistence] Failed to load persisted workspace.", error);
        } catch (backupError) {
          console.error("[workspace-persistence] Failed to preserve corrupted workspace.", backupError);
        }

        return normalizeWorkspace(null);
      }
    },
    saveWorkspace(state) {
      const document: PersistedWorkspaceDocument = {
        kind: DOCUMENT_KIND,
        schemaVersion: WORKSPACE_SCHEMA_VERSION,
        savedAt: nowIso(),
        workspace: state,
        modules: getModuleRecords(),
      };

      storageProvider.save(workspaceId, document);
    },
    resetWorkspaceStorage() {
      storageProvider.remove(workspaceId);
    },
  };
}

function normalizePreferences(input: unknown): WorkspacePreferences {
  const raw = isRecord(input) ? input : {};
  const density = raw.density === "comfortable" ? "comfortable" : "compact";
  const themeMode =
    raw.themeMode === "light" || raw.themeMode === "dark" ? raw.themeMode : "system";
  const fontFamily =
    raw.fontFamily === "humanist" ||
    raw.fontFamily === "serif" ||
    raw.fontFamily === "mono" ||
    raw.fontFamily === "compact"
      ? raw.fontFamily
      : "system";
  const themePreset =
    raw.themePreset === "graphite" ||
    raw.themePreset === "contrast" ||
    raw.themePreset === "blueprint" ||
    raw.themePreset === "pink-sparkle" ||
    raw.themePreset === "chronogit"
      ? raw.themePreset
      : "neutral";

  return {
    scale: clamp(finiteNumber(raw.scale, 1), 0.75, 1.35),
    fontSize: clamp(finiteNumber(raw.fontSize, 14), 12, 18),
    showGrid: typeof raw.showGrid === "boolean" ? raw.showGrid : true,
    gridSize: normalizeGridSize(raw.gridSize),
    panelSpacing: clamp(
      Math.round(finiteNumber(raw.panelSpacing, 0)),
      0,
      240,
    ),
    workspaceZoomIncrement: clamp(
      finiteNumber(raw.workspaceZoomIncrement, 10),
      0.1,
      100,
    ),
    workspaceZoomAnchorMode:
      raw.workspaceZoomAnchorMode === "viewport-center" ||
      raw.workspaceZoomAnchorMode === "active-panel-center" ||
      raw.workspaceZoomAnchorMode === "active-panel-top-left" ||
      raw.workspaceZoomAnchorMode === "pointer"
        ? raw.workspaceZoomAnchorMode
        : "active-panel-center",
    panelNavigationAlignment:
      raw.panelNavigationAlignment === "panel-center" ||
      raw.panelNavigationAlignment === "panel-top-left"
        ? raw.panelNavigationAlignment
        : "panel-center",
    systemSurfacePositions: normalizeSystemSurfacePositions(
      raw.systemSurfacePositions,
    ),
    clock: normalizeClockPreferences(raw.clock),
    density,
    themeMode,
    fontFamily,
    themePreset,
    colorOverrides: normalizeColorOverrides(raw.colorOverrides),
    panelMenu: normalizePanelMenuPreferences(raw.panelMenu),
    frameControls: normalizeFrameControlPreferences(raw.frameControls),
    panelViews: normalizeWorkspacePanelViewPreferences(raw.panelViews),
  };
}

function normalizeSurfacePosition(
  input: unknown,
  fallback: { x: number; y: number },
) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ...fallback };
  }

  const record = input as Record<string, unknown>;

  const x =
    typeof record.x === "number" && Number.isFinite(record.x)
      ? Math.max(0, Math.round(record.x))
      : fallback.x;

  const y =
    typeof record.y === "number" && Number.isFinite(record.y)
      ? Math.max(0, Math.round(record.y))
      : fallback.y;

  return { x, y };
}

function normalizeSystemSurfacePositions(
  input: unknown,
): WorkspacePreferences["systemSurfacePositions"] {
  const defaults = DEFAULT_WORKSPACE_SYSTEM_SURFACE_POSITIONS;

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      settings: { ...defaults.settings },
      addPanel: { ...defaults.addPanel },
      frameSettings: { ...defaults.frameSettings },
    };
  }

  const record = input as Record<string, unknown>;

  return {
    settings: normalizeSurfacePosition(record.settings, defaults.settings),
    addPanel: normalizeSurfacePosition(record.addPanel, defaults.addPanel),
    frameSettings: normalizeSurfacePosition(
      record.frameSettings,
      defaults.frameSettings,
    ),
  };
}

function normalizeClockPreferences(
  input: unknown,
): WorkspacePreferences["clock"] {
  const raw = isRecord(input) ? input : {};

  const dateFormat =
    raw.dateFormat === "none" || raw.dateFormat === "numeric"
      ? raw.dateFormat
      : raw.dateFormat === "text"
        ? "text"
        : raw.showDate === false
          ? "none"
          : "text";

  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
    timeFormat: raw.timeFormat === "12h" ? "12h" : "24h",
    dateFormat,
  };
}

function normalizeWorkspacePanelViewPreferences(
  input: unknown,
): WorkspacePanelViewPreferences {
  if (!isRecord(input)) {
    return {};
  }

  const result: WorkspacePanelViewPreferences = {};
  for (const [key, value] of Object.entries(input)) {
    if (!isValidPanelTypePreferenceKey(key) || !isRecord(value)) {
      continue;
    }

    result[key] = {
      fontScale: clamp(finiteNumber(value.fontScale, 1), 0.75, 2),
    };
  }

  return result;
}

function isValidPanelTypePreferenceKey(key: string): boolean {
  const parts = key.split(":");
  return (
    parts.length === 2 &&
    parts.every((part) => part.length > 0 && /^[A-Za-z0-9._-]+$/.test(part))
  );
}

function normalizeGridSize(input: unknown): number {
  if (typeof input !== "number" || !Number.isFinite(input)) {
    return 12;
  }

  return Math.max(1, Math.round(input));
}

function normalizePanelMenuPreferences(input: unknown): WorkspacePreferences["panelMenu"] {
  const raw = isRecord(input) ? input : {};
  const moduleOrder = Array.isArray(raw.moduleOrder)
    ? uniqueStrings(raw.moduleOrder)
    : ["core", "demo"];
  const hiddenModuleIds = Array.isArray(raw.hiddenModuleIds)
    ? uniqueStrings(raw.hiddenModuleIds)
    : [];
  const expandedModuleIds = Array.isArray(raw.expandedModuleIds)
    ? uniqueStrings(raw.expandedModuleIds)
    : ["core", "demo"];

  return {
    moduleOrder,
    hiddenModuleIds,
    panelSort: raw.panelSort === "title" ? "title" : "registered",
    expandedModuleIds,
  };
}

function uniqueStrings(input: unknown[]) {
  return [...new Set(input.filter((entry): entry is string => typeof entry === "string"))];
}

function normalizeCanvasBounds(
  input: unknown,
  panels: PanelInstance[] = [],
  fallback: WorkspaceCanvasBounds = DEFAULT_WORKSPACE_CANVAS_BOUNDS,
): WorkspaceCanvasBounds {
  const raw = isRecord(input) ? input : {};

  const requestedX = finiteNumber(raw.x, fallback.x);
  const requestedY = finiteNumber(raw.y, fallback.y);
  const requestedWidth = Math.max(
    900,
    finiteNumber(raw.width, fallback.width),
  );
  const requestedHeight = Math.max(
    700,
    finiteNumber(raw.height, fallback.height),
  );
  const requestedRight = requestedX + requestedWidth;
  const requestedBottom = requestedY + requestedHeight;

  const extents = panels.reduce(
    (current, panel) => ({
      left: Math.min(current.left, panel.geometry.x),
      top: Math.min(current.top, panel.geometry.y),
      right: Math.max(
        current.right,
        panel.geometry.x + panel.geometry.width + 48,
      ),
      bottom: Math.max(
        current.bottom,
        panel.geometry.y + panel.geometry.height + 48,
      ),
    }),
    {
      left: requestedX,
      top: requestedY,
      right: requestedRight,
      bottom: requestedBottom,
    },
  );

  const x = Math.min(requestedX, extents.left);
  const y = Math.min(requestedY, extents.top);
  const right = Math.max(requestedRight, extents.right);
  const bottom = Math.max(requestedBottom, extents.bottom);

  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

function normalizeColorOverrides(input: unknown): Partial<WorkspaceColorTokens> {
  if (!isRecord(input)) {
    return {};
  }

  const keys: Array<keyof WorkspaceColorTokens> = [
    "page",
    "canvas",
    "panel",
    "panelHeader",
    "text",
    "muted",
    "border",
    "button",
    "control",
    "menu",
  ];
  const result: Partial<WorkspaceColorTokens> = {};

  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)) {
      result[key] = value;
    }
  }

  return result;
}

function normalizePanelGeometry(
  input: unknown,
  fallback: PanelGeometry,
  warnings: string[],
): PanelGeometry {
  if (!isRecord(input)) {
    warnings.push("Repaired missing panel geometry.");
    return normalizeGeometry(undefined, fallback);
  }

  return normalizeGeometry(
    {
      x: finiteNumber(input.x, fallback.x),
      y: finiteNumber(input.y, fallback.y),
      width: finiteNumber(input.width, fallback.width),
      height: finiteNumber(input.height, fallback.height),
      minWidth: finiteNumber(input.minWidth, fallback.minWidth ?? 260),
      minHeight: finiteNumber(input.minHeight, fallback.minHeight ?? 160),
    },
    fallback,
  );
}


function normalizePanelDisplay(input: unknown): PanelInstance["display"] {
  if (!isRecord(input)) {
    return undefined;
  }

  const mode = input.mode === "minimized" ? "minimized" : "normal";
  const restoreGeometry = isRecord(input.restoreGeometry)
    ? normalizeGeometry(input.restoreGeometry, SAFE_PANEL_GEOMETRY)
    : undefined;

  if (mode === "minimized") {
    return {
      mode,
      restoreGeometry,
      minimizedAt: typeof input.minimizedAt === "string" ? input.minimizedAt : undefined,
    };
  }

  return {
    mode: "normal",
    restoreGeometry,
  };
}

function missingPanelState(moduleId: string, panelType: string, originalState: unknown) {
  return {
    missing: true,
    moduleId,
    panelType,
    originalState,
  };
}

function normalizePanel(
  input: unknown,
  index: number,
  seenIds: Set<string>,
  warnings: string[],
  registry: PanelRegistry,
): PanelInstance {
  const raw = isRecord(input) ? input : {};
  const moduleId = typeof raw.moduleId === "string" ? raw.moduleId : "core";
  const panelType = typeof raw.panelType === "string" ? raw.panelType : "missing";
  const definition = registry.getPanel(moduleId, panelType);
  const now = nowIso();
  let id = typeof raw.id === "string" && raw.id.trim() ? raw.id : createId("panel");

  if (seenIds.has(id)) {
    id = createId("panel");
    warnings.push("Repaired duplicate panel id.");
  }
  seenIds.add(id);

  if (!definition) {
    warnings.push(`Repaired unknown panel definition: ${moduleId}:${panelType}.`);
    return {
      id,
      moduleId: "core",
      panelType: "missing",
      title: typeof raw.title === "string" ? raw.title : "Missing Panel",
      geometry: normalizePanelGeometry(
        raw.geometry,
        {
          ...SAFE_PANEL_GEOMETRY,
          x: SAFE_PANEL_GEOMETRY.x + index * 24,
          y: SAFE_PANEL_GEOMETRY.y + index * 24,
        },
        warnings,
      ),
      focusOrder: finiteNumber(raw.focusOrder, index + 1),
      stateVersion: 1,
      panelState: missingPanelState(moduleId, panelType, raw.panelState),
      createdAt: typeof raw.createdAt === "string" ? raw.createdAt : now,
      updatedAt: now,
    };
  }

  const normalizedState = definition.normalizeState(raw.panelState, { now });
  warnings.push(...normalizedState.warnings);

  return {
    id,
    moduleId: definition.moduleId,
    panelType: definition.panelType,
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title : definition.title,
    geometry: normalizePanelGeometry(
      raw.geometry,
      {
        ...definition.defaultGeometry,
        minWidth: definition.minGeometry.width,
        minHeight: definition.minGeometry.height,
      },
      warnings,
    ),
    focusOrder: finiteNumber(raw.focusOrder, index + 1),
    stateVersion: definition.stateVersion,
    panelState: normalizedState.state,
    dirty: undefined,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : now,
    updatedAt: now,
  };
}

function normalizeSurfacePresentationMemory(
  input: unknown,
  warnings: string[],
  registry: PanelRegistry,
): WorkspaceState["surfacePresentationMemory"] {
  if (!isRecord(input)) {
    return {};
  }

  const memory: WorkspaceState["surfacePresentationMemory"] = {};

  for (const [surfaceId, value] of Object.entries(input)) {
    if (!isRecord(value) || value.kind !== "panel") {
      warnings.push(
        `Discarded invalid surface presentation memory: ${surfaceId}.`,
      );
      continue;
    }

    const moduleId =
      typeof value.moduleId === "string" ? value.moduleId : "";
    const panelType =
      typeof value.panelType === "string" ? value.panelType : "";
    const expectedSurfaceId =
      panelSurfacePresentationKey(moduleId, panelType);

    if (
      !moduleId ||
      !panelType ||
      surfaceId !== expectedSurfaceId ||
      !/^[A-Za-z0-9._-]+$/.test(moduleId) ||
      !/^[A-Za-z0-9._-]+$/.test(panelType)
    ) {
      warnings.push(
        `Discarded invalid panel surface presentation memory: ${surfaceId}.`,
      );
      continue;
    }

    const definition = registry.getPanel(moduleId, panelType);

    const fallback = definition
      ? {
          ...definition.defaultGeometry,
          minWidth: definition.minGeometry.width,
          minHeight: definition.minGeometry.height,
        }
      : {
          x: 0,
          y: 0,
          width: 480,
          height: 360,
          minWidth: 240,
          minHeight: 160,
        };

    memory[surfaceId] = {
      kind: "panel",
      moduleId,
      panelType,
      geometry: isRecord(value.geometry)
        ? normalizeGeometry(value.geometry, fallback)
        : undefined,
      panelState: value.panelState,
      display: normalizePanelDisplay(value.display),
      stateVersion:
        typeof value.stateVersion === "number" &&
        Number.isFinite(value.stateVersion)
          ? value.stateVersion
          : definition?.stateVersion,
      updatedAt:
        typeof value.updatedAt === "string"
          ? value.updatedAt
          : nowIso(),
    };
  }

  return memory;
}

function normalizeTab(
  input: unknown,
  index: number,
  seenTabIds: Set<string>,
  warnings: string[],
  registry: PanelRegistry,
  fallbackCanvasBounds: WorkspaceCanvasBounds,
): WorkspaceTab {
  const raw = isRecord(input) ? input : {};
  const now = nowIso();
  let id = typeof raw.id === "string" && raw.id.trim() ? raw.id : createId("tab");

  if (seenTabIds.has(id)) {
    id = createId("tab");
    warnings.push("Repaired duplicate tab id.");
  }
  seenTabIds.add(id);

  const panelIds = new Set<string>();
  const panels = Array.isArray(raw.panels)
    ? raw.panels.map((panel, panelIndex) =>
        normalizePanel(panel, panelIndex, panelIds, warnings, registry),
      )
    : [];
  const canvasBounds = normalizeCanvasBounds(
    raw.canvasBounds,
    panels,
    isRecord(raw.canvasBounds) ? DEFAULT_WORKSPACE_CANVAS_BOUNDS : fallbackCanvasBounds,
  );

  return {
    id,
    title: typeof raw.title === "string" && raw.title.trim()
      ? raw.title
      : `Tab ${index + 1}`,
    canvasBounds,
    canvasScale: clamp(
      finiteNumber(raw.canvasScale, 1),
      0.25,
      2,
    ),
    canvasCamera: normalizeCanvasCamera(raw.canvasCamera, canvasBounds),
    organizeSnapshot: normalizeOrganizeSnapshot(
      raw.organizeSnapshot,
      canvasBounds,
    ),
    panels: repairFocusOrder(panels),
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : now,
    updatedAt: now,
  };
}

function normalizeOrganizeSnapshot(
  input: unknown,
  fallbackCanvasBounds: WorkspaceCanvasBounds,
): WorkspaceOrganizeSnapshot | null {
  if (!isRecord(input)) {
    return null;
  }

  const canvasBounds = normalizeCanvasBounds(
    input.canvasBounds,
    [],
    fallbackCanvasBounds,
  );
  const geometries: Record<string, PanelGeometry> = {};

  if (isRecord(input.geometries)) {
    for (const [panelId, value] of Object.entries(input.geometries)) {
      if (!isRecord(value)) {
        continue;
      }

      const { x, y, width, height } = value;
      if (
        typeof x === "number" && Number.isFinite(x) &&
        typeof y === "number" && Number.isFinite(y) &&
        typeof width === "number" && Number.isFinite(width) &&
        typeof height === "number" && Number.isFinite(height)
      ) {
        const { minWidth, minHeight } = value;
        geometries[panelId] = {
          x,
          y,
          width,
          height,
          ...(typeof minWidth === "number" && Number.isFinite(minWidth)
            ? { minWidth }
            : {}),
          ...(typeof minHeight === "number" && Number.isFinite(minHeight)
            ? { minHeight }
            : {}),
        };
      }
    }
  }

  return {
    canvasBounds,
    canvasScale: clamp(finiteNumber(input.canvasScale, 1), 0.25, 2),
    canvasCamera: normalizeCanvasCamera(input.canvasCamera, canvasBounds),
    geometries,
  };
}

function normalizeCanvasCamera(
  input: unknown,
  fallbackCanvasBounds: WorkspaceCanvasBounds,
) {
  const raw = isRecord(input) ? input : {};

  return {
    x: finiteNumber(raw.x, fallbackCanvasBounds.x),
    y: finiteNumber(raw.y, fallbackCanvasBounds.y),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
