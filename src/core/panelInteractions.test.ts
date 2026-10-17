import {
  canScrollInWheelDirection,
  shouldReserveLocalWheel,
  wheelDeltaYInPixels,
  WORKSPACE_LOCAL_WHEEL_PANEL_ATTRIBUTE,
  WORKSPACE_LOCAL_WHEEL_SURFACE_ATTRIBUTE,
} from "./panelInteractions";

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${String(expected)}, got ${String(actual)}`,
    );
  }
}

const surfaceSelector =
  `[${WORKSPACE_LOCAL_WHEEL_SURFACE_ATTRIBUTE}="true"]`;
const panelSelector =
  `[${WORKSPACE_LOCAL_WHEEL_PANEL_ATTRIBUTE}="true"]`;

const ownedSurface = {
  closest(selector: string) {
    return selector === panelSelector ? { panel: true } : null;
  },
};

const nestedInOwnedSurface = {
  closest(selector: string) {
    return selector === surfaceSelector ? ownedSurface : null;
  },
};

const ordinaryPanelContent = {
  closest() {
    return null;
  },
};

const unownedSurface = {
  closest(selector: string) {
    if (selector === surfaceSelector) {
      return {
        closest() {
          return null;
        },
      };
    }

    return null;
  },
};

assertEqual(
  shouldReserveLocalWheel({
    ctrlKey: false,
    target: nestedInOwnedSurface as unknown as EventTarget,
  }),
  true,
  "plain wheel inside opted-in local wheel surface is reserved",
);

assertEqual(
  shouldReserveLocalWheel({
    ctrlKey: true,
    target: nestedInOwnedSurface as unknown as EventTarget,
  }),
  false,
  "Ctrl+wheel is not claimed by local wheel ownership",
);

assertEqual(
  shouldReserveLocalWheel({
    ctrlKey: false,
    target: ordinaryPanelContent as unknown as EventTarget,
  }),
  false,
  "wheel outside local wheel surface is not reserved",
);

assertEqual(
  shouldReserveLocalWheel({
    ctrlKey: false,
    target: unownedSurface as unknown as EventTarget,
  }),
  false,
  "local wheel surface requires opted-in panel ownership",
);

assertEqual(
  shouldReserveLocalWheel({
    ctrlKey: false,
    target: null,
  }),
  false,
  "missing target is not reserved",
);

const atTop = { scrollTop: 0, scrollHeight: 500, clientHeight: 200 };
const atBottom = { scrollTop: 300, scrollHeight: 500, clientHeight: 200 };
const middle = { scrollTop: 100, scrollHeight: 500, clientHeight: 200 };

assertEqual(
  canScrollInWheelDirection(atTop, 40),
  true,
  "downward wheel can scroll when not at bottom",
);

assertEqual(
  canScrollInWheelDirection(atTop, -40),
  false,
  "upward wheel cannot scroll at top",
);

assertEqual(
  canScrollInWheelDirection(atBottom, 40),
  false,
  "downward wheel cannot scroll at bottom",
);

assertEqual(
  canScrollInWheelDirection(middle, -40),
  true,
  "upward wheel can scroll when not at top",
);

assertEqual(
  canScrollInWheelDirection(middle, 0),
  false,
  "zero delta does not scroll",
);

assertEqual(
  wheelDeltaYInPixels({ deltaY: 3, deltaMode: 1 }, 200),
  48,
  "line delta is converted to pixels",
);

assertEqual(
  wheelDeltaYInPixels({ deltaY: 1, deltaMode: 2 }, 200),
  200,
  "page delta uses the scroller height",
);

assertEqual(
  wheelDeltaYInPixels({ deltaY: 120, deltaMode: 0 }, 200),
  120,
  "pixel delta is passed through",
);

console.log("workspace panel interaction tests passed");
