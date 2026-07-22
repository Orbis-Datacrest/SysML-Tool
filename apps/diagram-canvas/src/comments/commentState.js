export function buildCommentThreads(comments = []) {
  const roots = comments.filter((comment) => !comment.parent_id && comment.status !== "deleted");
  const replies = new Map();
  for (const comment of comments.filter((item) => item.parent_id)) {
    const threadId = comment.thread_id || comment.parent_id;
    if (!replies.has(threadId)) replies.set(threadId, []);
    replies.get(threadId).push(comment);
  }
  return roots.map((root, index) => ({
    id: root.id,
    number: index + 1,
    root,
    replies: (replies.get(root.id) ?? []).sort((a, b) => a.created_at.localeCompare(b.created_at)),
    unread: Boolean(root.unread || (replies.get(root.id) ?? []).some((item) => item.unread)),
    resolved: root.status === "resolved"
  }));
}

export function commentAnchor(thread, elements = []) {
  const root = thread?.root;
  if (!root) return null;
  if (root.anchor_type === "canvas") {
    const x = Number(root.anchor_x); const y = Number(root.anchor_y);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y, type: "canvas" } : null;
  }
  const node = elements.find((item) => item.id === root.anchor_id);
  return node ? { x: node.x + node.width - 8, y: node.y - 8, type: "element", elementId: node.id } : null;
}

export function floatingCommentPosition({ anchor, hostRect, scrollLeft, scrollTop, zoom, width = 320, height = 360 }) {
  if (!anchor || !hostRect) return null;
  const anchorX = hostRect.left + anchor.x * zoom - scrollLeft;
  const anchorY = hostRect.top + anchor.y * zoom - scrollTop;
  const spaceRight = hostRect.right - anchorX;
  const preferredLeft = spaceRight >= width + 32 ? anchorX + 22 : anchorX - width - 22;
  return {
    left: Math.max(hostRect.left + 8, Math.min(preferredLeft, hostRect.right - width - 8)),
    top: Math.max(hostRect.top + 8, Math.min(anchorY - 14, hostRect.bottom - height - 8))
  };
}

export function commentToolCanWrite(collaboration) {
  return Boolean(collaboration?.permissions?.includes("comment"));
}
