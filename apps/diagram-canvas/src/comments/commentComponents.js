const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" })[character]);
const initials = (author = "?") => author.split("@")[0].split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
const timestamp = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
};

function richText(body) {
  return escapeHtml(body).replace(/(^|\s)(@[\w.+-]+@[\w.-]+|@\w+)/g, "$1<mark>$2</mark>").replace(/\n/g, "<br>");
}

export function CommentPin({ thread }) {
  return `<button class="comment-pin ${thread.unread ? "unread" : ""} ${thread.resolved ? "resolved" : ""}" data-comment-thread="${escapeHtml(thread.id)}" aria-label="Open comment thread ${thread.number}${thread.unread ? ", unread" : ""}" aria-expanded="false"><span>${thread.number}</span></button>`;
}

export function CommentComposer({ body = "", error = "", loading = false, mode = "new" } = {}) {
  const label = mode === "reply" ? "Reply" : mode === "edit" ? "Edit comment" : "Add comment";
  return `<form class="comment-composer" data-comment-composer data-comment-mode="${mode}">
    <label>${label}<textarea data-comment-body maxlength="5000" rows="3" placeholder="Write a comment…">${escapeHtml(body)}</textarea></label>
    ${error ? `<p class="comment-error" role="alert">${escapeHtml(error)}</p>` : ""}
    <div class="comment-composer-actions"><button type="button" data-comment-cancel>Cancel</button><button class="primary" type="submit" ${loading ? "disabled" : ""}>${loading ? "Sending…" : mode === "edit" ? "Save" : "Post"}</button></div>
  </form>`;
}

function CommentEntry(comment, editing) {
  const deleted = comment.status === "deleted";
  return `<article class="comment-entry ${deleted ? "deleted" : ""}" data-comment-entry="${escapeHtml(comment.id)}">
    <span class="comment-avatar" aria-hidden="true">${escapeHtml(initials(comment.author))}</span>
    <div class="comment-entry-content"><header><strong>${escapeHtml(comment.author)}</strong><time datetime="${escapeHtml(comment.created_at)}">${escapeHtml(timestamp(comment.created_at))}</time>${comment.edited_at ? `<small>edited</small>` : ""}</header>
      ${editing?.id === comment.id ? CommentComposer({ body: editing.body, error: editing.error, loading: editing.loading, mode: "edit" }) : `<p>${richText(comment.body)}</p>`}
      ${!deleted && editing?.id !== comment.id ? `<div class="comment-entry-actions">${comment.permissions?.edit ? `<button type="button" data-comment-edit="${escapeHtml(comment.id)}">Edit</button>` : ""}${comment.permissions?.delete ? `<button type="button" data-comment-delete="${escapeHtml(comment.id)}">Delete</button>` : ""}</div>` : ""}
    </div>
  </article>`;
}

export function CommentThread({ thread, reply = {}, editing = null, loading = false, error = "" }) {
  const root = thread.root;
  return `<section class="comment-thread ${thread.resolved ? "resolved" : ""}" data-comment-thread-popover="${escapeHtml(thread.id)}" role="dialog" aria-label="Comment thread ${thread.number}">
    <header class="comment-thread-header"><div><strong>Comment ${thread.number}</strong>${thread.unread ? `<span class="comment-unread-label">Unread</span>` : ""}${thread.resolved ? `<span class="comment-resolved-label">Resolved</span>` : ""}</div><button type="button" data-comment-close aria-label="Close comment thread">×</button></header>
    <div class="comment-thread-actions"><button type="button" data-comment-copy-link>Copy link</button><button type="button" data-comment-mark-unread>Mark unread</button>${thread.resolved && root.permissions?.reopen ? `<button type="button" data-comment-action="reopen">Reopen</button>` : !thread.resolved && root.permissions?.resolve ? `<button type="button" data-comment-action="resolve">Resolve</button>` : ""}</div>
    <div class="comment-thread-list">${[root, ...thread.replies].map((comment) => CommentEntry(comment, editing)).join("")}</div>
    ${error ? `<p class="comment-error" role="alert">${escapeHtml(error)} <button type="button" data-comment-retry>Retry</button></p>` : ""}
    ${root.permissions?.reply && !thread.resolved ? CommentComposer({ body: reply.body, error: reply.error, loading: reply.loading || loading, mode: "reply" }) : ""}
  </section>`;
}
