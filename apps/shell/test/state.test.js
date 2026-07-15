import assert from "node:assert/strict";
import test from "node:test";
import { activateDiagramTab, createInitialState, rememberActiveTabState, resetEditorInteractionState } from "../src/app/state.js";

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

test("diagram tabs restore independent viewport, history, and selection state", () => {
  const state = createInitialState({ getItem: () => null }, () => ({ matches: true }));
  const first = { id: "one", elements: [], relationships: [] };
  const second = { id: "two", elements: [], relationships: [] };
  Object.assign(state, { diagram: first, diagrams: [first, second], canvasViewport: { zoom: 2, scrollLeft: 40, scrollTop: 60 }, history: [{ id: "old" }], selectedElementIds: ["node-1"] });
  rememberActiveTabState(state);
  activateDiagramTab(state, second);
  state.canvasViewport = { zoom: .5, scrollLeft: 10, scrollTop: 20 };
  state.selectedElementIds = ["node-2"];
  activateDiagramTab(state, first);

  assert.deepEqual(state.canvasViewport, { zoom: 2, scrollLeft: 40, scrollTop: 60 });
  assert.deepEqual(state.history, [{ id: "old" }]);
  assert.deepEqual(state.selectedElementIds, ["node-1"]);
  assert.deepEqual(state.tabStates.two.viewport, { zoom: .5, scrollLeft: 10, scrollTop: 20 });
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
