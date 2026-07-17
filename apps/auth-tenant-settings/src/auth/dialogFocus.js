export const DIALOG_FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

export function trapTabKey(event, dialog, activeElement = document.activeElement) {
  if (event.key !== "Tab") return;

  const focusable = [...dialog.querySelectorAll(DIALOG_FOCUSABLE_SELECTOR)];
  const first = focusable[0];
  const last = focusable.at(-1);

  if (!first) {
    event.preventDefault();
    dialog.focus();
    return;
  }

  // Wrap keyboard focus at both ends so it cannot move behind the modal dialog.
  if (!dialog.contains(activeElement) || (event.shiftKey && activeElement === first) || (!event.shiftKey && activeElement === last)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}

export function keepFocusInDialog(event, dialog) {
  if (dialog.contains(event.target)) return;
  event.stopPropagation?.();
  const focusTarget = dialog.querySelector(DIALOG_FOCUSABLE_SELECTOR) ?? dialog;
  focusTarget.focus();
}
