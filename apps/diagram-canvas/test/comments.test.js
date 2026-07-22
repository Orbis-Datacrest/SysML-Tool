import test from "node:test";
import assert from "node:assert/strict";
import { buildCommentThreads, commentAnchor, commentToolCanWrite, floatingCommentPosition } from "../src/comments/commentState.js";
import { CommentPin, CommentThread } from "../src/comments/commentComponents.js";

const permissions = { reply: true, edit: true, delete: true, resolve: true, reopen: true };
const root = (overrides = {}) => ({ id: "root", thread_id: "root", anchor_type: "element", anchor_id: "class_1", parent_id: null, body: "Please rename @designer@example.com", status: "open", author: "owner@example.com", created_by: "owner", created_at: "2026-01-01T10:00:00.000Z", updated_at: "2026-01-01T10:00:00.000Z", unread: true, permissions, ...overrides });

test("comment threads group replies and pins open comment state rather than model focus", () => {
  const reply = root({ id: "reply", parent_id: "root", body: "Done", author: "editor@example.com", created_at: "2026-01-01T10:01:00.000Z", updated_at: "2026-01-01T10:01:00.000Z" });
  const [thread] = buildCommentThreads([root(), reply]);
  assert.equal(thread.replies[0].id, "reply");
  assert.equal(thread.unread, true);
  const pin = CommentPin({ thread });
  assert.match(pin, /data-comment-thread="root"/);
  assert.doesNotMatch(pin, /data-focus-node/);
});

test("element and canvas comment anchors remain in diagram coordinates", () => {
  const elementThread = buildCommentThreads([root()])[0];
  assert.deepEqual(commentAnchor(elementThread, [{ id: "class_1", x: 120, y: 80, width: 200, height: 100 }]), { x: 312, y: 72, type: "element", elementId: "class_1" });
  const canvasThread = buildCommentThreads([root({ anchor_type: "canvas", anchor_id: "canvas:400:300", anchor_x: 400, anchor_y: 300 })])[0];
  assert.deepEqual(commentAnchor(canvasThread, []), { x: 400, y: 300, type: "canvas" });
});

test("thread popovers track pan and zoom and stay clamped inside the canvas viewport", () => {
  const hostRect = { left: 100, top: 50, right: 1100, bottom: 750 };
  const initial = floatingCommentPosition({ anchor: { x: 300, y: 200 }, hostRect, scrollLeft: 0, scrollTop: 0, zoom: 1, width: 320, height: 360 });
  const transformed = floatingCommentPosition({ anchor: { x: 300, y: 200 }, hostRect, scrollLeft: 200, scrollTop: 100, zoom: 2, width: 320, height: 360 });
  assert.notDeepEqual(transformed, initial);
  assert.ok(transformed.left >= hostRect.left + 8 && transformed.left <= hostRect.right - 328);
  assert.ok(transformed.top >= hostRect.top + 8 && transformed.top <= hostRect.bottom - 368);
});

test("thread actions and resolved state reflect server permissions", () => {
  const thread = buildCommentThreads([root({ status: "resolved", permissions: { ...permissions, edit: false, delete: false, resolve: false, reopen: true } })])[0];
  const markup = CommentThread({ thread });
  assert.match(markup, /data-comment-action="reopen"/);
  assert.match(markup, /data-comment-copy-link/);
  assert.match(markup, /data-comment-mark-unread/);
  assert.doesNotMatch(markup, /data-comment-edit/);
  assert.equal(commentToolCanWrite({ permissions: ["read", "comment"] }), true);
  assert.equal(commentToolCanWrite({ permissions: ["read"] }), false);
});
