const node = (kind, label, shape = kind) => ({ type: "node", kind, label, shape });
const relationship = (kind, label, shape = kind) => ({ type: "relationship", kind, label, shape });

export const commonElements = [
  node("diagram-frame", "Diagram Frame", "frame"),
  node("note", "Note / Comment", "note"),
  relationship("note-connector", "Anchor Link", "dashed-line"),
  node("constraint", "Constraint {expression}", "constraint"),
  node("package", "Package", "package"),
  relationship("dependency", "Dependency", "dependency")
];

const definitions = [
  ["UML", "Structural", "uml-class", "Class Diagram", [
    node("class", "Class"), node("compact-class", "Class 2"), node("interface-class", "Interface Class"),
    node("interface", "Interface"), node("template-class", "Template Class"), node("component", "Component"),
    node("nary-association", "N-ary Association"), node("object", "Object 1"), node("object-compact", "Object 2"),
    node("divider-vertical", "Divider (Vertical)"), node("self-association", "Self Association"),
    node("frame-fragment", "Frame / Fragment"), node("callout", "Callout"), node("text-label", "Text Label"),
    node("symbol-braces", "Symbol { }"), node("symbol-guillemets", "Symbol << >>"),
    relationship("generalization", "Generalization"),
    relationship("association", "Association"), relationship("aggregation", "Aggregation"), relationship("composition", "Composition")
  ]],
  ["UML", "Structural", "uml-object", "Object Diagram", [
    node("instance-specification", "Instance Specification", "object"), node("slot", "Slot"), relationship("link", "Link")
  ]],
  ["UML", "Structural", "uml-component", "Component Diagram", [
    node("component", "Component"), node("provided-interface", "Provided Interface"), node("required-interface", "Required Interface"), node("port", "Port")
  ]],
  ["UML", "Structural", "uml-deployment", "Deployment Diagram", [
    node("node", "Node", "deployment-node"), node("artifact", "Artifact"), relationship("communication-path", "Communication Path")
  ]],
  ["UML", "Structural", "uml-package", "Package Diagram", [
    node("import", "Package Import", "package-import"), relationship("package-merge", "Package Merge")
  ]],
  ["UML", "Structural", "uml-composite-structure", "Composite Structure Diagram", [
    node("part", "Part"), relationship("connector", "Connector"), node("collaboration", "Collaboration")
  ]],
  ["UML", "Structural", "uml-profile", "Profile Diagram", [
    node("stereotype", "Stereotype"), relationship("extension", "Extension")
  ]],
  ["UML", "Behavioral", "uml-use-case", "Use Case Diagram", [
    node("actor", "Actor"), node("use-case", "Use Case"), relationship("include", "Include"), relationship("extend", "Extend"), node("system-boundary", "System Boundary")
  ]],
  ["UML", "Behavioral", "uml-activity", "Activity Diagram", [
    node("action", "Action"), relationship("control-flow", "Control Flow"), relationship("object-flow", "Object Flow"), node("initial-node", "Initial Node"),
    node("activity-final", "Final Node"), node("decision", "Decision / Merge"), node("fork-join", "Fork / Join"), node("activity-partition", "Swimlane")
  ]],
  ["UML", "Behavioral", "uml-sequence", "Sequence Diagram", [
    node("lifeline", "Lifeline"), node("activation", "Activation Bar"), relationship("synchronous-message", "Synchronous Message"),
    relationship("asynchronous-message", "Asynchronous Message"), relationship("return-message", "Return Message"), node("combined-fragment", "Combined Fragment (alt / loop / opt)")
  ]],
  ["UML", "Behavioral", "uml-state-machine", "State Machine Diagram", [
    node("state", "State"), relationship("transition", "Transition"), node("choice", "Choice"), node("junction", "Junction"), node("history-state", "History"), node("region", "Region")
  ]],
  ["UML", "Behavioral", "uml-communication", "Communication Diagram", [
    node("object", "Object"), relationship("numbered-message", "Numbered Message")
  ]],
  ["UML", "Behavioral", "uml-timing", "Timing Diagram", [
    node("state-timeline", "State Timeline"), node("duration-constraint", "Duration Constraint")
  ]],
  ["UML", "Behavioral", "uml-interaction-overview", "Interaction Overview Diagram", [node("interaction-use", "Interaction Use")]],
  ["SysML", "Structural", "sysml-bdd", "Block Definition Diagram (BDD)", [
    node("block", "Block"), node("interface-block", "Interface Block"), node("value-type", "Value Type"), node("constraint-block", "Constraint Block"), node("unit", "Unit"), node("quantity-kind", "Quantity Kind")
  ]],
  ["SysML", "Structural", "sysml-ibd", "Internal Block Diagram (IBD)", [
    node("part-property", "Part Property"), node("reference-property", "Reference Property"), node("proxy-port", "Proxy Port"), node("full-port", "Full Port"), relationship("connector", "Connector"), relationship("item-flow", "Item Flow")
  ]],
  ["SysML", "Structural", "sysml-package", "Package Diagram (PKG)", [node("view", "View"), node("viewpoint", "Viewpoint")]],
  ["SysML", "Structural", "sysml-parametric", "Parametric Diagram (PMR)", [
    node("constraint-property", "Constraint Property"), node("constraint-parameter", "Constraint Parameter"), relationship("binding-connector", "Binding Connector")
  ]],
  ["SysML", "Behavioral", "sysml-use-case", "Use Case Diagram (UC)", [
    node("actor", "Actor"), node("use-case", "Use Case"), relationship("include", "Include"), relationship("extend", "Extend"), node("system-boundary", "System Boundary")
  ]],
  ["SysML", "Behavioral", "sysml-activity", "Activity Diagram (ACT)", [
    node("action", "Action"), node("control-operator", "Control Operator"), node("object-node", "Object Node"), relationship("control-flow", "Control Flow"),
    relationship("object-flow", "Object Flow"), node("initial-node", "Initial Node"), node("activity-final", "Final Node"), node("decision", "Decision / Merge"), node("fork-join", "Fork / Join")
  ]],
  ["SysML", "Behavioral", "sysml-sequence", "Sequence Diagram (SD)", [
    node("part", "Block Part Lifeline", "lifeline"), node("activation", "Activation Bar"), relationship("synchronous-message", "Synchronous Message"),
    relationship("asynchronous-message", "Asynchronous Message"), relationship("return-message", "Return Message"), node("combined-fragment", "Combined Fragment")
  ]],
  ["SysML", "Behavioral", "sysml-state-machine", "State Machine Diagram (STM)", [
    node("state", "State"), relationship("transition", "Transition"), node("choice", "Choice"), node("junction", "Junction"), node("history-state", "History"), node("region", "Region")
  ]],
  ["SysML", "Requirement", "sysml-requirement", "Requirement Diagram (REQ)", [
    node("requirement", "Requirement"), relationship("derive-reqt", "«deriveReqt»"), relationship("satisfy", "«satisfy»"),
    relationship("verify", "«verify»"), relationship("refine", "«refine»"), relationship("trace", "«trace»")
  ]]
];

export const diagramCatalog = definitions.map(([family, category, value, label, palette]) => ({
  family, category, value, label, palette,
  elements: palette.filter((item) => item.type === "node").map((item) => item.kind)
}));

export function paletteForDiagram(diagramType) {
  return diagramCatalog.find(({ value }) => value === diagramType)?.palette ?? [];
}

export function isPaletteItemAllowed(diagramType, type, kind) {
  return [...commonElements, ...paletteForDiagram(diagramType)].some((item) => item.type === type && item.kind === kind);
}
