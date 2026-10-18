import type { ComponentType } from "react";
import type {
  PanelFrameControlPublisher,
  WorkspaceFrameControlPreferences,
} from "./frameControls";
import type {
  PanelSemanticPublisher,
  WorkspaceProjectionDocument,
} from "./projection";
import type { OpenResourceRequest, OpenResourceResult } from "./resources";
import type { PanelInteractionCapabilities } from "./panelInteractions";

export const WORKSPACE_SCHEMA_VERSION = 2;

export type WorkspaceCanvasBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type WorkspaceCanvasCamera = {
  x: number;
  y: number;
};

export const DEFAULT_WORKSPACE_CANVAS_BOUNDS: WorkspaceCanvasBounds = {
  x: 0,
  y: 0,
  width: 1800,
  height: 1100,
};

export type WorkspaceClockPreferences = {
  enabled: boolean;
  timeFormat: "12h" | "24h";
  dateFormat: "none" | "text" | "numeric";
};

export type WorkspaceSurfacePosition = {
  x: number;
  y: number;
};

export type WorkspaceSystemSurfacePositions = {
  settings: WorkspaceSurfacePosition;
  addPanel: WorkspaceSurfacePosition;
  frameSettings: WorkspaceSurfacePosition;
};

export const DEFAULT_WORKSPACE_SYSTEM_SURFACE_POSITIONS: WorkspaceSystemSurfacePositions = {
  settings: { x: 924, y: 408 },
  addPanel: { x: 16, y: 100 },
  frameSettings: { x: 16, y: 100 },
};

export type WorkspacePreferences = {
  scale: number;
  fontSize: number;
  showGrid: boolean;
  gridSize: number;
  panelSpacing: number;
  workspaceZoomIncrement: number;
  workspaceZoomAnchorMode:
    | "viewport-center"
    | "active-panel-center"
    | "active-panel-top-left"
    | "pointer";
  panelNavigationAlignment:
    | "panel-center"
    | "panel-top-left";
  systemSurfacePositions: WorkspaceSystemSurfacePositions;
  clock: WorkspaceClockPreferences;
  density: "compact" | "comfortable";
  themeMode: "system" | "light" | "dark";
  fontFamily: "system" | "humanist" | "serif" | "mono" | "compact";
  themePreset:
    | "neutral"
    | "graphite"
    | "contrast"
    | "blueprint"
    | "pink-sparkle"
    | "chronogit";
  colorOverrides: Partial<WorkspaceColorTokens>;
  panelMenu: PanelMenuPreferences;
  frameControls: WorkspaceFrameControlPreferences;
  panelViews: WorkspacePanelViewPreferences;
};

export type WorkspaceColorTokens = {
  page: string;
  canvas: string;
  panel: string;
  panelHeader: string;
  text: string;
  muted: string;
  border: string;
  button: string;
  control: string;
  menu: string;
};

export type PanelMenuPreferences = {
  moduleOrder: string[];
  hiddenModuleIds: string[];
  panelSort: "registered" | "title";
  expandedModuleIds: string[];
};

export type PanelViewPreferences = {
  fontScale: number;
};

export type WorkspacePanelViewPreferences = {
  [panelKey: string]: PanelViewPreferences;
};

export function panelTypePreferenceKey(moduleId: string, panelType: string): string {
  return `${moduleId}:${panelType}`;
}

export function panelSurfacePresentationKey(
  moduleId: string,
  panelType: string,
): string {
  return `panel:${moduleId}:${panelType}`;
}

export type WorkspaceState = {
  schemaVersion: number;
  workspaceId: string;
  activeTabId: string | null;
  tabs: WorkspaceTab[];
  preferences: WorkspacePreferences;
  surfacePresentationMemory: SurfacePresentationMemory;
  registryVersion?: string;
};

export type WorkspaceTab = {
  id: string;
  title: string;
  canvasBounds: WorkspaceCanvasBounds;
  canvasScale: number;
  canvasCamera: WorkspaceCanvasCamera;
  panels: PanelInstance[];
  createdAt: string;
  updatedAt: string;
};

export type SavedTabTemplate = {
  id: string;
  title: string;
  sourceTitle: string;
  canvasBounds: WorkspaceCanvasBounds;
  panels: SavedPanelTemplate[];
  createdAt: string;
  updatedAt: string;
};

export type SavedPanelTemplate = {
  moduleId: string;
  panelType: string;
  title: string;
  geometry: PanelGeometry;
};

export type WorkspaceTabTemplateDocument = {
  kind: "jarri.workspace.tabs";
  schemaVersion: number;
  exportedAt: string;
  templates: SavedTabTemplate[];
};

export type PanelDisplayState = {
  mode: "normal" | "minimized";
  restoreGeometry?: PanelGeometry;
  minimizedAt?: string;
};

