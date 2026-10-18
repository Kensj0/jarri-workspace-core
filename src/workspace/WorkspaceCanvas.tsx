import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Image } from "@tauri-apps/api/image";
import { writeImage } from "@tauri-apps/plugin-clipboard-manager";
import { domToBlob } from "modern-screenshot";
import type {
  PanelGeometry,
  PanelInstance,
  PanelViewPreferences,
  WorkspaceCanvasCamera,
  WorkspaceCanvasBounds,
  WorkspaceModuleDefinition,
  WorkspacePreferences,
} from "../core/types";
import type { PanelRegistry } from "../core/panelRegistry";
import type { OpenResourceRequest, OpenResourceResult } from "../core/resources";
import {
  cameraOriginFromScroll,
  clampScroll,
  nextCanvasScaleFromWheel,
  panelNavigationAnchor,
  scrollForCameraOrigin,
  scrollForAnchor,
  viewportSizesMatch,
  zoomAnchorForMode,
  type WorkspaceViewportAnchor,
} from "../core/cameraMath";
import { shouldReserveLocalWheel } from "../core/panelInteractions";
import { PanelFrame } from "./PanelFrame";

const CANVAS_GRID_SIZE = 24;
const MIN_CANVAS_WIDTH = 900;
const MIN_CANVAS_HEIGHT = 700;

type ResizeMode = "left" | "top" | "right" | "bottom" | "both";

type CanvasResizeState = {
  mode: ResizeMode;
  startX: number;
  startY: number;
  startBounds: WorkspaceCanvasBounds;
};

type CanvasPanState = {
  pointerId: number;
  startX: number;
  startY: number;
  startScrollLeft: number;
  startScrollTop: number;
};

type Props = {
  registry: PanelRegistry;
  tabId: string;
  title: string;
  panels: PanelInstance[];
  canvasBounds: WorkspaceCanvasBounds;
  canvasScale: number;
  canvasCamera: WorkspaceCanvasCamera;
  preferences: WorkspacePreferences;
  modules: Array<Pick<WorkspaceModuleDefinition, "moduleId" | "title">>;
  fileOperationClipboard: unknown;
  setFileOperationClipboard: (clipboard: unknown) => void;
  onOpenPanelsMenu: () => void;
  onFocusPanel: (panelId: string) => void;
  onClosePanel: (panelId: string) => void;
  onTogglePanelMinimized: (panelId: string) => void;
  onGeometryChange: (panelId: string, geometry: PanelGeometry) => void;
  onPanelStateChange: (panelId: string, panelState: unknown) => void;
  onPanelViewPreferencesChange: (
    moduleId: string,
    panelType: string,
    preferences: PanelViewPreferences,
  ) => void;
  onCanvasBoundsChange: (bounds: WorkspaceCanvasBounds) => void;
  onCanvasScaleChange: (canvasScale: number) => void;
  onCanvasCameraChange: (camera: WorkspaceCanvasCamera) => void;
  onPreferencesChange: (preferences: Partial<WorkspacePreferences>) => void;
  onOpenPanel: (
    moduleId: string,
    panelType: string,
    sourcePanelId?: string,
    panelState?: unknown,
  ) => string | null;
  onOpenResource: (request: OpenResourceRequest) => OpenResourceResult;
};

function snapToCanvasGrid(value: number) {
  return Math.ceil(value / CANVAS_GRID_SIZE) * CANVAS_GRID_SIZE;
}

function requiredBoundsForPanels(panels: PanelInstance): WorkspaceCanvasBounds;
function requiredBoundsForPanels(panels: PanelInstance[]): WorkspaceCanvasBounds;
function requiredBoundsForPanels(panels: PanelInstance | PanelInstance[]): WorkspaceCanvasBounds {
  const list = Array.isArray(panels) ? panels : [panels];
  return list.reduce(
    (bounds, panel) => ({
      x: Math.min(bounds.x, panel.geometry.x),
      y: Math.min(bounds.y, panel.geometry.y),
      width: Math.max(
        bounds.x + bounds.width,
        panel.geometry.x + panel.geometry.width + CANVAS_GRID_SIZE * 2,
      ) - Math.min(bounds.x, panel.geometry.x),
      height: Math.max(
        bounds.y + bounds.height,
        panel.geometry.y + panel.geometry.height + CANVAS_GRID_SIZE * 2,
      ) - Math.min(bounds.y, panel.geometry.y),
    }),
    { x: 0, y: 0, width: MIN_CANVAS_WIDTH, height: MIN_CANVAS_HEIGHT },
  );
}

