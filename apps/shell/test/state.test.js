import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../src/app/state.js";

test("initial shell state restores persisted authentication and display preferences", () => {
  const values = new Map([
    ["sysml.authToken", "access"],
    ["sysml.refreshToken", "refresh"],
    ["sysml.theme", "light"]
  ]);
  const state = createInitialState({ getItem: (key) => values.get(key) ?? null }, () => ({ matches: true }));

  assert.equal(state.authToken, "access");
  assert.equal(state.refreshToken, "refresh");
  assert.equal(state.settings.theme, "light");
  assert.deepEqual(state.sidebarLayout, {
    left: { open: true, width: 300 },
    right: { open: false, width: 360 }
  });
  assert.equal(state.rightPanel, "advisor");
  assert.equal(state.selectedHistoryVersion, "current");
  assert.deepEqual(state.canvasViewport, { zoom: 1, scrollLeft: 0, scrollTop: 0 });
  assert.deepEqual(state.modelRepository, { schema_version: 2, elements: [], relationships: [] });
});
