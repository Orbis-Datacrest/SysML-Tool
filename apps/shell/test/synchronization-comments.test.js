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
