import assert from "node:assert/strict";
import test from "node:test";
import { createNodeRenderer } from "../src/rendering/createNodeRenderer.js";

const node = (overrides = {}) => ({
  id: "class_1",
  kind: "class",
  name: "Order",
  properties: {
    attributes: ["id: String"],
    operations: ["submit(): void"],
    responsibilities: ["Legacy responsibility"]
  },
  ...overrides
});

const compartmentCount = (html) => (html.match(/<section class="node-compartment/g) ?? []).length;

test("full class and block rendering contains attributes and operations but no responsibilities", () => {
  const render = createNodeRenderer({ getEditingNode: () => null });
  for (const kind of ["class", "block"]) {
    const html = render(node({ kind, variant: "full" }));
    assert.equal(compartmentCount(html), 2);
    assert.match(html, />Attributes</);
    assert.match(html, />Operations</);
    assert.doesNotMatch(html, /Responsibilities|Legacy responsibility/);
  }
});

test("legacy elements default to the full two-compartment structure without deleting old data", () => {
  const legacy = node();
  const html = createNodeRenderer({ getEditingNode: () => null })(legacy);
  assert.equal(compartmentCount(html), 2);
  assert.deepEqual(legacy.properties.responsibilities, ["Legacy responsibility"]);
  assert.doesNotMatch(html, /Legacy responsibility/);
});

test("simple class and block rendering exposes only the editable attributes compartment", () => {
  for (const kind of ["class", "block"]) {
    const simple = node({ kind, variant: "simple" });
    const html = createNodeRenderer({ getEditingNode: () => ({ id: simple.id, section: "attributes" }) })(simple);
    assert.equal(compartmentCount(html), 1);
    assert.match(html, /data-node-section="attributes"/);
    assert.doesNotMatch(html, />Operations|submit\(\): void|Responsibilities/);
  }
});

test("structured interface classes no longer render a third responsibility section", () => {
  const html = createNodeRenderer({ getEditingNode: () => null })(node({ kind: "interface-class" }));
  assert.match(html, /data-edit-section="attributes"/);
  assert.match(html, /data-edit-section="operations"/);
  assert.doesNotMatch(html, /Acting \/ Charge|Legacy responsibility/);
});