function normalizeBounds(
  bounds: WorkspaceCanvasBounds,
  panels: PanelInstance[],
): WorkspaceCanvasBounds {
  const required = requiredBoundsForPanels(panels);
  const x = Math.min(bounds.x, required.x);
  const y = Math.min(bounds.y, required.y);
  const right = Math.max(
    bounds.x + bounds.width,
    required.x + required.width,
    x + MIN_CANVAS_WIDTH,
  );
  const bottom = Math.max(
    bounds.y + bounds.height,
    required.y + required.height,
    y + MIN_CANVAS_HEIGHT,
  );

  return {
    x,
    y,
    width: snapToCanvasGrid(right - x),
    height: snapToCanvasGrid(bottom - y),
  };
}

export function WorkspaceCanvas({
  registry,
  tabId,
  title,
  panels,
  canvasBounds,
  canvasScale,
  canvasCamera,
  preferences,
  modules,
  fileOperationClipboard,
  setFileOperationClipboard,
  onOpenPanelsMenu,
  onFocusPanel,
  onClosePanel,
  onTogglePanelMinimized,
  onGeometryChange,
  onPanelStateChange,
  onPanelViewPreferencesChange,
  onCanvasBoundsChange,
  onCanvasScaleChange,
  onCanvasCameraChange,
  onPreferencesChange,
  onOpenPanel,
  onOpenResource,
}: Props) {
  const [resizeState, setResizeState] = useState<CanvasResizeState | null>(null);
  const [panState, setPanState] = useState<CanvasPanState | null>(null);
  const [previewBounds, setPreviewBounds] = useState<WorkspaceCanvasBounds | null>(null);
  const [cameraViewportSize, setCameraViewportSize] = useState({
    width: 0,
    height: 0,
  });
  const [screenshotState, setScreenshotState] = useState<
    "idle" | "copying" | "copied" | "failed"
  >("idle");
  const previewBoundsRef = useRef<WorkspaceCanvasBounds | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const logicalRef = useRef<HTMLDivElement | null>(null);
  const pendingCanvasZoomAnchorRef =
    useRef<WorkspaceViewportAnchor | null>(null);
  const restoringCameraRef = useRef(false);
  const cameraViewportReadyRef = useRef(false);
  const measuredCameraViewportRef = useRef({
    width: 0,
    height: 0,
  });

  const effectiveBounds = normalizeBounds(
    previewBounds ?? canvasBounds,
    panels,
  );

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (
      !surface ||
      pendingCanvasZoomAnchorRef.current ||
      cameraViewportSize.width <= 0 ||
      cameraViewportSize.height <= 0
    ) {
      return;
    }

    const targetScroll = scrollForCameraOrigin(
      canvasCamera,
      effectiveBounds,
      cameraViewportSize,
      canvasScale,
    );
    const nextScroll = clampScroll(targetScroll, {
      scrollLeft: surface.scrollWidth - surface.clientWidth,
      scrollTop: surface.scrollHeight - surface.clientHeight,
    });

    const scrollAlreadyRestored =
      Math.abs(surface.scrollLeft - nextScroll.scrollLeft) < 0.5 &&
      Math.abs(surface.scrollTop - nextScroll.scrollTop) < 0.5;

    restoringCameraRef.current = true;
    cameraViewportReadyRef.current = false;

    if (!scrollAlreadyRestored) {
      surface.scrollLeft = nextScroll.scrollLeft;
      surface.scrollTop = nextScroll.scrollTop;
    }

    const frameId = window.requestAnimationFrame(() => {
      restoringCameraRef.current = false;
      cameraViewportReadyRef.current = true;
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      restoringCameraRef.current = false;
      cameraViewportReadyRef.current = false;
    };
  }, [
    tabId,
    canvasCamera.x,
    canvasCamera.y,
    canvasScale,
    effectiveBounds.x,
    effectiveBounds.y,
    effectiveBounds.width,
    effectiveBounds.height,
    cameraViewportSize.width,
    cameraViewportSize.height,
  ]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) {
      return undefined;
    }

    const measuredSurface = surface;

    function measureCameraViewport() {
      const next = {
        width: Math.max(1, measuredSurface.clientWidth),
        height: Math.max(1, measuredSurface.clientHeight),
      };

      const measured = measuredCameraViewportRef.current;

      if (measured.width === next.width && measured.height === next.height) {
        return;
      }

      measuredCameraViewportRef.current = next;
      cameraViewportReadyRef.current = false;
      setCameraViewportSize(next);
    }

    measureCameraViewport();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measureCameraViewport);
      return () =>
        window.removeEventListener("resize", measureCameraViewport);
    }

    const observer = new ResizeObserver(measureCameraViewport);
    observer.observe(measuredSurface);

    return () => observer.disconnect();
  }, []);

  function rememberViewport() {
    const surface = surfaceRef.current;
    if (!surface) {
      return;
    }

    const currentViewport = {
      width: surface.clientWidth,
      height: surface.clientHeight,
    };
    const viewportMeasurementCurrent = viewportSizesMatch(
      measuredCameraViewportRef.current,
      currentViewport,
    );

    if (
      restoringCameraRef.current ||
      !cameraViewportReadyRef.current ||
      !viewportMeasurementCurrent
    ) {
      cameraViewportReadyRef.current = false;
      return;
    }

    const nextCamera = cameraOriginFromScroll(
      effectiveBounds,
      currentViewport,
      { scrollLeft: surface.scrollLeft, scrollTop: surface.scrollTop },
      canvasScale,
    );

    onCanvasCameraChange(
      nextCamera,
    );
  }

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) {
      return undefined;
    }

    const canvasSurface = surface;

    function handleWorkspaceWheel(event: WheelEvent) {
      if (event.ctrlKey) {
        event.preventDefault();

        const currentScale = canvasScale;
        const nextScale = nextCanvasScaleFromWheel(
          currentScale,
          event.deltaY,
          preferences.workspaceZoomIncrement,
        );

        if (nextScale === currentScale) {
          return;
        }

        const surfaceRect = canvasSurface.getBoundingClientRect();
        const pointerX = Math.min(
          canvasSurface.clientWidth,
          Math.max(0, event.clientX - surfaceRect.left),
        );
        const pointerY = Math.min(
          canvasSurface.clientHeight,
          Math.max(0, event.clientY - surfaceRect.top),
        );

        pendingCanvasZoomAnchorRef.current = zoomAnchorForMode({
          mode: preferences.workspaceZoomAnchorMode,
          panels,
          pointer: { x: pointerX, y: pointerY },
          bounds: effectiveBounds,
          viewport: {
            width: canvasSurface.clientWidth,
            height: canvasSurface.clientHeight,
          },
          scroll: {
            scrollLeft: canvasSurface.scrollLeft,
            scrollTop: canvasSurface.scrollTop,
          },
          canvasScale: currentScale,
        });

        onCanvasScaleChange(nextScale);
        return;
      }

      if (shouldReserveLocalWheel(event)) {
        event.preventDefault();
      }
    }

    function handleWorkspaceScroll() {
      rememberViewport();
    }

    canvasSurface.addEventListener("wheel", handleWorkspaceWheel, {
      passive: false,
    });
    canvasSurface.addEventListener("scroll", handleWorkspaceScroll, {
      passive: true,
    });

    return () => {
      canvasSurface.removeEventListener("wheel", handleWorkspaceWheel);
      canvasSurface.removeEventListener("scroll", handleWorkspaceScroll);
    };
  }, [
    canvasScale,
    effectiveBounds.x,
    effectiveBounds.y,
    panels,
    preferences.workspaceZoomIncrement,
    preferences.workspaceZoomAnchorMode,
    onCanvasScaleChange,
  ]);

  useLayoutEffect(() => {
    const anchor = pendingCanvasZoomAnchorRef.current;
    const surface = surfaceRef.current;

    if (!anchor || !surface) {
      return;
    }

    const targetScroll = scrollForAnchor(
      anchor,
      effectiveBounds,
      { width: surface.clientWidth, height: surface.clientHeight },
      canvasScale,
    );
    const nextScroll = clampScroll(targetScroll, {
      scrollLeft: surface.scrollWidth - surface.clientWidth,
      scrollTop: surface.scrollHeight - surface.clientHeight,
    });

    surface.scrollLeft = nextScroll.scrollLeft;
    surface.scrollTop = nextScroll.scrollTop;
    pendingCanvasZoomAnchorRef.current = null;
    rememberViewport();
  }, [
    canvasScale,
    effectiveBounds.x,
    effectiveBounds.y,
    effectiveBounds.width,
    effectiveBounds.height,
  ]);

  useEffect(() => {
    const normalized = normalizeBounds(canvasBounds, panels);
    if (
      normalized.x !== canvasBounds.x ||
      normalized.y !== canvasBounds.y ||
      normalized.width !== canvasBounds.width ||
      normalized.height !== canvasBounds.height
    ) {
      onCanvasBoundsChange(normalized);
    }
  }, [panels, canvasBounds, onCanvasBoundsChange]);

  useEffect(() => {
    if (!resizeState) {
      return undefined;
    }

    const activeResize = resizeState;

    function previewFromPointer(event: PointerEvent) {
      const deltaX = (event.clientX - activeResize.startX) / canvasScale;
      const deltaY = (event.clientY - activeResize.startY) / canvasScale;

      const start = activeResize.startBounds;
      const startRight = start.x + start.width;
      const startBottom = start.y + start.height;

      let nextX = start.x;
      let nextY = start.y;
      let nextRight = startRight;
      let nextBottom = startBottom;

      if (activeResize.mode === "left") {
        nextX = Math.min(startRight - MIN_CANVAS_WIDTH, start.x + deltaX);
      }

      if (activeResize.mode === "top") {
        nextY = Math.min(startBottom - MIN_CANVAS_HEIGHT, start.y + deltaY);
      }

      if (activeResize.mode === "right" || activeResize.mode === "both") {
        nextRight = Math.max(start.x + MIN_CANVAS_WIDTH, startRight + deltaX);
      }

      if (activeResize.mode === "bottom" || activeResize.mode === "both") {
        nextBottom = Math.max(start.y + MIN_CANVAS_HEIGHT, startBottom + deltaY);
      }

      const nextBounds = normalizeBounds(
        {
          x: nextX,
          y: nextY,
          width: nextRight - nextX,
          height: nextBottom - nextY,
        },
        panels,
      );

      previewBoundsRef.current = nextBounds;
      setPreviewBounds(nextBounds);
    }

    function commitResize() {
      const committed = normalizeBounds(
        previewBoundsRef.current ?? activeResize.startBounds,
        panels,
      );
      previewBoundsRef.current = null;
      setPreviewBounds(null);
      setResizeState(null);
      onCanvasBoundsChange(committed);
    }

    function cancelResize(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }
      previewBoundsRef.current = null;
      setPreviewBounds(null);
      setResizeState(null);
    }

    window.addEventListener("pointermove", previewFromPointer);
    window.addEventListener("pointerup", commitResize);
    window.addEventListener("keydown", cancelResize);

    return () => {
      window.removeEventListener("pointermove", previewFromPointer);
      window.removeEventListener("pointerup", commitResize);
      window.removeEventListener("keydown", cancelResize);
    };
  }, [resizeState, panels, canvasScale, onCanvasBoundsChange]);

  useEffect(() => {
    if (!panState) {
      return undefined;
    }

    const activePan = panState;

    function panFromPointer(event: PointerEvent) {
      if (event.pointerId !== activePan.pointerId) {
        return;
      }

      const surface = surfaceRef.current;
      if (!surface) {
        return;
      }

      surface.scrollLeft = activePan.startScrollLeft - (event.clientX - activePan.startX);
      surface.scrollTop = activePan.startScrollTop - (event.clientY - activePan.startY);
    }

    function commitPan(event: PointerEvent) {
      if (event.pointerId !== activePan.pointerId) {
        return;
      }

      setPanState(null);
    }

    function cancelPan(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      const surface = surfaceRef.current;
      if (surface) {
        surface.scrollLeft = activePan.startScrollLeft;
        surface.scrollTop = activePan.startScrollTop;
      }

      setPanState(null);
    }

    window.addEventListener("pointermove", panFromPointer);
    window.addEventListener("pointerup", commitPan);
    window.addEventListener("keydown", cancelPan);

    return () => {
      window.removeEventListener("pointermove", panFromPointer);
      window.removeEventListener("pointerup", commitPan);
      window.removeEventListener("keydown", cancelPan);
    };
  }, [panState]);

  function beginCanvasPan(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 1) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (
      target?.closest(
        ".panel-frame, .workspace-canvas__resize-handle, button, input, select, textarea, a",
      )
    ) {
      return;
    }

    const surface = surfaceRef.current;
    if (!surface) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);

    setPanState({
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: surface.scrollLeft,
      startScrollTop: surface.scrollTop,
    });
  }

  function positionPanelInViewport(panel: PanelInstance) {
    const surface = surfaceRef.current;
    if (!surface) {
      return;
    }

    const targetScroll = scrollForAnchor(
      panelNavigationAnchor(
        panel,
        preferences.panelNavigationAlignment,
        { width: surface.clientWidth, height: surface.clientHeight },
      ),
      effectiveBounds,
      { width: surface.clientWidth, height: surface.clientHeight },
      canvasScale,
    );
    const nextScroll = clampScroll(targetScroll, {
      scrollLeft: surface.scrollWidth - surface.clientWidth,
      scrollTop: surface.scrollHeight - surface.clientHeight,
    });

    surface.scrollTo({
      left: nextScroll.scrollLeft,
      top: nextScroll.scrollTop,
      behavior: "auto",
    });
    rememberViewport();
  }

  function focusPanel(panel: PanelInstance, navigation: "none" | "panel-bar") {
    onFocusPanel(panel.id);

    if (navigation === "panel-bar") {
      positionPanelInViewport(panel);
    }
  }

  function beginCanvasResize(event: React.PointerEvent, mode: ResizeMode) {
    event.preventDefault();
    event.stopPropagation();

    const bounds = normalizeBounds(canvasBounds, panels);
    previewBoundsRef.current = bounds;
    setPreviewBounds(bounds);
    setResizeState({
      mode,
      startX: event.clientX,
      startY: event.clientY,
      startBounds: bounds,
    });
  }

  async function captureWorkspaceScreenshot() {
    const logical = logicalRef.current;
    if (!logical || screenshotState === "copying") {
      return;
    }

    const width = effectiveBounds.width;
    const height = effectiveBounds.height;

    setScreenshotState("copying");

    try {
      const captured = await domToBlob(logical, {
        width,
        height,
        scale: 1,
        style: {
          transform: "none",
          transformOrigin: "top left",
        },
        filter: (node) =>
          !(node instanceof Element) ||
          !node.classList.contains("workspace-canvas__resize-handle"),
        features: {
          copyScrollbar: true,
          removeAbnormalAttributes: true,
          removeControlCharacter: true,
          fixSvgXmlDecode: true,
          restoreScrollPosition: false,
        },
      });

      if (!captured) {
        throw new Error("Workspace screenshot produced no image data.");
      }

      const image = await Image.fromBytes(await captured.arrayBuffer());

      try {
        await writeImage(image);
      } finally {
        await image.close();
      }

      setScreenshotState("copied");
      window.setTimeout(() => {
        setScreenshotState((current) =>
          current === "copied" ? "idle" : current,
        );
      }, 1600);
    } catch (error) {
      console.error("Workspace screenshot failed", error);
      setScreenshotState("failed");

      window.setTimeout(() => {
        setScreenshotState((current) =>
          current === "failed" ? "idle" : current,
        );
      }, 2400);
    }
  }

  return (
    <section className="workspace-canvas" aria-label="Workspace canvas">
      <div className="workspace-canvas__toolbar">
        <div className="workspace-canvas__toolbar-info">
          <strong>{title}</strong>
          <span>
            {panels.length} panels · {effectiveBounds.width}×{effectiveBounds.height}
          </span>
        </div>

        <div
          className="workspace-canvas__panel-taskbar"
          aria-label="Active tab panels"
        >
          {panels.map((panel) => {
            const minimized = panel.display?.mode === "minimized";
            const focused =
              !minimized &&
              panel.focusOrder ===
                Math.max(...panels.map((candidate) => candidate.focusOrder));

            return (
              <button
                key={panel.id}
                type="button"
                className={[
                  "workspace-canvas__panel-task",
                  focused ? "workspace-canvas__panel-task--focused" : "",
                  minimized ? "workspace-canvas__panel-task--minimized" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                title={`${minimized ? "Restore" : "Focus"} ${panel.title}`}
                aria-pressed={focused}
                onClick={() => {
                  if (minimized) {
                    onTogglePanelMinimized(panel.id);
                  }

                  focusPanel(panel, "panel-bar");
                }}
              >
                {panel.title}
              </button>
            );
          })}
        </div>

        <div className="workspace-canvas__toolbar-actions">
          <button
            type="button"
            onClick={captureWorkspaceScreenshot}
            disabled={screenshotState === "copying"}
            title="Copy the complete logical Workspace tab as an image"
          >
            {screenshotState === "copying"
              ? "Copying…"
              : screenshotState === "copied"
                ? "Copied"
                : screenshotState === "failed"
                  ? "Copy failed"
                  : "Screenshot"}
          </button>
          <button type="button" onClick={onOpenPanelsMenu}>
            + New Panel
          </button>
        </div>
      </div>

      <div
        className={`workspace-canvas__surface ${panState ? "workspace-canvas__surface--panning" : ""}`}
        ref={surfaceRef}
        style={{
          "--workspace-canvas-scale": canvasScale,
        } as React.CSSProperties}
        onPointerDownCapture={beginCanvasPan}
      >
        <div
          className="workspace-canvas__world"
          style={{
            "--workspace-camera-pad-x": `${cameraViewportSize.width}px`,
            "--workspace-camera-pad-y": `${cameraViewportSize.height}px`,
            "--workspace-scaled-canvas-width":
              `${effectiveBounds.width * canvasScale}px`,
            "--workspace-scaled-canvas-height":
              `${effectiveBounds.height * canvasScale}px`,
          } as React.CSSProperties}
        >
        <div
          className="workspace-canvas__logical"
          ref={logicalRef}
          style={{
            "--workspace-canvas-width": `${effectiveBounds.width}px`,
            "--workspace-canvas-height": `${effectiveBounds.height}px`,
            "--workspace-grid-size": `${preferences.gridSize}px`,
          } as React.CSSProperties}
        >
          <div
            className="workspace-canvas__contents"
            style={{
              "--workspace-canvas-origin-x": `${effectiveBounds.x}px`,
              "--workspace-canvas-origin-y": `${effectiveBounds.y}px`,
            } as React.CSSProperties}
          >
          {panels.map((panel) => (
            <PanelFrame
              key={panel.id}
              registry={registry}
              panel={panel}
              canvasSurfaceRef={surfaceRef}
              canvasScale={canvasScale}
              preferences={preferences}
              modules={modules}
              fileOperationClipboard={fileOperationClipboard}
              setFileOperationClipboard={setFileOperationClipboard}
              onFocus={(_panelId, navigation = "none") =>
                focusPanel(panel, navigation)
              }
              onClose={onClosePanel}
              onToggleMinimized={onTogglePanelMinimized}
              onGeometryChange={onGeometryChange}
              onPanelStateChange={onPanelStateChange}
              onPanelViewPreferencesChange={onPanelViewPreferencesChange}
              onPreferencesChange={onPreferencesChange}
              onOpenPanel={onOpenPanel}
              onOpenResource={onOpenResource}
            />
          ))}
          </div>

          {panels.length === 0 ? (
            <div className="workspace-empty">
              <strong>No panels in this tab</strong>
              <span>Add a registered panel from the toolbar.</span>
            </div>
          ) : null}

          <span
            className="workspace-canvas__resize-handle workspace-canvas__resize-handle--right"
            aria-hidden="true"
            onPointerDown={(event) => beginCanvasResize(event, "right")}
          />
          <span
            className="workspace-canvas__resize-handle workspace-canvas__resize-handle--left"
            aria-hidden="true"
            onPointerDown={(event) => beginCanvasResize(event, "left")}
          />
          <span
            className="workspace-canvas__resize-handle workspace-canvas__resize-handle--top"
            aria-hidden="true"
            onPointerDown={(event) => beginCanvasResize(event, "top")}
          />
          <span
            className="workspace-canvas__resize-handle workspace-canvas__resize-handle--bottom"
            aria-hidden="true"
            onPointerDown={(event) => beginCanvasResize(event, "bottom")}
          />
          <span
            className="workspace-canvas__resize-handle workspace-canvas__resize-handle--corner"
            aria-hidden="true"
            onPointerDown={(event) => beginCanvasResize(event, "both")}
          />
        </div>
        </div>
      </div>
    </section>
  );
}