export type PanelSurfacePresentationMemory = {
  kind: "panel";
  moduleId: string;
  panelType: string;
  geometry?: PanelGeometry;
  panelState?: unknown;
  display?: PanelDisplayState;
  stateVersion?: number;
  updatedAt: string;
};

export type SurfacePresentationMemoryEntry =
  PanelSurfacePresentationMemory;

export type SurfacePresentationMemory = {
  [surfaceId: string]: SurfacePresentationMemoryEntry;
};

export type PanelGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
  minWidth?: number;
  minHeight?: number;
};

export type PreferredPanelSize = {
  width?: number;
  height?: number;
};

export type DirtyStateSnapshot = {
  isDirty: boolean;
  reason?: string;
  resourceLabel?: string;
  resourceUri?: string;
  canSave: boolean;
  canDiscard: boolean;
};

export type PanelInstance = {
  id: string;
  moduleId: string;
  panelType: string;
  title: string;
  geometry: PanelGeometry;
  focusOrder: number;
  stateVersion: number;
  panelState: unknown;
  dirty?: DirtyStateSnapshot;
  display?: PanelDisplayState;
  createdAt: string;
  updatedAt: string;
};

export type PanelCategory =
  | "core"
  | "domain"
  | "observability"
  | "temporal"
  | "advisory";

export type PanelCapabilities = {
  closable: boolean;
  resizable: boolean;
  movable: boolean;
  renameable: boolean;
  canBeDirty: boolean;
  usesTruthProvider?: string;
  usesAdvisoryProvider?: string;
  usesPreflightProvider?: string;
  usesTemporalProvider?: string;
};

export type PanelCreateContext = {
  now: string;
};

export type PanelNormalizeContext = {
  now: string;
};

export type PanelNormalizeResult = {
  state: unknown;
  repaired: boolean;
  warnings: string[];
};

export type PanelBodyProps = {
  panel: PanelInstance;
  preferences: WorkspacePreferences;
  modules: Array<Pick<WorkspaceModuleDefinition, "moduleId" | "title">>;
  updatePanelState: (panelState: unknown) => void;
  updatePreferences: (preferences: Partial<WorkspacePreferences>) => void;
  fileOperationClipboard: unknown;
  setFileOperationClipboard: (clipboard: unknown) => void;
  openPanel: (
    moduleId: string,
    panelType: string,
    panelState?: unknown,
  ) => string | null;
  openResource: (request: OpenResourceRequest) => OpenResourceResult;
  semanticPublisher: PanelSemanticPublisher;
  frameControlPublisher: PanelFrameControlPublisher;
};

export type PanelSemanticContext = {
  panel: PanelInstance;
  moduleTitle?: string;
  moduleId: string;
  panelType: string;
  panelTitle: string;
};

export type PanelSemanticStrategy =
  | {
      kind: "static";
      buildInitial: (context: PanelSemanticContext) => WorkspaceProjectionDocument;
    }
  | {
      kind: "dynamic";
      buildInitial: (context: PanelSemanticContext) => WorkspaceProjectionDocument;
    }
  | {
      kind: "unavailable";
      buildInitial: (context: PanelSemanticContext) => WorkspaceProjectionDocument;
    }
  | {
      kind: "pending";
      reason: string;
    };

export type PanelSurfacePresentationMemoryPolicy = {
  rememberPanelState?: boolean;
  rememberDisplay?: boolean;
};

export type PanelDefinition = {
  moduleId: string;
  panelType: string;
  title: string;
  description: string;
  category: PanelCategory;
  defaultGeometry: PanelGeometry;
  minGeometry: {
    width: number;
    height: number;
  };
  stateVersion: number;
  capabilities: PanelCapabilities;
  createInitialState: (context: PanelCreateContext) => unknown;
  normalizeState: (
    input: unknown,
    context: PanelNormalizeContext,
  ) => PanelNormalizeResult;
  semanticStrategy: PanelSemanticStrategy;
  interactionCapabilities?: PanelInteractionCapabilities;
  surfacePresentationMemory?: PanelSurfacePresentationMemoryPolicy;
  Component: ComponentType<PanelBodyProps>;
};

export type PersistedModuleRecord = {
  moduleId: string;
  version: string;
  registeredPanelTypes: string[];
};

export type WorkspaceModuleDefinition = {
  moduleId: string;
  title: string;
  version: string;
  panels: PanelDefinition[];
};

export type PersistedWorkspaceDocument = {
  kind: "jarri.workspace.layout";
  schemaVersion: number;
  savedAt: string;
  workspace: WorkspaceState;
  modules: PersistedModuleRecord[];
};

export type LayoutRepairReport = {
  migrated: boolean;
  repaired: boolean;
  fromSchemaVersion?: number;
  toSchemaVersion: number;
  warnings: string[];
};
