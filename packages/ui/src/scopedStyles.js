let nextScopeId = 0;

function cssEscape(value) {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(String(value));
  return String(value).replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character.codePointAt(0).toString(16)} `);
}

function declarationText(declarations) {
  return Object.entries(declarations)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([property, value]) => `${property}:${value}`)
    .join(";");
}

/**
 * Keeps runtime geometry in a real stylesheet instead of adding style attributes
 * to application markup. The scope attribute prevents one mounted tool from
 * affecting another copy of the same tool.
 */
export function createScopedStyles(host, name = "runtime") {
  const scope = `${name}-${++nextScopeId}`;
  const styleElement = document.createElement("style");
  styleElement.dataset.scopedStyles = scope;
  host.dataset.styleScope = scope;
  document.head.append(styleElement);
  const rules = new Map();
  const prefix = `[data-style-scope="${cssEscape(scope)}"]`;

  return {
    set(key, selector, declarations) {
      const scopedSelector = selector.startsWith("&") ? selector.replace("&", prefix) : `${prefix} ${selector}`;
      rules.set(key, `${scopedSelector}{${declarationText(declarations)}}`);
    },
    delete(key) {
      rules.delete(key);
    },
    clear() {
      rules.clear();
    },
    commit() {
      styleElement.textContent = [...rules.values()].join("\n");
    },
    destroy() {
      styleElement.remove();
      delete host.dataset.styleScope;
    },
    escape: cssEscape
  };
}
