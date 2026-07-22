import assert from "node:assert/strict";
import test from "node:test";
import { SIDEBAR_CONSTRAINTS, SIDEBAR_LAYOUT_STORAGE_KEY, clampSidebarWidth, createSidebarLayout, nextRightPanelState, persistSidebarLayout } from "../src/app/sidebarLayout.js";

test("collapsed sidebars reserve no canvas width because their expand controls float", () => {
  assert.equal(SIDEBAR_CONSTRAINTS.collapsedWidth, 0);
});

test("sidebar widths are restored and clamped to usable limits", () => {
  const storage = { getItem: () => JSON.stringify({ left: { open: false, width: 12 }, right: { open: true, width: 900 } }) };
  assert.deepEqual(createSidebarLayout(storage), {
    left: { open: false, width: 240 },
    right: { open: true, width: 480 }
  });
});

test("sidebar width leaves room for the canvas and opposite rail", () => {
  const layout = { left: { open: true, width: 300 }, right: { open: true, width: 320 } };
  assert.equal(clampSidebarWidth("left", 420, 1000, layout), 320);
  layout.right.open = false;
  assert.equal(clampSidebarWidth("left", 420, 1000, layout), 420);
});

test("sidebar layout persistence uses one shared state record", () => {
  const writes = new Map();
  const layout = { left: { open: true, width: 312 }, right: { open: false, width: 360 } };
  persistSidebarLayout(layout, { setItem: (key, value) => writes.set(key, value) });
  assert.deepEqual(JSON.parse(writes.get(SIDEBAR_LAYOUT_STORAGE_KEY)), layout);
});

test("AI and History replace or toggle the shared right panel", () => {
  assert.deepEqual(nextRightPanelState({ open: true }, "advisor", "history"), { panel: "history", open: true });
  assert.deepEqual(nextRightPanelState({ open: true }, "history", "history"), { panel: "history", open: false });
  assert.deepEqual(nextRightPanelState({ open: false }, "history", "advisor"), { panel: "advisor", open: true });
});
