import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState, resetEditorInteractionState } from "../src/app/state.js";

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
  assert.deepEqual(state.selectedTool, { type: "select", kind: null, label: "" });
  assert.deepEqual(state.modelRepository, { schema_version: 2, elements: [], relationships: [] });
});

test("editor interaction state resets from one synchronized transition", () => {
  const state = createInitialState({ getItem: () => null }, () => ({ matches: true }));
  Object.assign(state, {
    selectedElementIds: ["node-1"], selectedRelationshipId: "rel-1",
    selectedTool: { type: "relationship", kind: "dependency", label: "Dependency" },
    canvasViewport: { zoom: 2, scrollLeft: 100, scrollTop: 200 }, history: [{}], future: [{}]
  });

  resetEditorInteractionState(state);

  assert.deepEqual(state.selectedElementIds, []);
  assert.equal(state.selectedRelationshipId, null);
  assert.deepEqual(state.selectedTool, { type: "select", kind: null, label: "" });
  assert.deepEqual(state.canvasViewport, { zoom: 1, scrollLeft: 0, scrollTop: 0 });
  assert.deepEqual(state.history, []);
  assert.deepEqual(state.future, []);
});
