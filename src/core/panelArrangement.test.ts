import { arrangedCanvasBounds, planPanelArrangement } from "./panelArrangement";
import type { PanelInstance, PanelGeometry } from "./types";

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

function panel(
  id: string,
  geometry: Partial<PanelGeometry>,
  minimized = false,
): PanelInstance {
  return {
    id,
    moduleId: "test",
    panelType: "test",
    title: id,
    geometry: { x: 0, y: 0, width: 400, height: 300, ...geometry },
    focusOrder: 1,
    stateVersion: 1,
    panelState: {},
    display: minimized ? { mode: "minimized" } : undefined,
    createdAt: "2026-10-17T00:00:00.000Z",
    updatedAt: "2026-10-17T00:00:00.000Z",
  };
}

function overlaps(a: PanelGeometry, b: PanelGeometry) {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

function makePanels(count: number) {
  return Array.from({ length: count }, (_, index) =>
    panel(`p${index}`, { x: index * 40, y: index * 40 }),
  );
}

function testFourPanelsFormEqualGridInsideViewport() {
  const viewport = { width: 1200, height: 800 };
  const panels = makePanels(4);
  const { scale, geometries } = planPanelArrangement({
    panels,
    viewport,
    origin: { x: 0, y: 0 },
    scale: 1,
  });
  const boxes = panels.map((item) => geometries.get(item.id)!);

  assertEqual(scale, 1, "roomy viewport keeps the current zoom");
  assertEqual(geometries.size, 4, "every visible panel is arranged");

  for (const box of boxes) {
    assertEqual(box.width, boxes[0].width, "panels share one width");
    assertEqual(box.height, boxes[0].height, "panels share one height");
    assert(
      box.x >= 0 && box.y >= 0 &&
        box.x + box.width <= viewport.width &&
        box.y + box.height <= viewport.height,
      "panels stay inside the viewport",
    );
  }

  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      assert(!overlaps(boxes[i], boxes[j]), "panels do not overlap");
    }
  }

  assertEqual(new Set(boxes.map((b) => b.x)).size, 2, "two columns");
  assertEqual(new Set(boxes.map((b) => b.y)).size, 2, "two rows");
}

function testOnlyPanelsInTheCurrentViewAreArranged() {
  const viewport = { width: 800, height: 600 };
  const visible = panel("visible", { x: 100, y: 100 });
  const offscreen = panel("offscreen", { x: 5000, y: 5000 });
  const { geometries } = planPanelArrangement({
    panels: [visible, offscreen],
    viewport,
    origin: { x: 0, y: 0 },
    scale: 1,
  });

  assertEqual(geometries.has("visible"), true, "visible panel is arranged");
  assertEqual(
    geometries.has("offscreen"),
    false,
    "panel outside the view is left where it is",
  );
}

function testViewOriginIsRespected() {
  const viewport = { width: 800, height: 600 };
  const panels = [panel("a", { x: 2000, y: 1500 })];
  const { geometries } = planPanelArrangement({
    panels,
    viewport,
    origin: { x: 1900, y: 1400 },
    scale: 1,
  });
  const geometry = geometries.get("a")!;

  assert(geometry.x >= 1900 && geometry.y >= 1400, "panel lands inside the view");
  assert(
    geometry.x + geometry.width <= 1900 + viewport.width &&
      geometry.y + geometry.height <= 1400 + viewport.height,
    "panel stays inside the view",
  );
}

function testMinimizedPanelsAreLeftAlone() {
  const panels = [
    panel("visible", { x: 0, y: 0 }),
    panel("hidden", { x: 100, y: 100 }, true),
  ];
  const { geometries } = planPanelArrangement({
    panels,
    viewport: { width: 800, height: 600 },
    origin: { x: 0, y: 0 },
    scale: 1,
  });

  assertEqual(geometries.has("hidden"), false, "minimized panel is not arranged");
  assertEqual(geometries.has("visible"), true, "visible panel is arranged");
}

