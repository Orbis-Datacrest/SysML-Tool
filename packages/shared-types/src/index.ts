export type Role = "Owner" | "Admin" | "Editor" | "Viewer";

export type DiagramType =
  | "uml-class"
  | "uml-state-machine"
  | "uml-activity"
  | "uml-sequence"
  | "sysml-bdd"
  | "sysml-ibd"
  | "sysml-requirement"
  | "sysml-parametric"
  | "sysml-use-case";

export type ElementKind =
  | "class"
  | "interface"
  | "block"
  | "package"
  | "requirement"
  | "actor"
  | "use-case"
  | "state"
  | "activity"
  | "action"
  | "decision"
  | "lifeline"
  | "message"
  | "port"
  | "connector"
  | "note"
  | "value-type"
  | "constraint-block";

export type RelationshipKind =
  | "association"
  | "aggregation"
  | "composition"
  | "generalization"
  | "realization"
  | "dependency"
  | "include"
  | "extend"
  | "trace"
  | "satisfy"
  | "verify"
  | "refine"
  | "allocate"
  | "flow"
  | "connector"
  | "sequence-message";

export interface TenantScoped {
  id: string;
  tenant_id: string;
  created_at: string;
  updated_at: string;
}

export interface Tenant extends TenantScoped {
  name: string;
}

export interface Project extends TenantScoped {
  name: string;
  description?: string;
  schema_version?: number;
}

export interface ModelElementBase extends TenantScoped {
  project_id: string;
  kind: ElementKind;
  name: string;
  owner_id?: string | null;
  package_id?: string | null;
  stereotypes: string[];
}

export interface Block extends ModelElementBase {
  kind: "block";
  semantic: { parts: string[]; references: string[]; values: string[]; operations: string[]; constraints: string[] };
}

export interface Package extends ModelElementBase {
  kind: "package";
  semantic: { memberIds: string[]; importedPackageIds: string[] };
}

export interface Interface extends ModelElementBase {
  kind: "interface";
  semantic: { operations: string[]; receptions: string[]; properties: string[] };
}

export interface Requirement extends ModelElementBase {
  kind: "requirement";
  semantic: { requirementId: string; text: string; owner?: string; verificationMethod?: string; approvalStatus?: string; risk?: string; priority?: string };
}

export interface Port extends ModelElementBase {
  kind: "port";
  semantic: { direction: "in" | "out" | "inout"; interfaceType?: string; multiplicity?: string; conjugated: boolean };
}

export interface Activity extends ModelElementBase {
  kind: "activity";
  semantic: { parameters: string[]; objectFlows: string[]; guards: string[]; rates: string[] };
}

export interface State extends ModelElementBase {
  kind: "state";
  semantic: { entry?: string; exit?: string; doActivity?: string };
}

export interface ValueType extends ModelElementBase {
  kind: "value-type";
  semantic: { unit?: string; quantityKind?: string; dimensions?: Record<string, number> };
}

export interface ConstraintBlock extends ModelElementBase {
  kind: "constraint-block";
  semantic: { parameters: string[]; constraints: string[] };
}

export type SysMLModelElement = Block | Package | Interface | Requirement | Port | Activity | State | ValueType | ConstraintBlock | ModelElementBase;

export interface CompatibilityValidation {
  status: "unchecked" | "valid" | "invalid";
  diagnostics: string[];
}

export interface ModelRelationship extends TenantScoped {
  project_id: string;
  kind: RelationshipKind;
  source_id: string;
  target_id: string;
  label?: string;
  stereotypes: string[];
  semantic: Record<string, unknown>;
  validation: CompatibilityValidation;
}

export interface DiagramElementReference {
  model_element_id: string;
  variant?: "full" | "simple";
  x: number;
  y: number;
  width: number;
  height: number;
  z_index?: number;
  style?: Record<string, unknown>;
  display?: Record<string, unknown>;
  locked?: boolean;
  groupId?: string;
}

export interface DiagramRelationshipReference {
  model_relationship_id: string;
  routing?: "orthogonal" | "manual";
  waypoints?: Array<{ x: number; y: number }>;
  sourceAnchor?: { side: "top" | "right" | "bottom" | "left"; offset?: number; portId?: string };
  targetAnchor?: { side: "top" | "right" | "bottom" | "left"; offset?: number; portId?: string };
  labelPosition?: number;
  roleLabel?: string;
  multiplicity?: string;
  sourceMultiplicity?: string;
  style?: Record<string, unknown>;
  display?: Record<string, unknown>;
}

export interface DiagramView {
  schema_version: number;
  element_refs: DiagramElementReference[];
  relationship_refs: DiagramRelationshipReference[];
  viewport: { x: number; y: number; zoom: number };
  display: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface ModelRepository {
  elements: SysMLModelElement[];
  relationships: ModelRelationship[];
}

export interface DiagramElement {
  id: string;
  model_element_id?: string;
  kind: ElementKind;
  variant?: "full" | "simple";
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  properties: Record<string, unknown>;
}

export interface DiagramRelationship {
  id: string;
  model_relationship_id?: string;
  kind: RelationshipKind;
  source_id: string;
  target_id: string;
  label?: string;
  routing?: "orthogonal" | "manual";
  waypoints?: Array<{ x: number; y: number }>;
  sourceAnchor?: { side: "top" | "right" | "bottom" | "left"; offset?: number; portId?: string };
  targetAnchor?: { side: "top" | "right" | "bottom" | "left"; offset?: number; portId?: string };
  roleLabel?: string;
  multiplicity?: string;
  properties: Record<string, unknown>;
}

export interface Diagram extends TenantScoped {
  project_id: string;
  type: DiagramType;
  name: string;
  version: number;
  elements: DiagramElement[];
  relationships: DiagramRelationship[];
  metadata: Record<string, unknown>;
  view?: DiagramView;
}

export interface ModelChangeEvent {
  id: string;
  tenant_id: string;
  project_id: string;
  diagram_id: string;
  version: number;
  actor_id: string;
  reason: string;
  created_at: string;
  patch: DiagramPatch;
}

export interface DiagramPatch {
  summary: string;
  operations: DiagramPatchOperation[];
}

export type DiagramPatchOperation =
  | { op: "addElement"; element: DiagramElement }
  | { op: "updateElement"; element_id: string; changes: Partial<DiagramElement> }
  | { op: "removeElement"; element_id: string }
  | { op: "addRelationship"; relationship: DiagramRelationship }
  | { op: "removeRelationship"; relationship_id: string };

export interface AiProviderConfig {
  id: string;
  tenant_id: string;
  project_id?: string;
  provider: "openai" | "anthropic" | "local" | "custom";
  model: string;
  display_name: string;
  encrypted_api_key?: string;
  active: boolean;
}

export interface AiAdvisorRequest {
  tenant_id: string;
  project_id: string;
  diagram_id: string;
  selected_element_ids: string[];
  prompt: string;
  attachments: Array<{ id: string; name: string; mime_type: string; storage_key: string }>;
}
