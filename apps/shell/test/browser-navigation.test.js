import assert from "node:assert/strict";
import test from "node:test";
import { rememberPage } from "../src/app/browser.js";

test("the current page, project, and per-project diagram tab are persisted", () => {
  const saved = new Map();
  const storage = { setItem: (key, value) => saved.set(key, value) };

  rememberPage("editor", "project-1", "diagram-2", storage);

  assert.equal(saved.get("sysml.activeView"), "editor");
  assert.equal(saved.get("sysml.activeProjectId"), "project-1");
  assert.equal(saved.get("sysml.activeDiagramId.project-1"), "diagram-2");
});
