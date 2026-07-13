import assert from "node:assert/strict";
import test from "node:test";
import { trapTabKey } from "../src/auth/dialogFocus.js";

function focusTarget(name) {
  return { name, focusCount: 0, focus() { this.focusCount += 1; } };
}

function tabEvent(shiftKey = false) {
  return { key: "Tab", shiftKey, prevented: false, preventDefault() { this.prevented = true; } };
}

test("focus wraps forward and backward inside a dialog", () => {
  const first = focusTarget("first");
  const last = focusTarget("last");
  const dialog = {
    querySelectorAll: () => [first, last],
    contains: (target) => [first, last].includes(target)
  };

  const forward = tabEvent();
  trapTabKey(forward, dialog, last);
  assert.equal(forward.prevented, true);
  assert.equal(first.focusCount, 1);

  const backward = tabEvent(true);
  trapTabKey(backward, dialog, first);
  assert.equal(backward.prevented, true);
  assert.equal(last.focusCount, 1);
});

test("focus is brought back when it starts outside the dialog", () => {
  const first = focusTarget("first");
  const dialog = { querySelectorAll: () => [first], contains: () => false };
  const event = tabEvent();

  trapTabKey(event, dialog, focusTarget("outside"));

  assert.equal(event.prevented, true);
  assert.equal(first.focusCount, 1);
});
