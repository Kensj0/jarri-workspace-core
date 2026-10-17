export type PanelInteractionCapabilities = {
  localWheel?: boolean;
};

export const WORKSPACE_LOCAL_WHEEL_PANEL_ATTRIBUTE =
  "data-workspace-local-wheel";

export const WORKSPACE_LOCAL_WHEEL_SURFACE_ATTRIBUTE =
  "data-workspace-local-wheel-surface";

type ClosestCapableTarget = {
  closest?: (selector: string) => unknown;
};

function closest(target: unknown, selector: string): unknown {
  if (
    typeof target !== "object" ||
    target === null ||
    typeof (target as ClosestCapableTarget).closest !== "function"
  ) {
    return null;
  }

  return (target as ClosestCapableTarget).closest!(selector);
}

const WHEEL_LINE_HEIGHT_PX = 16;

export function wheelDeltaYInPixels(
  event: Pick<WheelEvent, "deltaY" | "deltaMode">,
  pageHeight: number,
): number {
  if (event.deltaMode === 1) {
    return event.deltaY * WHEEL_LINE_HEIGHT_PX;
  }

  if (event.deltaMode === 2) {
    return event.deltaY * pageHeight;
  }

  return event.deltaY;
}

export function canScrollInWheelDirection(
  element: { scrollTop: number; scrollHeight: number; clientHeight: number },
  deltaY: number,
): boolean {
  if (deltaY > 0) {
    return element.scrollTop + element.clientHeight < element.scrollHeight - 0.5;
  }

  if (deltaY < 0) {
    return element.scrollTop > 0.5;
  }

  return false;
}

export function shouldReserveLocalWheel(
  event: Pick<WheelEvent, "ctrlKey" | "target">,
): boolean {
  if (event.ctrlKey) {
    return false;
  }

  const surfaceSelector =
    `[${WORKSPACE_LOCAL_WHEEL_SURFACE_ATTRIBUTE}="true"]`;
  const panelSelector =
    `[${WORKSPACE_LOCAL_WHEEL_PANEL_ATTRIBUTE}="true"]`;

  const surface = closest(event.target, surfaceSelector);
  if (!surface) {
    return false;
  }

  return Boolean(closest(surface, panelSelector));
}
