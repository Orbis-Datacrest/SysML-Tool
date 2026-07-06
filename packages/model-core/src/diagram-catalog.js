export const diagramCatalog = [
  { family: "UML", category: "Structural", value: "uml-class", label: "Class Diagram", elements: ["class", "interface", "enumeration", "data-type", "primitive-type", "signal"] },
  { family: "UML", category: "Structural", value: "uml-object", label: "Object Diagram", elements: ["object", "slot"] },
  { family: "UML", category: "Structural", value: "uml-component", label: "Component Diagram", elements: ["component", "interface", "port", "artifact"] },
  { family: "UML", category: "Structural", value: "uml-deployment", label: "Deployment Diagram", elements: ["node", "device", "execution-environment", "artifact"] },
  { family: "UML", category: "Structural", value: "uml-package", label: "Package Diagram", elements: ["package", "model", "import"] },
  { family: "UML", category: "Structural", value: "uml-composite-structure", label: "Composite Structure Diagram", elements: ["structured-classifier", "part", "port", "collaboration"] },
  { family: "UML", category: "Structural", value: "uml-profile", label: "Profile Diagram", elements: ["profile", "stereotype", "metaclass"] },
  { family: "UML", category: "Behavioral", value: "uml-use-case", label: "Use Case Diagram", elements: ["actor", "use-case", "system-boundary"] },
  { family: "UML", category: "Behavioral", value: "uml-activity", label: "Activity Diagram", elements: ["activity", "action", "accept-event-action", "send-signal-action", "decision", "merge-node", "initial-node", "activity-final", "flow-final", "fork-node", "join-node", "object-node", "input-pin", "output-pin", "activity-partition"] },
  { family: "UML", category: "Behavioral", value: "uml-state-machine", label: "State Machine Diagram", elements: ["state", "composite-state", "initial-state", "final-state", "choice", "junction", "entry-point", "exit-point", "history-state", "terminate"] },
  { family: "UML", category: "Behavioral", value: "uml-sequence", label: "Sequence Diagram", elements: ["lifeline", "message", "activation", "combined-fragment", "interaction-use", "destruction-occurrence", "state-invariant", "continuation"] },
  { family: "UML", category: "Behavioral", value: "uml-communication", label: "Communication Diagram", elements: ["object", "actor", "message"] },
  { family: "UML", category: "Behavioral", value: "uml-interaction-overview", label: "Interaction Overview Diagram", elements: ["interaction", "interaction-use", "decision", "initial-node", "final-node"] },
  { family: "UML", category: "Behavioral", value: "uml-timing", label: "Timing Diagram", elements: ["lifeline", "state-invariant", "time-constraint", "duration-constraint"] },
  { family: "SysML", category: "Structural", value: "sysml-bdd", label: "Block Definition Diagram (BDD)", elements: ["block", "value-type", "interface-block", "constraint-block"] },
  { family: "SysML", category: "Structural", value: "sysml-ibd", label: "Internal Block Diagram (IBD)", elements: ["part", "reference", "port", "flow-property", "connector"] },
  { family: "SysML", category: "Structural", value: "sysml-package", label: "Package Diagram (PKG)", elements: ["package", "model", "view", "viewpoint"] },
  { family: "SysML", category: "Structural", value: "sysml-parametric", label: "Parametric Diagram (PMR)", elements: ["constraint-property", "value-property", "parameter", "binding-connector"] },
  { family: "SysML", category: "Behavioral", value: "sysml-use-case", label: "Use Case Diagram (UC)", elements: ["actor", "use-case", "system-boundary"] },
  { family: "SysML", category: "Behavioral", value: "sysml-activity", label: "Activity Diagram (ACT)", elements: ["activity", "action", "accept-event-action", "send-signal-action", "object-node", "decision", "merge-node", "initial-node", "activity-final", "flow-final", "fork-node", "join-node", "activity-partition", "rate"] },
  { family: "SysML", category: "Behavioral", value: "sysml-sequence", label: "Sequence Diagram (SD)", elements: ["lifeline", "message", "activation", "combined-fragment", "interaction-use", "destruction-occurrence"] },
  { family: "SysML", category: "Behavioral", value: "sysml-state-machine", label: "State Machine Diagram (STM)", elements: ["state", "composite-state", "initial-state", "final-state", "choice", "junction", "entry-point", "exit-point", "history-state"] },
  { family: "SysML", category: "Requirement", value: "sysml-requirement", label: "Requirement Diagram (REQ)", elements: ["requirement", "test-case", "rationale", "problem"] }
];

export const commonElements = ["note", "comment", "package"];