function testSinglePanelFillsViewportMinusGutter() {
  const { geometries, scale } = planPanelArrangement({
    panels: [panel("only", {})],
    viewport: { width: 960, height: 600 },
    origin: { x: 0, y: 0 },
    scale: 1,
  });
  const geometry = geometries.get("only")!;

  assertEqual(scale, 1, "single panel keeps the current zoom");
  assertEqual(geometry.width, 936, "single panel width fills viewport");
  assertEqual(geometry.height, 576, "single panel height fills viewport");
}

function testSinglePanelAtLowZoomZoomsInToReadableSize() {
  const { geometries, scale } = planPanelArrangement({
    panels: [panel("only", {})],
    viewport: { width: 1900, height: 1000 },
    origin: { x: 0, y: 0 },
    scale: 0.25,
  });
  const geometry = geometries.get("only")!;

  assertEqual(scale, 1, "low zoom with one panel zooms in to 100%");
  assertEqual(geometry.width, 1872, "single panel fills viewport at 100%");
  assertEqual(geometry.height, 972, "single panel fills viewport at 100%");
}

function testCanvasBoundsFitViewAndArrangedPanels() {
  const viewport = { width: 1200, height: 800 };
  const arrangement = planPanelArrangement({
    panels: makePanels(4),
    viewport,
    origin: { x: 0, y: 0 },
    scale: 1,
  });
  const bounds = arrangedCanvasBounds(arrangement, viewport);

  assertEqual(bounds.x, 0, "bounds start at the view origin");
  assertEqual(bounds.y, 0, "bounds start at the view origin");
  assertEqual(bounds.width, 1200, "bounds are no wider than the view");
  assertEqual(bounds.height, 800, "bounds are no taller than the view");
}

function testCurrentZoomIsKeptWhenItFits() {
  const { scale } = planPanelArrangement({
    panels: makePanels(4),
    viewport: { width: 1200, height: 800 },
    origin: { x: 0, y: 0 },
    scale: 0.8,
  });

  assertEqual(scale, 0.8, "a zoom the user chose is not changed when it fits");
}

function testCrowdedViewportZoomsOutOnlyAsFarAsNeeded() {
  const { scale } = planPanelArrangement({
    panels: makePanels(12),
    viewport: { width: 900, height: 600 },
    origin: { x: 0, y: 0 },
    scale: 1,
  });

  assert(scale < 1, "crowded viewport zooms out so panels keep minimum size");
  assert(scale >= 0.75, "zoom never drops below the readable floor");
}

function testBrokenCameraDoesNotProduceNaNGeometry() {
  const { geometries, camera } = planPanelArrangement({
    panels: [panel("only", { x: 10, y: 10 })],
    viewport: { width: 960, height: 600 },
    origin: { x: NaN, y: Number.NaN },
    scale: 1,
  });
  const geometry = geometries.get("only")!;

  assertEqual(camera.x, 0, "NaN camera x falls back to 0");
  assertEqual(camera.y, 0, "NaN camera y falls back to 0");
  assert(
    Number.isFinite(geometry.x) && Number.isFinite(geometry.y),
    "panel position stays finite",
  );
}

function testNoVisiblePanelsChangesNothing() {
  const { scale, geometries } = planPanelArrangement({
    panels: [panel("far", { x: 9000, y: 9000 })],
    viewport: { width: 800, height: 600 },
    origin: { x: 0, y: 0 },
    scale: 0.9,
  });

  assertEqual(scale, 0.9, "no visible panels keeps the zoom");
  assertEqual(geometries.size, 0, "no visible panels, no geometry changes");
}

testFourPanelsFormEqualGridInsideViewport();
testOnlyPanelsInTheCurrentViewAreArranged();
testViewOriginIsRespected();
testMinimizedPanelsAreLeftAlone();
testSinglePanelFillsViewportMinusGutter();
testSinglePanelAtLowZoomZoomsInToReadableSize();
testCurrentZoomIsKeptWhenItFits();
testCanvasBoundsFitViewAndArrangedPanels();
testCrowdedViewportZoomsOutOnlyAsFarAsNeeded();
testBrokenCameraDoesNotProduceNaNGeometry();
testNoVisiblePanelsChangesNothing();

console.log("panel arrangement tests passed");
