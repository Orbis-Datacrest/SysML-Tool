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
  | "note";

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
}

export interface DiagramElement {
  id: string;
  kind: ElementKind;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  properties: Record<string, unknown>;
}

export interface DiagramRelationship {
  id: string;
  kind: RelationshipKind;
  source_id: string;
  target_id: string;
  label?: string;
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
