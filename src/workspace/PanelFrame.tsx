import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type RefObject,
} from "react";
import {
  beginGeometryInteraction,
  cancelGeometryInteraction,
  commitGeometryInteraction,
  previewGeometryInteraction,
  type GeometryInteraction,
} from "../core/layoutEngine";
import type { PanelRegistry } from "../core/panelRegistry";
import {
  createFrameControlCenter,
  enabledHeaderPanelFrameControls,
  invokePanelFrameCopyControl,
  nextPanelFontScale,
  panelFrameControlViewStates,
  SEMANTIC_COPY_CONTROL_ID,
  WORKSPACE_FRAME_CONTROL_CATALOG,
  type PanelFrameControlCenter,
  type PanelFrameControlViewState,
} from "../core/frameControls";
import { isPanelSemanticCopyAvailable } from "../core/panelSemantics";
import {
  createWorkspaceProjectionPublicationController,
  formatWorkspaceProjection,
  type WorkspaceProjectionPublicationController,
} from "../core/projection";
import type { OpenResourceRequest, OpenResourceResult } from "../core/resources";
import type {
  PanelGeometry,
  PanelInstance,
  PanelViewPreferences,
  WorkspaceModuleDefinition,
  WorkspacePreferences,
} from "../core/types";
import { panelTypePreferenceKey } from "../core/types";
import { PanelProjectionHost } from "./PanelProjectionHost";

const DEFAULT_PANEL_VIEW_PREFERENCES: PanelViewPreferences = {
  fontScale: 1,
};

type Props = {
  registry: PanelRegistry;
  panel: PanelInstance;
  canvasSurfaceRef: RefObject<HTMLDivElement | null>;
  canvasScale: number;
  preferences: WorkspacePreferences;
  modules: Array<Pick<WorkspaceModuleDefinition, "moduleId" | "title">>;
  fileOperationClipboard: unknown;
  setFileOperationClipboard: (clipboard: unknown) => void;
  onFocus: (
    panelId: string,
    navigation?: "none",
  ) => void;
  onClose: (panelId: string) => void;
  onToggleMinimized: (panelId: string) => void;
  onGeometryChange: (panelId: string, geometry: PanelGeometry) => void;
  onPanelStateChange: (panelId: string, panelState: unknown) => void;
  onPanelViewPreferencesChange: (
    moduleId: string,
    panelType: string,
    preferences: PanelViewPreferences,
  ) => void;
  onPreferencesChange: (preferences: Partial<WorkspacePreferences>) => void;
  onOpenPanel: (
    moduleId: string,
    panelType: string,
    sourcePanelId?: string,
    panelState?: unknown,
  ) => string | null;
  onOpenResource: (request: OpenResourceRequest) => OpenResourceResult;
};

