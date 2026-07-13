import { createSidebarLayout } from "./sidebarLayout.js";

export function createInitialState(storage = localStorage, media = window.matchMedia.bind(window)) {
  return {
    tenantId: "tenant_demo",
    authToken: storage.getItem("sysml.authToken") ?? "",
    refreshToken: storage.getItem("sysml.refreshToken") ?? "",
    user: null,
    view: "dashboard",
    sidebarLayout: createSidebarLayout(storage, media("(min-width: 768px)").matches),
    rightPanel: "advisor",
    selectedHistoryVersion: "current",
    settingsOpen: false,
    versionHistory: [],
    baselines: [],
    auditHistory: [],
    reviews: [],
    versionCompare: { from: "", to: "", diff: null },
    collaboration: { role: "Owner", permissions: [], presence: [], comments: [], notifications: [], online: false },
    settings: { theme: storage.getItem("sysml.theme") ?? "dark" },
    project: null,
    diagram: null,
    diagrams: [],
    modelRepository: { schema_version: 2, elements: [], relationships: [] },
    selectedElementIds: [],
    selectedRelationshipId: null,
    canvasViewport: { zoom: 1, scrollLeft: 0, scrollTop: 0 },
    relationshipKind: "association",
    saveStatus: "",
    shareDraft: { email: "", role: "Viewer" },
    history: [],
    future: []
  };
}
