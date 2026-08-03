import test from "node:test";
import assert from "node:assert/strict";
import { defaultNodeStyle, defaultRelationshipLabel, defaultRelationshipStyle, relationshipTypes, themeNodeStyles, visibleRelationshipLabel } from "../src/config/canvasConfig.js";

test("ordinary UML relationships do not receive palette names as diagram labels", () => {
  assert.equal(defaultRelationshipLabel("generalization"), "");
  assert.equal(visibleRelationshipLabel({ kind: "composition", label: "Composition" }), "");
  assert.equal(visibleRelationshipLabel({ kind: "association", label: "owns" }), "owns");
});

test("stereotyped relationships retain their UML notation labels", () => {
  assert.equal(defaultRelationshipLabel("include"), "«include»");
  assert.equal(defaultRelationshipLabel("derive-reqt"), "«deriveReqt»");
});

test("assembly connectors are available as a relationship type", () => {
  assert.deepEqual(relationshipTypes.find(([kind]) => kind === "connector"), ["connector", "Connector"]);
});

test("dark canvas element and relationship text defaults to white", () => {
  assert.equal(defaultNodeStyle.textColor, "#ffffff");
  assert.equal(themeNodeStyles.dark.textColor, "#ffffff");
  assert.equal(defaultRelationshipStyle.textColor, "#ffffff");
});
