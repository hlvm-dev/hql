export interface OverlayPadding {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface OverlayChromeSpec {
  padding: OverlayPadding;
  bodyHeaderRows: number;
  footerRows?: number;
}

export interface FixedOverlayChromeSpec extends OverlayChromeSpec {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
}

export interface OverlayChromeLayout {
  contentStart: number;
  footerY: number;
  visibleRows: number;
}

export const COMMAND_PALETTE_OVERLAY_SPEC: FixedOverlayChromeSpec = {
  width: 58,
  height: 24,
  minWidth: 40,
  minHeight: 12,
  padding: { top: 2, bottom: 2, left: 4, right: 4 },
  bodyHeaderRows: 3,
  footerRows: 1,
};

export const CONFIG_OVERLAY_SPEC: FixedOverlayChromeSpec = {
  width: 68,
  height: 13,
  minWidth: 48,
  minHeight: 12,
  padding: { top: 1, bottom: 1, left: 3, right: 3 },
  bodyHeaderRows: 1,
  footerRows: 1,
};

export const BACKGROUND_TASKS_OVERLAY_SPEC: FixedOverlayChromeSpec = {
  width: 60,
  height: 20,
  minWidth: 42,
  minHeight: 12,
  padding: { top: 1, bottom: 1, left: 2, right: 2 },
  bodyHeaderRows: 2,
  footerRows: 1,
};

export const SHORTCUTS_OVERLAY_SPEC: OverlayChromeSpec & { width: number } = {
  width: 58,
  padding: { top: 1, bottom: 1, left: 2, right: 2 },
  bodyHeaderRows: 2,
  footerRows: 1,
};

export function resolveOverlayChromeLayout(
  frameHeight: number,
  spec: OverlayChromeSpec,
): OverlayChromeLayout {
  const footerRows = spec.footerRows ?? 1;
  const contentStart = spec.padding.top + spec.bodyHeaderRows;
  const footerY = Math.max(
    contentStart,
    frameHeight - spec.padding.bottom - footerRows,
  );
  return {
    contentStart,
    footerY,
    visibleRows: Math.max(0, footerY - contentStart),
  };
}
