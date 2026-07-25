import test from "node:test";
import assert from "node:assert/strict";
import { createSynchronizationService } from "../src/services/synchronizationService.js";

test("new comments, replies, resolutions, and deletions update shared collaboration state immediately", async () => {
  const events = [];
  const state = { project: { id: "project" }, diagram: { id: "diagram" }, collaboration: { comments: [] } };
  const api = {
    createComment: async (_projectId, input) => ({ comment: { id: "new", thread_id: input.parent_id || "new" }, comments: [{ id: "new", body: input.body }] }),
    updateComment: async (_projectId, id, input) => ({ comments: [{ id, status: input.action === "resolve" ? "resolved" : input.action === "delete" ? "deleted" : "open" }] })
  };
  const service = createSynchronizationService({ api, state, bus: { emit: (name) => events.push(name) } });
  const created = await service.addComment({ body: "Canvas note" });
  assert.equal(created.comment.thread_id, "new");
  assert.equal(state.collaboration.comments[0].body, "Canvas note");
  await service.updateComment("new", { action: "resolve" });
  assert.equal(state.collaboration.comments[0].status, "resolved");
  await service.updateComment("new", { action: "delete" });
  assert.equal(state.collaboration.comments[0].status, "deleted");
  assert.deepEqual(events, ["collaboration:changed", "collaboration:changed", "collaboration:changed"]);
});

test("unchanged collaboration polls do not rerender the canvas", async () => {
  const events = [];
  const payload = { role: "Editor", permissions: ["read", "comment", "edit"], comments: [], presence: [], notifications: [] };
  const state = { project: { id: "project" }, diagram: { id: "diagram" }, collaboration: { online: false, loading: true, error: "" } };
  const api = { collaborationState: async () => structuredClone(payload) };
  const service = createSynchronizationService({ api, state, bus: { emit: (name) => events.push(name) } });
  await service.refresh();
  await service.refresh();
  assert.deepEqual(events, ["collaboration:changed"]);
});

test("a newer shared diagram replaces a clean local diagram", async () => {
  const events = [];
  const remote = { id: "diagram", version: 3, elements: [{ id: "remote" }], relationships: [] };
  const state = {
    project: { id: "project" },
    diagram: { id: "diagram", version: 2, elements: [], relationships: [] },
    diagrams: [],
    dirtyTabIds: new Set(),
    collaboration: { online: false, loading: true, error: "" }
  };
  const api = { collaborationState: async () => ({ diagram: remote, role: "Editor", permissions: ["edit"], comments: [], presence: [] }) };
  const service = createSynchronizationService({ api, state, bus: { emit: (name) => events.push(name) } });
  await service.refresh();
  assert.equal(state.diagram.version, 3);
  assert.equal(state.diagram.elements[0].id, "remote");
  assert.deepEqual(events, ["diagram:remote", "diagram:changed", "collaboration:changed"]);
});

test("a newer shared diagram does not overwrite unsaved local work", async () => {
  const events = [];
  const state = {
    project: { id: "project" },
    diagram: { id: "diagram", version: 2, elements: [{ id: "local" }], relationships: [] },
    diagrams: [],
    dirtyTabIds: new Set(["diagram"]),
    collaboration: { online: false, loading: true, error: "" }
  };
  const api = { collaborationState: async () => ({ diagram: { id: "diagram", version: 3, elements: [], relationships: [] }, comments: [], presence: [] }) };
  const service = createSynchronizationService({ api, state, bus: { emit: (name) => events.push(name) } });
  await service.refresh();
  assert.equal(state.diagram.elements[0].id, "local");
  assert.equal(state.collaboration.conflict.remoteVersion, 3);
  assert.deepEqual(events, ["collaboration:conflict", "collaboration:changed"]);
});
