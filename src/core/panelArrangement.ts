import { GRID_SIZE, snapToGrid, snapUpToGrid } from "./layoutEngine";
import type {
  PanelGeometry,
  PanelInstance,
  WorkspaceCanvasBounds,
} from "./types";

const DEFAULT_MIN_WIDTH = 260;
const DEFAULT_MIN_HEIGHT = 160;

// Zoom levels that may be used when the visible panels do not fit at the
// current zoom. Zoom only goes down, and never below the last step; if the
// panels still do not fit there, they are allowed to overflow.
const ARRANGE_SCALE_STEPS = [0.95, 0.9, 0.85, 0.8, 0.75];

// Panels look best as roughly 4:3 windows, so layouts closer to that win.
const TARGET_ASPECT = 4 / 3;

// Largest cell in canvas units that still shows panel text at a readable
// size. Bigger cells are shown at a higher zoom instead.
const MAX_CELL_WIDTH = 1200;
const MAX_CELL_HEIGHT = 900;

export type ArrangementViewport = {
  width: number;
  height: number;
};

export type PanelArrangement = {
  scale: number;
  camera: { x: number; y: number };
  geometries: Map<string, PanelGeometry>;
};

function finiteOr(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

type GridLayout = {
  columns: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
};

function snapDownToGrid(value: number) {
  return Math.floor(value / GRID_SIZE) * GRID_SIZE;
}

function aspectFit(width: number, height: number) {
  const aspect = width / height;
  return Math.min(aspect / TARGET_ASPECT, TARGET_ASPECT / aspect);
}

// Returns the zoom that brings the layout's cells down to the readable size,
// never above 100% and never below the zoom it already has.
function readableZoom(zoom: number, layout: GridLayout) {
  const factor = Math.max(
    layout.cellWidth / MAX_CELL_WIDTH,
    layout.cellHeight / MAX_CELL_HEIGHT,
  );
  return factor > 1 ? Math.min(1, zoom * factor) : zoom;
}

// Picks the grid with the best combination of large cells and a pleasant
// cell shape, while every cell still meets the minimum panel size.
function chooseGridLayout(
  count: number,
  area: WorkspaceCanvasBounds,
  gap: number,
  minWidth: number,
  minHeight: number,
): GridLayout | null {
  let best: GridLayout | null = null;
  let bestScore = -1;

  for (let columns = 1; columns <= count; columns += 1) {
    const rows = Math.ceil(count / columns);
    const cellWidth = snapDownToGrid(
      (area.width - gap * (columns + 1)) / columns,
    );
    const cellHeight = snapDownToGrid(
      (area.height - gap * (rows + 1)) / rows,
    );

    if (cellWidth < minWidth || cellHeight < minHeight) {
      continue;
    }

    const score =
      cellWidth * cellHeight * aspectFit(cellWidth, cellHeight);
    // Ties go to more columns, which reads as a wider, tidier layout.
    if (score >= bestScore) {
      best = { columns, rows, cellWidth, cellHeight };
      bestScore = score;
    }
  }

  return best;
}

// Used only when even the smallest zoom cannot fit the minimum sizes.
function overflowGridLayout(
  count: number,
  minWidth: number,
  minHeight: number,
): GridLayout {
  const columns = Math.ceil(Math.sqrt(count));
  return {
    columns,
    rows: Math.ceil(count / columns),
    cellWidth: minWidth,
    cellHeight: minHeight,
  };
}

function placeGrid(
  panels: PanelInstance[],
  layout: GridLayout,
  area: WorkspaceCanvasBounds,
  gap: number,
): Map<string, PanelGeometry> {
  const geometries = new Map<string, PanelGeometry>();
  const { columns, rows, cellWidth, cellHeight } = layout;

  const gridWidth = columns * cellWidth + (columns - 1) * gap;
  const gridHeight = rows * cellHeight + (rows - 1) * gap;
  const gridLeft = area.x + (area.width - gridWidth) / 2;
  const gridTop = area.y + (area.height - gridHeight) / 2;

  panels.forEach((panel, index) => {
    const row = Math.floor(index / columns);
    const itemsInRow = Math.min(columns, panels.length - row * columns);
    // A partial last row is centred under the grid instead of left-aligned.
    const rowInset = ((columns - itemsInRow) * (cellWidth + gap)) / 2;
    const column = index % columns;

    geometries.set(panel.id, {
      x: Math.max(
        0,
        snapToGrid(gridLeft + rowInset + column * (cellWidth + gap)),
      ),
      y: Math.max(0, snapToGrid(gridTop + row * (cellHeight + gap))),
      width: cellWidth,
      height: cellHeight,
      minWidth: panel.geometry.minWidth,
      minHeight: panel.geometry.minHeight,
    });
  });

  return geometries;
}

/**
 * Plans an equal-size, grid-aligned arrangement of the panels that are
 * visible in the current view. Panels outside the view and minimized panels
 * are left where they are.
 *
 * The current zoom is kept whenever the panels fit their minimum sizes. Only
 * when they do not is the zoom stepped down, never below the readable floor.
 * Panels keep their relative order (top-to-bottom, then left-to-right).
 *
 * `viewport` is in screen pixels, `origin` is the logical top-left corner of
 * the view and `scale` is the tab's current canvas scale.
 */
export function planPanelArrangement({
  panels,
  viewport,
  origin,
  scale,
  gap = GRID_SIZE,
}: {
  panels: PanelInstance[];
  viewport: ArrangementViewport;
  origin: { x: number; y: number };
  scale: number;
  gap?: number;
}): PanelArrangement {
  // A broken camera (NaN or missing) would put every panel at NaN, so the
  // arrangement always starts from a valid origin.
  const camera = {
    x: finiteOr(origin.x, 0),
    y: finiteOr(origin.y, 0),
  };
  const currentScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const unchanged: PanelArrangement = {
    scale: currentScale,
    camera,
    geometries: new Map(),
  };

  if (viewport.width <= 0 || viewport.height <= 0) {
    return unchanged;
  }

  const areaAt = (zoom: number): WorkspaceCanvasBounds => ({
    x: camera.x,
    y: camera.y,
    width: viewport.width / zoom,
    height: viewport.height / zoom,
  });

  const visibleArea = areaAt(currentScale);
  const targets = panels
    .filter(
      (panel) =>
        panel.display?.mode !== "minimized" &&
        overlapsArea(panel.geometry, visibleArea),
    )
    .sort((a, b) => a.geometry.y - b.geometry.y || a.geometry.x - b.geometry.x);

  if (targets.length === 0) {
    return unchanged;
  }

  const minWidth = Math.max(
    ...targets.map((panel) =>
      snapUpToGrid(panel.geometry.minWidth ?? DEFAULT_MIN_WIDTH),
    ),
  );
  const minHeight = Math.max(
    ...targets.map((panel) =>
      snapUpToGrid(panel.geometry.minHeight ?? DEFAULT_MIN_HEIGHT),
    ),
  );

  const candidates = [
    currentScale,
    ...ARRANGE_SCALE_STEPS.filter((zoom) => zoom < currentScale),
  ];

  for (const zoom of candidates) {
    const area = areaAt(zoom);
    const layout = chooseGridLayout(
      targets.length,
      area,
      gap,
      minWidth,
      minHeight,
    );

    if (layout) {
      // Big cells at a low zoom make the panel content tiny, so zoom in
      // until the cells are no larger than a readable panel.
      const readable = readableZoom(zoom, layout);
      const readableLayout =
        readable > zoom
          ? chooseGridLayout(
              targets.length,
              areaAt(readable),
              gap,
              minWidth,
              minHeight,
            )
          : null;

      if (readableLayout) {
        return {
          scale: readable,
          camera,
          geometries: placeGrid(
            targets,
            readableLayout,
            areaAt(readable),
            gap,
          ),
        };
      }

      return {
        scale: zoom,
        camera,
        geometries: placeGrid(targets, layout, area, gap),
      };
    }
  }

  const lowestZoom = candidates[candidates.length - 1];
  return {
    scale: lowestZoom,
    camera,
    geometries: placeGrid(
      targets,
      overflowGridLayout(targets.length, minWidth, minHeight),
      areaAt(lowestZoom),
      gap,
    ),
  };
}

/**
 * The canvas area that fits an arrangement: the visible area at the planned
 * zoom together with every arranged panel. Used as the grey canvas field so it
 * does not keep the size it grew to while panels were spread out.
 */
export function arrangedCanvasBounds(
  arrangement: PanelArrangement,
  viewport: ArrangementViewport,
): WorkspaceCanvasBounds {
  const boxes: WorkspaceCanvasBounds[] = [
    {
      x: arrangement.camera.x,
      y: arrangement.camera.y,
      width: viewport.width / arrangement.scale,
      height: viewport.height / arrangement.scale,
    },
    ...arrangement.geometries.values(),
  ];

  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));

  return { x: left, y: top, width: right - left, height: bottom - top };
}

function overlapsArea(geometry: PanelGeometry, area: WorkspaceCanvasBounds) {
  return (
    geometry.x < area.x + area.width &&
    geometry.x + geometry.width > area.x &&
    geometry.y < area.y + area.height &&
    geometry.y + geometry.height > area.y
  );
}
