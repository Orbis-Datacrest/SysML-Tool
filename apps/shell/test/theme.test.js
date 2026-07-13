import assert from "node:assert/strict";
import test from "node:test";
import { applyTheme, normalizeTheme } from "../src/app/browser.js";

test("theme values are normalized and persisted on the document root", () => {
  const root = { dataset: {} };
  const saved = new Map();
  const storage = { setItem: (key, value) => saved.set(key, value) };

  applyTheme("light", root, storage);
  assert.equal(root.dataset.theme, "light");
  assert.equal(saved.get("sysml.theme"), "light");

  applyTheme("unsupported", root, storage);
  assert.equal(root.dataset.theme, "dark");
  assert.equal(saved.get("sysml.theme"), "dark");
  assert.equal(normalizeTheme(null), "dark");
});
