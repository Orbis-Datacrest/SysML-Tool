export const SIDEBAR_LAYOUT_STORAGE_KEY = "sysml.sidebarLayout";

export const SIDEBAR_CONSTRAINTS = Object.freeze({
  left: Object.freeze({ minimum: 240, maximum: 420, defaultWidth: 300 }),
  right: Object.freeze({ minimum: 280, maximum: 480, defaultWidth: 360 }),
  collapsedWidth: 36,
  minimumCanvasWidth: 360
});

function finiteWidth(value, fallback) {
  const width = Number(value);
  return Number.isFinite(width) ? width : fallback;
}

export function clampSidebarWidth(side, width, workspaceWidth = Infinity, layout) {
  const constraint = SIDEBAR_CONSTRAINTS[side];
  const opposite = side === "left" ? "right" : "left";
  const oppositeWidth = layout?.[opposite]?.open
    ? finiteWidth(layout[opposite].width, SIDEBAR_CONSTRAINTS[opposite].defaultWidth)
    : SIDEBAR_CONSTRAINTS.collapsedWidth;
  const availableMaximum = Number.isFinite(workspaceWidth)
    ? workspaceWidth - SIDEBAR_CONSTRAINTS.minimumCanvasWidth - oppositeWidth
    : constraint.maximum;
  const maximum = Math.max(constraint.minimum, Math.min(constraint.maximum, availableMaximum));
  return Math.round(Math.max(constraint.minimum, Math.min(maximum, finiteWidth(width, constraint.defaultWidth))));
}

export function createSidebarLayout(storage, defaultLeftOpen = true) {
  let saved = null;
  try { saved = JSON.parse(storage?.getItem(SIDEBAR_LAYOUT_STORAGE_KEY) ?? "null"); } catch { saved = null; }
  const layout = {
    left: { open: saved?.left?.open ?? defaultLeftOpen, width: finiteWidth(saved?.left?.width, SIDEBAR_CONSTRAINTS.left.defaultWidth) },
    right: { open: saved?.right?.open ?? false, width: finiteWidth(saved?.right?.width, SIDEBAR_CONSTRAINTS.right.defaultWidth) }
  };
  layout.left.width = clampSidebarWidth("left", layout.left.width, Infinity, layout);
  layout.right.width = clampSidebarWidth("right", layout.right.width, Infinity, layout);
  return layout;
}

export function persistSidebarLayout(layout, storage = globalThis.localStorage) {
  try { storage?.setItem(SIDEBAR_LAYOUT_STORAGE_KEY, JSON.stringify(layout)); } catch { /* Storage may be unavailable in privacy-restricted contexts. */ }
}

export function nextRightPanelState(rightLayout, currentPanel, requestedPanel) {
  if (rightLayout.open && currentPanel === requestedPanel) return { panel: currentPanel, open: false };
  return { panel: requestedPanel, open: true };
}