export function PanelFrame({
  registry,
  panel,
  canvasSurfaceRef,
  canvasScale,
  preferences,
  modules,
  fileOperationClipboard,
  setFileOperationClipboard,
  onFocus,
  onClose,
  onToggleMinimized,
  onGeometryChange,
  onPanelStateChange,
  onPanelViewPreferencesChange,
  onPreferencesChange,
  onOpenPanel,
  onOpenResource,
}: Props) {
  const [dragState, setDragState] = useState<GeometryInteraction | null>(null);
  const [previewGeometry, setPreviewGeometry] = useState<PanelGeometry | null>(
    null,
  );
  const [copyFeedback, setCopyFeedback] = useState<"copied" | "error" | null>(
    null,
  );
  const previewGeometryRef = useRef<PanelGeometry | null>(null);
  const dragViewportRef = useRef<{
    startScrollLeft: number;
    startScrollTop: number;
    pointerX: number;
    pointerY: number;
  } | null>(null);
  const copyFeedbackTimerRef = useRef<number | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const semanticControllerRef =
    useRef<WorkspaceProjectionPublicationController | null>(null);
  const frameControlCenterRef = useRef<PanelFrameControlCenter | null>(null);
  const semanticControllerKeyRef = useRef("");
  const definition = registry.getPanel(panel.moduleId, panel.panelType);
  const moduleTitle = modules.find(
    (module) => module.moduleId === panel.moduleId,
  )?.title;
  const isMinimized = panel.display?.mode === "minimized";
  const baseGeometry = isMinimized
    ? {
        ...panel.geometry,
        height: 46,
      }
    : panel.geometry;
  const effectiveGeometry = previewGeometry ?? baseGeometry;
  const semanticControllerKey = `${panel.id}:${panel.moduleId}:${panel.panelType}`;
  const panelViewPreferences =
    preferences.panelViews[panelTypePreferenceKey(panel.moduleId, panel.panelType)] ??
    DEFAULT_PANEL_VIEW_PREFERENCES;
  const semanticCopyAvailable = isPanelSemanticCopyAvailable(
    definition?.semanticStrategy,
  );

  if (
    !semanticControllerRef.current ||
    semanticControllerKeyRef.current !== semanticControllerKey
  ) {
    semanticControllerRef.current =
      createWorkspaceProjectionPublicationController();
    frameControlCenterRef.current = createFrameControlCenter();
    semanticControllerKeyRef.current = semanticControllerKey;
  }

  const semanticController = semanticControllerRef.current;
  const frameControlCenter = frameControlCenterRef.current;
  if (!frameControlCenter) {
    throw new Error("Frame Control Center was not initialized.");
  }

  const projectionExporter = useSyncExternalStore(
    semanticController.subscribe,
    semanticController.getSnapshot,
    semanticController.getSnapshot,
  );
  const frameControlRuntimeSnapshot = useSyncExternalStore(
    frameControlCenter.subscribe,
    frameControlCenter.getSnapshot,
    frameControlCenter.getSnapshot,
  );
  const frameControlStates = useMemo(
    () =>
      panelFrameControlViewStates({
        controls: WORKSPACE_FRAME_CONTROL_CATALOG,
        moduleId: panel.moduleId,
        panelType: panel.panelType,
        preferences: preferences.frameControls,
        runtimeSnapshot: frameControlRuntimeSnapshot,
      }),
    [
      frameControlRuntimeSnapshot,
      panel.moduleId,
      panel.panelType,
      preferences.frameControls,
    ],
  );
  const visibleHeaderControls = enabledHeaderPanelFrameControls(frameControlStates);

  useEffect(() => {
    frameControlCenter.reset();
  }, [frameControlCenter]);

  useEffect(() => {
    if (!semanticCopyAvailable) {
      return undefined;
    }

    const lease = frameControlCenter.publish(SEMANTIC_COPY_CONTROL_ID, {
      kind: "copy",
      copyText: () => {
        const projection = projectionExporter();
        return formatWorkspaceProjection({
          panelTitle: panel.title,
          moduleTitle,
          moduleId: panel.moduleId,
          panelType: panel.panelType,
          copiedAt: new Date().toISOString(),
          projection,
        });
      },
    });
    return () => lease.release();
  }, [
    frameControlCenter,
    moduleTitle,
    panel.moduleId,
    panel.panelType,
    panel.title,
    projectionExporter,
    semanticCopyAvailable,
  ]);

  const clearCopyFeedbackTimer = useCallback(() => {
    if (copyFeedbackTimerRef.current === null) {
      return;
    }
    window.clearTimeout(copyFeedbackTimerRef.current);
    copyFeedbackTimerRef.current = null;
  }, []);

  const showCopyFeedback = useCallback(
    (nextFeedback: "copied" | "error") => {
      clearCopyFeedbackTimer();
      setCopyFeedback(nextFeedback);
      copyFeedbackTimerRef.current = window.setTimeout(() => {
        setCopyFeedback(null);
        copyFeedbackTimerRef.current = null;
      }, 1800);
    },
    [clearCopyFeedbackTimer],
  );

  useEffect(() => {
    return () => clearCopyFeedbackTimer();
  }, [clearCopyFeedbackTimer]);

  useEffect(() => {
    if (!dragState) {
      return undefined;
    }

    const activeDrag = dragState;
    const surface = canvasSurfaceRef.current;

    function updatePreviewFromCurrentViewport() {
      const viewport = dragViewportRef.current;
      if (!viewport) {
        return;
      }

      const scrollDeltaX = surface
        ? surface.scrollLeft - viewport.startScrollLeft
        : 0;
      const scrollDeltaY = surface
        ? surface.scrollTop - viewport.startScrollTop
        : 0;

      const nextPreview = previewGeometryInteraction(
        activeDrag,
        viewport.pointerX + scrollDeltaX,
        viewport.pointerY + scrollDeltaY,
      );

      previewGeometryRef.current = nextPreview;
      setPreviewGeometry(nextPreview);
    }

    function handlePointerMove(event: PointerEvent) {
      if (dragViewportRef.current) {
        dragViewportRef.current.pointerX = event.clientX;
        dragViewportRef.current.pointerY = event.clientY;
      }

      updatePreviewFromCurrentViewport();
    }

    function handleScroll() {
      updatePreviewFromCurrentViewport();
    }

    function handlePointerUp() {
      const committed = commitGeometryInteraction(
        previewGeometryRef.current ?? activeDrag.startGeometry,
        activeDrag.gridSize,
      );

      dragViewportRef.current = null;
      previewGeometryRef.current = null;
      setPreviewGeometry(null);
      setDragState(null);
      onGeometryChange(panel.id, committed);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      dragViewportRef.current = null;
      previewGeometryRef.current = null;
      setPreviewGeometry(cancelGeometryInteraction(activeDrag));
      window.setTimeout(() => setPreviewGeometry(null), 0);
      setDragState(null);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("keydown", handleKeyDown);
    surface?.addEventListener("scroll", handleScroll);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("keydown", handleKeyDown);
      surface?.removeEventListener("scroll", handleScroll);
    };
  }, [canvasSurfaceRef, dragState, onGeometryChange, panel.id]);

  function beginDrag(event: React.PointerEvent, mode: "move" | "resize") {
    if (event.button !== 0) {
      return;
    }

    if (isMinimized && mode === "resize") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    onFocus(panel.id, "none");

    const surface = canvasSurfaceRef.current;
    dragViewportRef.current = {
      startScrollLeft: surface?.scrollLeft ?? 0,
      startScrollTop: surface?.scrollTop ?? 0,
      pointerX: event.clientX,
      pointerY: event.clientY,
    };

    previewGeometryRef.current = baseGeometry;
    setPreviewGeometry(baseGeometry);
    setDragState(
      beginGeometryInteraction(
        mode,
        {
          ...panel,
          geometry: baseGeometry,
        },
        event.clientX,
        event.clientY,
        canvasScale,
        preferences.gridSize,
      ),
    );
  }

  async function invokeFrameControl(control: PanelFrameControlViewState) {
    if (isMinimized) {
      return;
    }

    switch (control.definition.kind) {
      case "font-decrease":
      case "font-increase": {
        const currentScale = panelViewPreferences.fontScale;
        const nextScale = nextPanelFontScale(
          currentScale,
          control.definition.kind === "font-increase"
            ? "increase"
            : "decrease",
        );

        if (nextScale !== currentScale) {
          onPanelViewPreferencesChange(panel.moduleId, panel.panelType, {
            fontScale: nextScale,
          });
        }
        return;
      }

      case "copy": {
        if (!control.payload) {
          showCopyFeedback("error");
          return;
        }

        try {
          await invokePanelFrameCopyControl(control, (text) =>
            navigator.clipboard.writeText(text),
          );
          showCopyFeedback("copied");
        } catch {
          showCopyFeedback("error");
        }
        return;
      }
    }
  }

  return (
    <article
      className={`panel-frame ${isMinimized ? "panel-frame--minimized" : ""}`}
      ref={panelRef}
      data-workspace-local-wheel={
        definition?.interactionCapabilities?.localWheel ? "true" : undefined
      }
      style={{
        left: effectiveGeometry.x,
        top: effectiveGeometry.y,
        width: effectiveGeometry.width,
        height: effectiveGeometry.height,
        zIndex: panel.focusOrder,
        "--panel-font-scale": panelViewPreferences.fontScale,
      } as CSSProperties}
      onPointerDown={() => onFocus(panel.id, "none")}
    >
      <header className="panel-frame__header" onPointerDown={(event) => beginDrag(event, "move")}>
        <div className="panel-frame__title">
          <span className={`panel-kind panel-kind--${definition?.category ?? "core"}`} />
          <div>
            <strong>{panel.title}</strong>
            <span>{panel.moduleId} / {panel.panelType}</span>
          </div>
        </div>
        <div className="panel-frame__controls">
          {!isMinimized
            ? visibleHeaderControls.map((control) => (
                <button
                  key={control.definition.controlId}
                  type="button"
                  className={`panel-frame__projection-copy ${
                    control.definition.kind === "copy" && copyFeedback
                      ? `panel-frame__projection-copy--${copyFeedback}`
                      : ""
                  }`}
                  aria-label={control.definition.label}
                  title={
                    control.available
                      ? control.definition.label
                      : control.definition.kind === "copy"
                        ? `${control.definition.label} is waiting for panel content`
                        : control.definition.label
                  }
                  disabled={!control.available}
                  data-frame-control-status={control.status}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => void invokeFrameControl(control)}
                >
                  {control.definition.kind === "copy" && copyFeedback === "copied"
                    ? "Copied"
                    : control.definition.kind === "copy" && copyFeedback === "error"
                      ? "Copy failed"
                      : control.definition.label}
                </button>
              ))
            : null}
          <button
            type="button"
            className="panel-frame__minimize"
            aria-label={isMinimized ? `Restore ${panel.title}` : `Minimize ${panel.title}`}
            title={isMinimized ? "Restore" : "Minimize"}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onToggleMinimized(panel.id)}
          >
            {isMinimized ? "▣" : "–"}
          </button>
          <button
            type="button"
            className="panel-frame__close"
            aria-label={`Close ${panel.title}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onClose(panel.id)}
          >
            ×
          </button>
        </div>
      </header>
      {!isMinimized ? (
        <>
          <PanelProjectionHost
            definition={definition}
            panel={panel}
            preferences={preferences}
            modules={modules}
            moduleTitle={moduleTitle}
            semanticController={semanticController}
            frameControlPublisher={frameControlCenter}
            fileOperationClipboard={fileOperationClipboard}
            setFileOperationClipboard={setFileOperationClipboard}
            onPanelStateChange={onPanelStateChange}
            onPreferencesChange={onPreferencesChange}
            onOpenPanel={onOpenPanel}
            onOpenResource={onOpenResource}
          />
          <span
            className="panel-frame__resize"
            aria-hidden="true"
            onPointerDown={(event) => beginDrag(event, "resize")}
          />
        </>
      ) : null}
    </article>
  );
}
