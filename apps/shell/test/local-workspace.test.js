import assert from "node:assert/strict";
import test from "node:test";
import {
  LOCAL_HISTORY_LIMIT,
  LOCAL_WORKSPACE_KEY,
  createBlankWorkspace,
  loadLocalWorkspace,
  persistLocalWorkspace
} from "../src/app/localWorkspace.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    values
  };
}

test("a blank local workspace is immediately usable", () => {
  const workspace = createBlankWorkspace();
  assert.equal(workspace.project.name, "Untitled Project");
  assert.equal(workspace.diagrams.length, 1);
  assert.equal(workspace.activeDiagramId, workspace.diagrams[0].id);
});

test("workspace, viewport, undo and redo survive browser persistence", () => {
  const storage = memoryStorage();
  const blank = createBlankWorkspace();
  const current = { ...blank.diagrams[0], name: "Current" };
  const previous = { ...blank.diagrams[0], name: "Previous" };
  const state = {
    project: { ...blank.project, name: "Vehicle" },
    diagrams: [current],
    diagram: current,
    canvasViewport: { zoom: 1.5, scrollLeft: 20, scrollTop: 30 },
    tabStates: {},
    history: [previous],
    future: [current]
  };

  assert.equal(persistLocalWorkspace(state, storage), true);
  const restored = loadLocalWorkspace(storage);
  assert.equal(restored.project.name, "Vehicle");
  assert.equal(restored.history[0].name, "Previous");
  assert.equal(restored.future[0].name, "Current");
  assert.deepEqual(restored.canvasViewport, state.canvasViewport);
});

test("invalid storage falls back safely and history is bounded", () => {
  const invalid = memoryStorage({ [LOCAL_WORKSPACE_KEY]: "not json" });
  assert.equal(loadLocalWorkspace(invalid).diagrams.length, 1);

  const blank = createBlankWorkspace();
  const storage = memoryStorage();
  persistLocalWorkspace({
    project: blank.project, diagrams: blank.diagrams, diagram: blank.diagrams[0],
    canvasViewport: blank.canvasViewport, tabStates: {},
    history: Array.from({ length: LOCAL_HISTORY_LIMIT + 5 }, (_, index) => ({ index })),
    future: []
  }, storage);
  assert.equal(loadLocalWorkspace(storage).history.length, LOCAL_HISTORY_LIMIT);
});
