import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { applyPatch, assertBaselineMutable, compareProjectVersions, createBaseline, createId, decomposeDiagram, diagramTypes, hydrateDiagram, restoreDiagram, restoreElement, validateDiagram, validateModel, validateRelationshipCompatibility } from "../../../packages/model-core/src/index.js";
import { toVectorPdf } from "../../../apps/import-export/src/exporters.js";
import { accessTokenDays, authMaxAttempts, authWindowMs, dataDir, dbPath, port, refreshTokenDays, root } from "./config.js";
import { addDays, decryptSecret, encryptSecret, hashPassword, isValidEmail, makeToken, makeVerificationCode, normalizeEmail, now, tenantIdForEmail, validatePassword, verifyPassword } from "./auth/security.js";
import { readJsonBody as body, sendJson as send } from "./http/responses.js";
import { serveStaticFile } from "./http/staticFiles.js";
import { migrateSchema } from "./database/migrateSchema.js";
import { createAuthRouter } from "./routes/createAuthRouter.js";
import { createHash } from "node:crypto";
import { buildAiContext } from "../../ai-advisor-service/src/contextBuilder.js";
import { materializeSemanticProposal, selectMaterializedOperations, validateProposalReferences } from "../../ai-advisor-service/src/layoutEngine.js";
import { isAiDiagramSupported, validateAiProposal } from "../../ai-advisor-service/src/proposalContract.js";
import { AiProviderRegistry, createOllamaProvider, createOpenAiProvider, localProvider, providerInstructions } from "../../ai-advisor-service/src/providerRegistry.js";

await mkdir(dataDir, { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");
let diagramSavepointSequence = 0;

const aiProviders = new AiProviderRegistry().register("local", localProvider).register("ollama", createOllamaProvider({
  endpoint: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
  model: process.env.OLLAMA_MODEL ?? "qwen2.5:7b"
}));

function activeAiKey(tenantId) {
  return db.prepare("SELECT * FROM ai_keys WHERE tenant_id = ? AND active = 1 ORDER BY created_at DESC LIMIT 1").get(tenantId);
}

function configuredAiProvider(tenantId) {
  const key = activeAiKey(tenantId);
  if (key?.provider === "openai") {
    return { name: "openai", model: key.model || "gpt-4o-mini", provider: createOpenAiProvider({ apiKey: decryptSecret(key.encrypted_api_key), model: key.model || "gpt-4o-mini" }) };
  }
  const name = ["local", "ollama"].includes(process.env.DEFAULT_AI_PROVIDER) ? process.env.DEFAULT_AI_PROVIDER : "local";
  return { name, model: name === "ollama" ? (process.env.OLLAMA_MODEL ?? "qwen2.5:7b") : "structured-local-parser", provider: aiProviders.providers.get(name) };
}

async function readJson(name, fallback) {
  const file = path.join(dataDir, `${name}.json`);
  if (!existsSync(file)) return fallback;
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeJson(name, value) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(dataDir, `${name}.json`), JSON.stringify(value, null, 2));
}

function json(value, fallback = {}) {
  if (value === undefined || value === null || value === "") return fallback;
  return typeof value === "string" ? JSON.parse(value) : value;
}

function publicUser(user) {
  if (!user) return null;
  const { id, email, tenant_id, role, verified_at } = user;
  return { id, email, tenant_id, role, verified_at };
}

function publicMember(member) {
  return {
    id: member.id,
    tenant_id: member.tenant_id,
    user_id: member.user_id,
    email: member.email,
    role: member.role,
    invited_by: member.invited_by,
    accepted_at: member.accepted_at,
    created_at: member.created_at
  };
}

function getUserSettings(userId) {
  const row = db.prepare("SELECT * FROM user_settings WHERE user_id = ?").get(userId);
  return { theme: row?.theme ?? "dark" };
}

function saveUserSettings(userId, settings) {
  const theme = ["light", "dark"].includes(settings.theme) ? settings.theme : "dark";
  db.prepare(`
    INSERT INTO user_settings (user_id, theme, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET theme = excluded.theme, updated_at = excluded.updated_at
  `).run(userId, theme, now());
  return getUserSettings(userId);
}

function diagramFromRow(row) {
  if (!row) return null;
  const legacy = {
    id: row.id,
    tenant_id: row.tenant_id,
    project_id: row.project_id,
    type: row.type,
    name: row.name,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
    metadata: json(row.metadata, {}),
    elements: json(row.elements, []),
    relationships: json(row.relationships, [])
  };
  const viewRow = db.prepare("SELECT * FROM diagram_views WHERE diagram_id = ? AND tenant_id = ?").get(row.id, row.tenant_id);
  if (!viewRow) return legacy;
  const elements = db.prepare("SELECT * FROM model_elements WHERE project_id = ? AND tenant_id = ?").all(row.project_id, row.tenant_id).map((item) => ({ ...item, semantic: json(item.semantic, {}), stereotypes: json(item.stereotypes, []) }));
  const relationships = db.prepare("SELECT * FROM model_relationships WHERE project_id = ? AND tenant_id = ?").all(row.project_id, row.tenant_id).map((item) => ({ ...item, semantic: json(item.semantic, {}), stereotypes: json(item.stereotypes, []), validation: json(item.validation, {}) }));
  const view = { schema_version: viewRow.schema_version, element_refs: json(viewRow.element_refs, []), relationship_refs: json(viewRow.relationship_refs, []), viewport: json(viewRow.viewport, {}), display: json(viewRow.display, {}), metadata: json(viewRow.metadata, {}) };
  return hydrateDiagram(legacy, { elements, relationships }, view);
}

function insertTenant(tenant) {
  db.prepare(`
    INSERT OR IGNORE INTO tenants (id, tenant_id, name, owner_user_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(tenant.id, tenant.tenant_id ?? tenant.id, tenant.name, tenant.owner_user_id ?? null, tenant.created_at, tenant.updated_at);
}

function insertProject(project) {
  db.prepare(`
    INSERT OR IGNORE INTO projects (id, tenant_id, name, description, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(project.id, project.tenant_id, project.name, project.description ?? "", project.created_at, project.updated_at);
}

function updateProject(project) {
  db.prepare(`
    UPDATE projects SET name = ?, description = ?, updated_at = ?
    WHERE id = ? AND tenant_id = ?
  `).run(project.name, project.description ?? "", project.updated_at, project.id, project.tenant_id);
}

function projectWithStats(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    name: row.name,
    description: row.description,
    created_at: row.created_at,
    updated_at: row.updated_at,
    diagram_count: row.diagram_count ?? 0,
    last_opened_at: row.last_opened_at ?? null
  };
}

function projectsForTenant(tenantId, userId = null) {
  return db.prepare(`
    SELECT p.*,
      COUNT(d.id) AS diagram_count,
      MAX(r.opened_at) AS last_opened_at
    FROM projects p
    LEFT JOIN diagrams d ON d.project_id = p.id AND d.tenant_id = p.tenant_id
    LEFT JOIN recent_projects r ON r.project_id = p.id AND r.user_id = ?
    WHERE p.tenant_id = ?
    GROUP BY p.id
    ORDER BY p.updated_at DESC
  `).all(userId, tenantId).map(projectWithStats);
}

function recentProjectsForUser(tenantId, userId) {
  if (!userId) return [];
  return db.prepare(`
    SELECT p.*,
      COUNT(d.id) AS diagram_count,
      r.opened_at AS last_opened_at
    FROM recent_projects r
    JOIN projects p ON p.id = r.project_id AND p.tenant_id = r.tenant_id
    LEFT JOIN diagrams d ON d.project_id = p.id AND d.tenant_id = p.tenant_id
    WHERE r.tenant_id = ? AND r.user_id = ?
    GROUP BY p.id, r.opened_at
    ORDER BY r.opened_at DESC
    LIMIT 8
  `).all(tenantId, userId).map(projectWithStats);
}

function projectInvitationsForUser(tenantId, email) {
  if (!email) return [];
  return db.prepare(`
    SELECT
      s.id,
      s.project_id,
      p.name AS project_name,
      p.description AS project_description,
      s.role,
      s.created_at,
      s.updated_at,
      s.accepted_at,
      inviter.email AS invited_by_email
    FROM project_shares s
    JOIN projects p ON p.id = s.project_id AND p.tenant_id = s.tenant_id
    LEFT JOIN users inviter ON inviter.id = s.invited_by
    WHERE s.tenant_id = ? AND lower(s.email) = lower(?)
    ORDER BY s.updated_at DESC
  `).all(tenantId, normalizeEmail(email));
}

function recordProjectOpen(tenantId, userId, projectId) {
  if (!userId) return;
  db.prepare(`
    INSERT INTO recent_projects (id, tenant_id, user_id, project_id, opened_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, project_id) DO UPDATE SET opened_at = excluded.opened_at
  `).run(createId("recent"), tenantId, userId, projectId, now());
}

function createProjectSnapshot(tenantId, projectId, description = "Auto Save", actorId = null, diagramIds = null) {
  const project = db.prepare("SELECT * FROM projects WHERE id = ? AND tenant_id = ?").get(projectId, tenantId);
  if (!project) return null;
  const selectedIds = Array.isArray(diagramIds) ? new Set(diagramIds) : null;
  const diagrams = db.prepare("SELECT * FROM diagrams WHERE project_id = ? AND tenant_id = ? ORDER BY created_at").all(projectId, tenantId).map(diagramFromRow).filter((diagram) => !selectedIds || selectedIds.has(diagram.id));
  if (!diagrams.length) return null;
  const current = db.prepare("SELECT MAX(version) AS version FROM project_snapshots WHERE project_id = ? AND tenant_id = ?").get(projectId, tenantId);
  const version = Number(current.version ?? 0) + 1;
  const item = {
    id: createId("snapshot"),
    tenant_id: tenantId,
    project_id: projectId,
    version,
    description,
    snapshot: JSON.stringify({ project, diagrams }),
    created_by: actorId,
    created_at: now()
  };
  db.prepare(`
    INSERT INTO project_snapshots (id, tenant_id, project_id, version, description, snapshot, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(item.id, item.tenant_id, item.project_id, item.version, item.description, item.snapshot, item.created_by, item.created_at);
  return { id: item.id, project_id: item.project_id, version: item.version, description: item.description, created_at: item.created_at };
}

function snapshotsForProject(tenantId, projectId) {
  return db.prepare(`
    SELECT id, project_id, version, description, snapshot, created_by, created_at
    FROM project_snapshots
    WHERE tenant_id = ? AND project_id = ?
    ORDER BY version DESC
  `).all(tenantId, projectId).map(({ snapshot, ...row }) => {
    const diagrams = json(snapshot, {}).diagrams ?? [];
    return { ...row, diagrams: diagrams.map(({ id, name }) => ({ id, name })) };
  });
}

function snapshotPayload(tenantId, projectId, version) {
  const row = db.prepare("SELECT * FROM project_snapshots WHERE project_id = ? AND tenant_id = ? AND version = ?").get(projectId, tenantId, Number(version));
  return row ? { row, snapshot: JSON.parse(row.snapshot) } : null;
}

function roleForProject(user, tenantId, projectId) {
  if (!user) return tenantId === "tenant_demo" ? "Owner" : "Viewer";
  const share = db.prepare("SELECT role FROM project_shares WHERE tenant_id = ? AND project_id = ? AND email = ?").get(tenantId, projectId, user.email);
  return share?.role ?? user.role ?? "Viewer";
}

function permissionsForRole(role) {
  const map = {
    Owner: ["read", "comment", "edit", "review", "approve", "admin"],
    Admin: ["read", "comment", "edit", "review", "approve", "admin"],
    Editor: ["read", "comment", "edit", "review"],
    Reviewer: ["read", "comment", "review", "approve"],
    Commenter: ["read", "comment", "review"],
    Viewer: ["read"]
  };
  return map[role] ?? map.Viewer;
}

function requireProjectPermission(req, res, projectId, permission = "read") {
  const context = authContext(req);
  const project = db.prepare("SELECT * FROM projects WHERE id = ? AND tenant_id = ?").get(projectId, context.tenantId);
  if (!project) {
    send(res, 404, { error: "Project not found" });
    return null;
  }
  const role = roleForProject(context.user, context.tenantId, projectId);
  const permissions = permissionsForRole(role);
  if (!permissions.includes(permission)) {
    send(res, 403, { error: "You do not have permission for this project action." });
    return null;
  }
  return { ...context, project, role, permissions };
}

function recordAudit({ tenantId, projectId, actorId = null, action, resourceType, resourceId, description, metadata = {} }) {
  db.prepare(`
    INSERT INTO audit_records (id, tenant_id, project_id, actor_id, action, resource_type, resource_id, description, created_at, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(createId("audit"), tenantId, projectId, actorId, action, resourceType, resourceId, description, now(), JSON.stringify(metadata));
}

function publicBaseline(row) {
  return row ? {
    id: row.id,
    project_id: row.project_id,
    snapshot_id: row.snapshot_id,
    version: row.version,
    name: row.name,
    description: row.description,
    state: row.state,
    released: Boolean(row.released),
    created_by: row.created_by,
    created_at: row.created_at,
    released_by: row.released_by,
    released_at: row.released_at
  } : null;
}

function listBaselines(tenantId, projectId) {
  return db.prepare("SELECT * FROM project_baselines WHERE tenant_id = ? AND project_id = ? ORDER BY created_at DESC").all(tenantId, projectId).map(publicBaseline);
}

function activePresence(tenantId, projectId, diagramId, currentUserId = "") {
  const threshold = new Date(Date.now() - 45_000).toISOString();
  return db.prepare(`
    SELECT * FROM collaboration_presence
    WHERE tenant_id = ? AND project_id = ? AND diagram_id = ? AND updated_at >= ? AND user_id != ?
    ORDER BY updated_at DESC
  `).all(tenantId, projectId, diagramId, threshold, currentUserId).map((item) => ({
    id: item.user_id,
    name: item.name,
    role: item.role,
    color: item.color,
    cursor: json(item.cursor, null),
    selection: json(item.selection, []),
    updated_at: item.updated_at
  }));
}

function commentsForDiagram(tenantId, projectId, diagramId, currentUserId = "", permissions = []) {
  const rows = db.prepare(`
    SELECT c.*, COALESCE(u.email, c.created_by) AS author
    FROM collaboration_comments c
    LEFT JOIN users u ON u.id = c.created_by
    WHERE c.tenant_id = ? AND c.project_id = ? AND c.diagram_id = ?
    ORDER BY c.created_at ASC
  `).all(tenantId, projectId, diagramId);
  const byId = new Map(rows.map((item) => [item.id, item]));
  const rootRows = new Map(rows.filter((item) => !item.parent_id).map((item) => [item.id, item]));
  const latestByThread = new Map();
  for (const item of rows) {
    const threadId = item.parent_id && byId.has(item.parent_id) ? (byId.get(item.parent_id).parent_id || item.parent_id) : item.id;
    const current = latestByThread.get(threadId);
    if (!current || current.updated_at < item.updated_at) latestByThread.set(threadId, item);
  }
  const reads = currentUserId ? new Map(db.prepare("SELECT thread_id, read_at FROM collaboration_comment_reads WHERE tenant_id = ? AND project_id = ? AND user_id = ?").all(tenantId, projectId, currentUserId).map((item) => [item.thread_id, item.read_at])) : new Map();
  return rows.map((item) => {
    const threadId = item.parent_id && byId.has(item.parent_id) ? (byId.get(item.parent_id).parent_id || item.parent_id) : item.id;
    const isAuthor = Boolean(currentUserId && item.created_by === currentUserId);
    const administer = permissions.includes("admin");
    const root = rootRows.get(threadId) ?? item;
    const resolve = !item.parent_id && item.status !== "deleted" && (isAuthor || permissions.includes("edit") || administer);
    return {
      id: item.id, thread_id: threadId, diagram_id: item.diagram_id, anchor_type: item.anchor_type, anchor_id: item.anchor_id,
      anchor_x: item.anchor_x, anchor_y: item.anchor_y, parent_id: item.parent_id,
      body: item.status === "deleted" ? "Comment deleted" : item.body,
      mentions: json(item.mentions, []), status: item.status, author: item.author,
      created_by: item.created_by, created_at: item.created_at, updated_at: item.updated_at,
      edited_at: item.edited_at, deleted_at: item.deleted_at,
      unread: currentUserId ? !reads.get(threadId) || reads.get(threadId) < latestByThread.get(threadId).updated_at : false,
      permissions: {
        reply: permissions.includes("comment") && root.status === "open",
        edit: item.status !== "deleted" && isAuthor,
        delete: item.status !== "deleted" && (isAuthor || administer),
        resolve,
        reopen: resolve
      }
    };
  });
}

function extractMentions(value) {
  return [...new Set([...String(value ?? "").matchAll(/@([\w.+-]+@[\w.-]+|\w+)/g)].map((match) => match[1].toLowerCase()))].slice(0, 25);
}

function markCommentThreadRead({ tenantId, projectId, threadId, userId, readAt = now() }) {
  db.prepare(`INSERT INTO collaboration_comment_reads (tenant_id, project_id, thread_id, user_id, read_at)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(thread_id, user_id) DO UPDATE SET read_at = excluded.read_at`).run(tenantId, projectId, threadId, userId, readAt);
}

function insertDiagram(diagram) {
  db.prepare(`
    INSERT OR IGNORE INTO diagrams (id, tenant_id, project_id, type, name, version, created_at, updated_at, metadata, elements, relationships)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    diagram.id,
    diagram.tenant_id,
    diagram.project_id,
    diagram.type,
    diagram.name,
    diagram.version ?? 1,
    diagram.created_at,
    diagram.updated_at,
    JSON.stringify(diagram.metadata ?? {}),
    JSON.stringify(diagram.elements ?? []),
    JSON.stringify(diagram.relationships ?? [])
  );
  persistDiagramModel(diagram);
}

function updateDiagram(diagram) {
  const stored = db.prepare("SELECT elements, relationships FROM diagrams WHERE id = ?").get(diagram.id);
  const previousElements = new Map(json(stored?.elements, []).map((item) => [item.id, item]));
  const previousRelationships = new Map(json(stored?.relationships, []).map((item) => [item.id, item]));
  // node:sqlite DatabaseSync does not expose better-sqlite3's transaction()
  // helper. A uniquely named savepoint is atomic both on its own and when this
  // function is called inside an existing BEGIN/COMMIT transaction.
  const savepoint = `update_diagram_${++diagramSavepointSequence}`;
  db.exec(`SAVEPOINT ${savepoint}`);
  try {
    db.prepare(`
      UPDATE diagrams
      SET tenant_id = ?, project_id = ?, type = ?, name = ?, version = ?, updated_at = ?, metadata = ?, elements = ?, relationships = ?
      WHERE id = ?
    `).run(
      diagram.tenant_id,
      diagram.project_id,
      diagram.type,
      diagram.name,
      diagram.version,
      diagram.updated_at,
      JSON.stringify(diagram.metadata ?? {}),
      JSON.stringify(diagram.elements ?? []),
      JSON.stringify(diagram.relationships ?? []),
      diagram.id
    );
    persistDiagramModel(diagram, { previousElements, previousRelationships });
    db.exec(`RELEASE SAVEPOINT ${savepoint}`);
  } catch (error) {
    db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    db.exec(`RELEASE SAVEPOINT ${savepoint}`);
    throw error;
  }
}

function persistDiagramModel(diagram, previous = {}) {
  const { elements, relationships, view } = decomposeDiagram(diagram);
  const timestamp = diagram.updated_at ?? now();
  for (const element of elements) {
    const prior = previous.previousElements?.get(element.id);
    const incoming = (diagram.elements ?? []).find((item) => item.id === element.id);
    if (prior && JSON.stringify({ kind: prior.kind, name: prior.name, properties: prior.properties, stereotypes: prior.stereotypes }) === JSON.stringify({ kind: incoming.kind, name: incoming.name, properties: incoming.properties, stereotypes: incoming.stereotypes })) continue;
    const existing = db.prepare("SELECT tenant_id, project_id FROM model_elements WHERE id = ?").get(element.id);
    if (existing && (existing.tenant_id !== element.tenant_id || existing.project_id !== element.project_id)) throw new Error(`Model element id collision: ${element.id}`);
    db.prepare(`
      INSERT INTO model_elements (id, tenant_id, project_id, kind, name, owner_id, package_id, semantic, stereotypes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, name=excluded.name, owner_id=excluded.owner_id,
        package_id=excluded.package_id, semantic=excluded.semantic, stereotypes=excluded.stereotypes, updated_at=excluded.updated_at
    `).run(element.id, element.tenant_id, element.project_id, element.kind, element.name, element.owner_id, element.package_id, JSON.stringify(element.semantic), JSON.stringify(element.stereotypes), diagram.created_at ?? timestamp, timestamp);
  }
  const projectElements = db.prepare("SELECT id, kind FROM model_elements WHERE tenant_id = ? AND project_id = ?").all(diagram.tenant_id, diagram.project_id);
  for (const relationship of relationships) {
    const prior = previous.previousRelationships?.get(relationship.id);
    const incoming = (diagram.relationships ?? []).find((item) => item.id === relationship.id);
    if (prior && JSON.stringify({ kind: prior.kind, source_id: prior.source_id, target_id: prior.target_id, label: prior.label, properties: prior.properties, stereotypes: prior.stereotypes }) === JSON.stringify({ kind: incoming.kind, source_id: incoming.source_id, target_id: incoming.target_id, label: incoming.label, properties: incoming.properties, stereotypes: incoming.stereotypes })) continue;
    relationship.validation = validateRelationshipCompatibility(relationship, projectElements);
    const existing = db.prepare("SELECT tenant_id, project_id FROM model_relationships WHERE id = ?").get(relationship.id);
    if (existing && (existing.tenant_id !== relationship.tenant_id || existing.project_id !== relationship.project_id)) throw new Error(`Model relationship id collision: ${relationship.id}`);
    db.prepare(`
      INSERT INTO model_relationships (id, tenant_id, project_id, kind, source_id, target_id, label, semantic, stereotypes, validation, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, source_id=excluded.source_id, target_id=excluded.target_id,
        label=excluded.label, semantic=excluded.semantic, stereotypes=excluded.stereotypes, validation=excluded.validation, updated_at=excluded.updated_at
    `).run(relationship.id, relationship.tenant_id, relationship.project_id, relationship.kind, relationship.source_id, relationship.target_id, relationship.label, JSON.stringify(relationship.semantic), JSON.stringify(relationship.stereotypes), JSON.stringify(relationship.validation), diagram.created_at ?? timestamp, timestamp);
  }
  db.prepare(`
    INSERT INTO diagram_views (diagram_id, tenant_id, project_id, schema_version, element_refs, relationship_refs, viewport, display, metadata, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(diagram_id) DO UPDATE SET schema_version=excluded.schema_version, element_refs=excluded.element_refs,
      relationship_refs=excluded.relationship_refs, viewport=excluded.viewport, display=excluded.display, metadata=excluded.metadata, updated_at=excluded.updated_at
  `).run(diagram.id, diagram.tenant_id, diagram.project_id, view.schema_version, JSON.stringify(view.element_refs), JSON.stringify(view.relationship_refs), JSON.stringify(view.viewport), JSON.stringify(view.display), JSON.stringify(view.metadata), timestamp);
}

function migrateLegacyDiagrams() {
  const rows = db.prepare("SELECT d.* FROM diagrams d LEFT JOIN diagram_views v ON v.diagram_id = d.id WHERE v.diagram_id IS NULL").all();
  for (const row of rows) persistDiagramModel({ ...diagramFromRow(row), elements: json(row.elements, []), relationships: json(row.relationships, []) });
}

function getUserByEmail(email) {
  return db.prepare("SELECT * FROM users WHERE email = ?").get(normalizeEmail(email));
}

function getUserById(id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

function upsertUser(user) {
  db.prepare(`
    INSERT INTO users (id, email, tenant_id, role, password_hash, password_salt, created_at, verified_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      tenant_id = excluded.tenant_id,
      role = excluded.role,
      password_hash = COALESCE(excluded.password_hash, users.password_hash),
      password_salt = COALESCE(excluded.password_salt, users.password_salt),
      verified_at = excluded.verified_at
  `).run(user.id, user.email, user.tenant_id, user.role, user.password_hash ?? null, user.password_salt ?? null, user.created_at, user.verified_at);
}

function upsertTenantMember({ tenant_id, user_id = null, email, role, invited_by = null, accepted_at = null }) {
  const timestamp = now();
  db.prepare(`
    INSERT INTO tenant_members (id, tenant_id, user_id, email, role, invited_by, accepted_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, email) DO UPDATE SET
      user_id = COALESCE(excluded.user_id, tenant_members.user_id),
      role = excluded.role,
      accepted_at = COALESCE(excluded.accepted_at, tenant_members.accepted_at),
      updated_at = excluded.updated_at
  `).run(createId("member"), tenant_id, user_id, normalizeEmail(email), role, invited_by, accepted_at, timestamp, timestamp);
}

async function migrateJsonData() {
  const existing = db.prepare("SELECT COUNT(*) AS count FROM tenants").get().count;
  if (existing > 0) return;

  const timestamp = now();
  const tenants = await readJson("tenants", []);
  const projects = await readJson("projects", []);
  const diagrams = await readJson("diagrams", []);
  const users = await readJson("users", []);
  const events = await readJson("events", []);
  const aiKeys = await readJson("aiKeys", []);

  if (!tenants.length) {
    const tenant = { id: "tenant_demo", tenant_id: "tenant_demo", name: "Demo Aerospace", created_at: timestamp, updated_at: timestamp };
    const project = { id: "project_demo", tenant_id: tenant.id, name: "Flight Control System", description: "Demo UML/SysML project", created_at: timestamp, updated_at: timestamp };
    const diagram = {
      id: "diagram_demo",
      tenant_id: tenant.id,
      project_id: project.id,
      type: "uml-class",
      name: "UML Class Diagram",
      version: 1,
      created_at: timestamp,
      updated_at: timestamp,
      metadata: { grid: 20 },
      elements: [
        { id: "class_controller", kind: "class", name: "FlightController", x: 120, y: 120, width: 180, height: 110, properties: { attributes: ["mode"], operations: ["stabilize()"] } },
        { id: "class_sensor", kind: "class", name: "SensorBus", x: 430, y: 150, width: 170, height: 100, properties: { attributes: ["samples"], operations: ["read()"] } }
      ],
      relationships: [
        { id: "rel_controller_sensor", kind: "association", source_id: "class_controller", target_id: "class_sensor", label: "reads", properties: {} }
      ]
    };
    insertTenant(tenant);
    insertProject(project);
    insertDiagram(diagram);
    return;
  }

  for (const tenant of tenants) insertTenant(tenant);
  for (const project of projects) insertProject(project);
  for (const diagram of diagrams) insertDiagram(diagram);
  for (const user of users) {
    upsertUser({ ...user, role: user.role ?? "Owner", created_at: user.created_at ?? timestamp });
    upsertTenantMember({ tenant_id: user.tenant_id, user_id: user.id, email: user.email, role: user.role ?? "Owner", accepted_at: user.verified_at ?? timestamp });
  }
  for (const event of events) {
    db.prepare(`
      INSERT OR IGNORE INTO events (id, tenant_id, project_id, diagram_id, version, actor_id, reason, created_at, patch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(event.id, event.tenant_id, event.project_id, event.diagram_id, event.version, event.actor_id, event.reason, event.created_at, JSON.stringify(event.patch ?? {}));
  }
  for (const key of aiKeys) {
    db.prepare(`
      INSERT OR IGNORE INTO ai_keys (id, tenant_id, provider, model, display_name, encrypted_api_key, active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(key.id, key.tenant_id, key.provider, key.model, key.display_name, key.encrypted_api_key, key.active ? 1 : 0, key.created_at);
  }
}

function rateLimit(req, bucket) {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "local";
  const key = `${bucket}:${ip}`;
  const current = Date.now();
  const existing = db.prepare("SELECT * FROM rate_limits WHERE key = ?").get(key);
  if (!existing || existing.reset_at <= current) {
    db.prepare("INSERT OR REPLACE INTO rate_limits (key, count, reset_at) VALUES (?, ?, ?)").run(key, 1, current + authWindowMs);
    return null;
  }
  if (existing.count >= authMaxAttempts) {
    const retryAfter = Math.ceil((existing.reset_at - current) / 1000);
    return { error: `Too many attempts. Try again in ${retryAfter} seconds.`, retryAfter };
  }
  db.prepare("UPDATE rate_limits SET count = count + 1 WHERE key = ?").run(key);
  return null;
}

async function deliverEmail({ to, subject, text }) {
  const provider = (process.env.EMAIL_PROVIDER ?? "dev").toLowerCase();
  const from = process.env.EMAIL_FROM ?? "SysML Studio <no-reply@sysml-studio.local>";

  try {
    if (provider === "resend" && process.env.RESEND_API_KEY) {
      const result = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ from, to, subject, text })
      });
      if (!result.ok) throw new Error(await result.text());
      recordEmailOutbox({ to, subject, text, provider, status: "sent" });
      return;
    }

    if (provider === "sendgrid" && process.env.SENDGRID_API_KEY) {
      const result = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: { authorization: `Bearer ${process.env.SENDGRID_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ personalizations: [{ to: [{ email: to }] }], from: { email: from.replace(/^.*<|>$/g, "") }, subject, content: [{ type: "text/plain", value: text }] })
      });
      if (!result.ok) throw new Error(await result.text());
      recordEmailOutbox({ to, subject, text, provider, status: "sent" });
      return;
    }

    await writeDevEmail({ to, subject, text });
    recordEmailOutbox({ to, subject, text, provider: "dev", status: "queued" });
  } catch (error) {
    recordEmailOutbox({ to, subject, text, provider, status: "failed", error: error.message });
    throw error;
  }
}

function recordEmailOutbox({ to, subject, text, provider, status, error = null }) {
  db.prepare(`
    INSERT INTO email_outbox (id, recipient, subject, text, provider, status, error, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(createId("email"), to, subject, text, provider, status, error, now());
}

async function writeDevEmail({ to, subject, text }) {
  const outbox = await readJson("emailOutbox", []);
  outbox.push({ id: createId("email"), to, subject, text, created_at: now() });
  await writeJson("emailOutbox", outbox);
  const code = text.match(/\b\d{6}\b/)?.[0];
  console.log(`[email:dev] ${subject} for ${to}${code ? `: ${code}` : ""}`);
}

async function sendVerificationEmail(email, code) {
  await deliverEmail({
    to: email,
    subject: "Your SysML Studio verification code",
    text: `Your SysML Studio verification code is ${code}. It expires in 10 minutes.`
  });
}

async function sendPasswordResetEmail(email, code) {
  await deliverEmail({
    to: email,
    subject: "Reset your SysML Studio password",
    text: `Your SysML Studio password reset code is ${code}. It expires in 10 minutes.`
  });
}

async function sendMemberInviteEmail(email, tenant, inviter, role) {
  await deliverEmail({
    to: email,
    subject: `Invitation to ${tenant.name} on SysML Studio`,
    text: `${inviter.email} invited you to ${tenant.name} as ${role}. Login with this email to join the workspace.`
  });
}

function starterDiagram(tenantId, projectId) {
  const timestamp = now();
  return {
    id: createId("diagram"),
    tenant_id: tenantId,
    project_id: projectId,
    type: "uml-class",
    name: "UML Class Diagram",
    version: 1,
    created_at: timestamp,
    updated_at: timestamp,
    metadata: { grid: 20 },
    elements: [
      { id: createId("class"), kind: "class", name: "FlightController", x: 120, y: 120, width: 180, height: 110, properties: { attributes: ["mode"], operations: ["stabilize()"] } },
      { id: createId("class"), kind: "class", name: "SensorBus", x: 430, y: 150, width: 170, height: 100, properties: { attributes: ["samples"], operations: ["read()"] } }
    ],
    relationships: []
  };
}

function blankDiagram(tenantId, projectId) {
  return { ...starterDiagram(tenantId, projectId), elements: [], relationships: [] };
}

function ensureUserWorkspace(user) {
  const timestamp = now();
  const existingTenant = db.prepare("SELECT * FROM tenants WHERE id = ?").get(user.tenant_id);
  if (!existingTenant) {
    insertTenant({ id: user.tenant_id, tenant_id: user.tenant_id, name: `${user.email} Workspace`, owner_user_id: user.id, created_at: timestamp, updated_at: timestamp });
  }

  upsertTenantMember({ tenant_id: user.tenant_id, user_id: user.id, email: user.email, role: user.role ?? "Owner", accepted_at: user.verified_at ?? timestamp });

  let project = db.prepare("SELECT * FROM projects WHERE tenant_id = ? ORDER BY created_at LIMIT 1").get(user.tenant_id);
  if (!project) {
    project = { id: createId("project"), tenant_id: user.tenant_id, name: "Untitled Project", description: "", created_at: timestamp, updated_at: timestamp };
    insertProject(project);
  }

  const diagram = db.prepare("SELECT * FROM diagrams WHERE tenant_id = ? ORDER BY created_at LIMIT 1").get(user.tenant_id);
  if (!diagram) insertDiagram(blankDiagram(user.tenant_id, project.id));
}

function createSession(user) {
  const session = {
    id: createId("session"),
    user_id: user.id,
    access_token: makeToken(),
    refresh_token: makeToken(),
    created_at: now(),
    expires_at: addDays(accessTokenDays),
    refresh_expires_at: addDays(refreshTokenDays)
  };
  db.prepare(`
    INSERT INTO sessions (id, user_id, access_token, refresh_token, created_at, expires_at, refresh_expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(session.id, session.user_id, session.access_token, session.refresh_token, session.created_at, session.expires_at, session.refresh_expires_at);
  return session;
}

function authContext(req) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return { user: null, tenantId: req.headers["x-tenant-id"] ?? "tenant_demo" };

  const session = db.prepare("SELECT * FROM sessions WHERE access_token = ? AND revoked_at IS NULL").get(token);
  if (!session || new Date(session.expires_at) <= new Date()) return { user: null, tenantId: req.headers["x-tenant-id"] ?? "tenant_demo" };

  const user = getUserById(session.user_id);
  if (!user) return { user: null, tenantId: req.headers["x-tenant-id"] ?? "tenant_demo" };
  return { user, tenantId: user.tenant_id, session };
}

function requireUser(req, res) {
  const context = authContext(req);
  if (!context.user) {
    send(res, 401, { error: "Login required." });
    return null;
  }
  return context;
}

function recordEvent(diagram, patch, actor = "local-user", reason = "diagram update") {
  db.prepare(`
    INSERT INTO events (id, tenant_id, project_id, diagram_id, version, actor_id, reason, created_at, patch)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(createId("event"), diagram.tenant_id, diagram.project_id, diagram.id, diagram.version, actor, reason, now(), JSON.stringify(patch ?? {}));
}

function projectRepository(tenantId, projectId) {
  const elements = db.prepare("SELECT * FROM model_elements WHERE project_id = ? AND tenant_id = ? ORDER BY created_at").all(projectId, tenantId).map((item) => ({ ...item, semantic: json(item.semantic, {}), stereotypes: json(item.stereotypes, []) }));
  const relationships = db.prepare("SELECT * FROM model_relationships WHERE project_id = ? AND tenant_id = ? ORDER BY created_at").all(projectId, tenantId).map((item) => ({ ...item, semantic: json(item.semantic, {}), stereotypes: json(item.stereotypes, []) }));
  return { elements, relationships };
}

function publicAiProposal(row) {
  const proposal = json(row.proposal, {});
  const patch = json(row.materialized_patch, {});
  const previewOperations = patch.operations.map((operation) => ({
    operation_id: operation.semantic_operation_id,
    kind: operation.op,
    ...(operation.op === "addElement" ? { element: operation.element } : {}),
    ...(operation.op === "updateElement" ? { element_id: operation.element_id, changes: operation.changes } : {}),
    ...(operation.op === "removeElement" ? { element_id: operation.element_id } : {}),
    ...(operation.op === "addRelationship" ? { relationship: operation.relationship } : {}),
    ...(operation.op === "removeRelationship" ? { relationship_id: operation.relationship_id } : {})
  }));
  return {
    id: row.id,
    diagram_id: row.diagram_id,
    base_diagram_version: row.base_diagram_version,
    task: row.task,
    status: row.status,
    provider: row.provider,
    model: row.model,
    created_at: row.created_at,
    expires_at: row.expires_at,
    summary: proposal.summary,
    assumptions: proposal.assumptions,
    clarification_questions: proposal.clarification_questions,
    comments: proposal.comments,
    operations: proposal.operations,
    layout_suggestions: proposal.layout_suggestions,
    validation: json(row.validation, {}),
    preview_operations: previewOperations
  };
}

function assertBodyKeys(input, allowed) {
  const extra = Object.keys(input ?? {}).find((key) => !allowed.includes(key));
  if (extra) {
    const error = new Error(`Unsupported request field: ${extra}`);
    error.statusCode = 400;
    throw error;
  }
}

function deterministicDiagramValidation(diagram) {
  const structural = validateDiagram(diagram);
  const model = decomposeDiagram(diagram);
  const diagnostics = validateModel({ elements: model.elements, relationships: model.relationships }, { diagramElementIds: new Set(model.elements.map((item) => item.id)) });
  return { valid: structural.valid && !diagnostics.some((item) => item.severity === "error"), errors: structural.errors, diagnostics };
}

function introducedValidationErrors(before, after) {
  const key = (item) => `${item.code}:${item.affectedElement?.id}:${item.message}`;
  const existing = new Set((before.diagnostics ?? []).filter((item) => item.severity === "error").map(key));
  return [
    ...(after.errors ?? []).filter((message) => !(before.errors ?? []).includes(message)),
    ...(after.diagnostics ?? []).filter((item) => item.severity === "error" && !existing.has(key(item))).map((item) => item.message)
  ];
}

function bootstrap(tenantId) {
  return {
    tenants: db.prepare("SELECT * FROM tenants WHERE id = ?").all(tenantId),
    projects: db.prepare("SELECT * FROM projects WHERE tenant_id = ? ORDER BY created_at").all(tenantId),
    diagrams: db.prepare("SELECT * FROM diagrams WHERE tenant_id = ? ORDER BY created_at").all(tenantId).map(diagramFromRow),
    members: db.prepare("SELECT * FROM tenant_members WHERE tenant_id = ? ORDER BY created_at").all(tenantId).map(publicMember)
  };
}

const handleAuthRoute = createAuthRouter({
  accessTokenDays, addDays, authContext, body, createId, createSession, db, ensureUserWorkspace,
  getUserByEmail, getUserById, hashPassword, isValidEmail, makeToken, makeVerificationCode,
  normalizeEmail, now, publicUser, rateLimit, send, sendPasswordResetEmail, sendVerificationEmail,
  tenantIdForEmail, upsertUser, validatePassword, verifyPassword
});

async function api(req, res, urlOrPath) {
  const pathname = typeof urlOrPath === "string" ? urlOrPath : urlOrPath.pathname;
  const searchParams = typeof urlOrPath === "string" ? new URLSearchParams() : urlOrPath.searchParams;
  if (pathname.startsWith("/api/auth/")) return handleAuthRoute(req, res, pathname);
  const protectedContext = requireUser(req, res);
  if (!protectedContext) return;
  const { user, tenantId } = protectedContext;
  if (pathname === "/api/bootstrap" && req.method === "GET") return send(res, 200, bootstrap(tenantId));

  if (pathname === "/api/settings" && req.method === "GET") {
    const context = requireUser(req, res);
    if (!context) return;
    return send(res, 200, { settings: getUserSettings(context.user.id) });
  }

  if (pathname === "/api/settings" && req.method === "PATCH") {
    const context = requireUser(req, res);
    if (!context) return;
    const input = await body(req);
    return send(res, 200, { settings: saveUserSettings(context.user.id, input) });
  }

  if (pathname === "/api/tenant/members" && req.method === "GET") {
    const context = requireUser(req, res);
    if (!context) return;
    return send(res, 200, { members: bootstrap(context.tenantId).members });
  }

  if (pathname === "/api/tenant/members" && req.method === "POST") {
    const context = requireUser(req, res);
    if (!context) return;
    const input = await body(req);
    const email = normalizeEmail(input.email);
    const role = ["Owner", "Admin", "Editor", "Commenter", "Viewer"].includes(input.role) ? input.role : "Viewer";
    if (!isValidEmail(email)) return send(res, 422, { error: "Enter a valid email address." });
    const invitedUser = getUserByEmail(email);
    upsertTenantMember({ tenant_id: context.tenantId, user_id: invitedUser?.id, email, role, invited_by: context.user.id, accepted_at: invitedUser?.verified_at });
    const tenant = db.prepare("SELECT * FROM tenants WHERE id = ?").get(context.tenantId);
    await sendMemberInviteEmail(email, tenant, context.user, role);
    return send(res, 201, { members: bootstrap(context.tenantId).members });
  }

  if (pathname === "/api/projects" && req.method === "GET") {
    return send(res, 200, {
      projects: projectsForTenant(tenantId, user?.id ?? null),
      recent: recentProjectsForUser(tenantId, user?.id ?? null),
      invitations: projectInvitationsForUser(tenantId, user?.email)
    });
  }

  if (pathname === "/api/projects" && req.method === "POST") {
    const input = await body(req);
    const timestamp = now();
    const project = { id: createId("project"), tenant_id: tenantId, name: input.name || "Untitled Project", description: input.description ?? "", created_at: timestamp, updated_at: timestamp };
    insertProject(project);
    const diagram = blankDiagram(tenantId, project.id);
    insertDiagram({ ...diagram, name: "Block Definition Diagram", type: "sysml-bdd" });
    recordProjectOpen(tenantId, user?.id, project.id);
    return send(res, 201, projectWithStats({ ...project, diagram_count: 1, last_opened_at: now() }));
  }

  const projectSharesMatch = pathname.match(/^\/api\/projects\/([^/]+)\/shares$/);
  if (projectSharesMatch && req.method === "GET") {
    const context = requireUser(req, res);
    if (!context) return;
    const project = db.prepare("SELECT id FROM projects WHERE id = ? AND tenant_id = ?").get(projectSharesMatch[1], context.tenantId);
    if (!project) return send(res, 404, { error: "Project not found" });
    const shares = db.prepare("SELECT email, role, accepted_at, created_at FROM project_shares WHERE project_id = ? AND tenant_id = ? ORDER BY created_at").all(project.id, context.tenantId);
    return send(res, 200, { shares });
  }

  if (projectSharesMatch && req.method === "POST") {
    const context = requireUser(req, res);
    if (!context) return;
    const project = db.prepare("SELECT * FROM projects WHERE id = ? AND tenant_id = ?").get(projectSharesMatch[1], context.tenantId);
    if (!project) return send(res, 404, { error: "Project not found" });
    const input = await body(req);
    const email = normalizeEmail(input.email);
    const role = ["Viewer", "Commenter", "Editor"].includes(input.role) ? input.role : "Viewer";
    if (!isValidEmail(email)) return send(res, 422, { error: "Enter a valid email address." });
    const invitedUser = getUserByEmail(email);
    const timestamp = now();
    db.prepare(`
      INSERT INTO project_shares (id, tenant_id, project_id, email, role, invited_by, accepted_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, email) DO UPDATE SET role = excluded.role, accepted_at = COALESCE(excluded.accepted_at, project_shares.accepted_at), updated_at = excluded.updated_at
    `).run(createId("share"), context.tenantId, project.id, email, role, context.user.id, invitedUser?.verified_at ?? null, timestamp, timestamp);
    upsertTenantMember({ tenant_id: context.tenantId, user_id: invitedUser?.id, email, role, invited_by: context.user.id, accepted_at: invitedUser?.verified_at });
    const tenant = db.prepare("SELECT * FROM tenants WHERE id = ?").get(context.tenantId);
    await sendMemberInviteEmail(email, tenant, context.user, role);
    const shares = db.prepare("SELECT email, role, accepted_at, created_at FROM project_shares WHERE project_id = ? AND tenant_id = ? ORDER BY created_at").all(project.id, context.tenantId);
    return send(res, 201, { shares });
  }

  const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (projectMatch && req.method === "PATCH") {
    const input = await body(req);
    const project = db.prepare("SELECT * FROM projects WHERE id = ? AND tenant_id = ?").get(projectMatch[1], tenantId);
    if (!project) return send(res, 404, { error: "Project not found" });
    const next = { ...project, name: input.name?.trim() || project.name, description: input.description ?? project.description, updated_at: now() };
    db.prepare("UPDATE projects SET name = ?, description = ?, updated_at = ? WHERE id = ? AND tenant_id = ?").run(next.name, next.description, next.updated_at, next.id, tenantId);
    return send(res, 200, projectWithStats({ ...next, diagram_count: db.prepare("SELECT COUNT(*) AS count FROM diagrams WHERE project_id = ? AND tenant_id = ?").get(next.id, tenantId).count }));
  }

  if (projectMatch && req.method === "DELETE") {
    const project = db.prepare("SELECT * FROM projects WHERE id = ? AND tenant_id = ?").get(projectMatch[1], tenantId);
    if (!project) return send(res, 404, { error: "Project not found" });
    db.prepare("DELETE FROM events WHERE project_id = ? AND tenant_id = ?").run(project.id, tenantId);
    db.prepare("DELETE FROM diagrams WHERE project_id = ? AND tenant_id = ?").run(project.id, tenantId);
    db.prepare("DELETE FROM diagram_views WHERE project_id = ? AND tenant_id = ?").run(project.id, tenantId);
    db.prepare("DELETE FROM model_relationships WHERE project_id = ? AND tenant_id = ?").run(project.id, tenantId);
    db.prepare("DELETE FROM model_elements WHERE project_id = ? AND tenant_id = ?").run(project.id, tenantId);
    db.prepare("DELETE FROM recent_projects WHERE project_id = ? AND tenant_id = ?").run(project.id, tenantId);
    db.prepare("DELETE FROM projects WHERE id = ? AND tenant_id = ?").run(project.id, tenantId);
    return send(res, 200, { ok: true });
  }

  const projectModelMatch = pathname.match(/^\/api\/projects\/([^/]+)\/model$/);
  if (projectModelMatch && req.method === "GET") {
    const project = db.prepare("SELECT id FROM projects WHERE id = ? AND tenant_id = ?").get(projectModelMatch[1], tenantId);
    if (!project) return send(res, 404, { error: "Project not found" });
    const elements = db.prepare("SELECT * FROM model_elements WHERE project_id = ? AND tenant_id = ? ORDER BY created_at").all(project.id, tenantId).map((item) => ({
      ...item,
      semantic: json(item.semantic, {}),
      stereotypes: json(item.stereotypes, [])
    }));
    const relationships = db.prepare("SELECT * FROM model_relationships WHERE project_id = ? AND tenant_id = ? ORDER BY created_at").all(project.id, tenantId).map((item) => ({
      ...item,
      semantic: json(item.semantic, {}),
      stereotypes: json(item.stereotypes, []),
      validation: json(item.validation, {})
    }));
    return send(res, 200, { schema_version: 2, elements, relationships });
  }

  const projectOpenMatch = pathname.match(/^\/api\/projects\/([^/]+)\/open$/);
  if (projectOpenMatch && req.method === "POST") {
    const project = db.prepare("SELECT * FROM projects WHERE id = ? AND tenant_id = ?").get(projectOpenMatch[1], tenantId);
    if (!project) return send(res, 404, { error: "Project not found" });
    let diagrams = db.prepare("SELECT * FROM diagrams WHERE project_id = ? AND tenant_id = ? ORDER BY created_at").all(project.id, tenantId).map(diagramFromRow);
    if (!diagrams.length) {
      const diagram = blankDiagram(tenantId, project.id);
      insertDiagram({ ...diagram, name: "Block Definition Diagram", type: "sysml-bdd" });
      diagrams = db.prepare("SELECT * FROM diagrams WHERE project_id = ? AND tenant_id = ? ORDER BY created_at").all(project.id, tenantId).map(diagramFromRow);
    }
    recordProjectOpen(tenantId, user?.id, project.id);
    return send(res, 200, { project: projectWithStats({ ...project, diagram_count: diagrams.length, last_opened_at: now() }), diagrams });
  }

  const projectMilestoneMatch = pathname.match(/^\/api\/projects\/([^/]+)\/versions\/milestone$/);
  if (projectMilestoneMatch && req.method === "POST") {
    const context = requireProjectPermission(req, res, projectMilestoneMatch[1], "edit");
    if (!context) return;
    const input = await body(req);
    const diagramIds = [...new Set(Array.isArray(input.diagram_ids) ? input.diagram_ids.map(String) : [])];
    if (!diagramIds.length) return send(res, 422, { error: "Select at least one tab for the milestone" });
    const owned = db.prepare("SELECT id FROM diagrams WHERE project_id = ? AND tenant_id = ?").all(context.project.id, context.tenantId).map(({ id }) => id);
    if (diagramIds.some((id) => !owned.includes(id))) return send(res, 422, { error: "A selected tab does not belong to this project" });
    const snapshot = createProjectSnapshot(context.tenantId, context.project.id, input.description || "Tab milestone", context.user?.id ?? null, diagramIds);
    return send(res, 201, { milestone: snapshot, versions: snapshotsForProject(context.tenantId, context.project.id) });
  }

  const projectVersionsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/versions$/);
  if (projectVersionsMatch && req.method === "GET") {
    const project = db.prepare("SELECT * FROM projects WHERE id = ? AND tenant_id = ?").get(projectVersionsMatch[1], tenantId);
    if (!project) return send(res, 404, { error: "Project not found" });
    return send(res, 200, { versions: snapshotsForProject(tenantId, project.id), baselines: listBaselines(tenantId, project.id) });
  }

  if (projectVersionsMatch && req.method === "POST") {
    const context = requireProjectPermission(req, res, projectVersionsMatch[1], "edit");
    if (!context) return;
    const input = await body(req);
    const snapshot = createProjectSnapshot(context.tenantId, context.project.id, input.description || "Named Baseline", context.user?.id ?? null);
    const baseline = createBaseline({
      id: createId("baseline"),
      name: input.name || `Baseline ${snapshot.version}`,
      description: input.description ?? "",
      version: snapshot.version,
      state: input.release ? "released" : "draft",
      created_by: context.user?.id ?? null
    });
    db.prepare(`
      INSERT INTO project_baselines (id, tenant_id, project_id, snapshot_id, version, name, description, state, released, created_by, created_at, released_by, released_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(baseline.id, context.tenantId, context.project.id, snapshot.id, snapshot.version, baseline.name, baseline.description, baseline.state, baseline.released ? 1 : 0, baseline.created_by, baseline.created_at, baseline.released ? context.user?.id ?? null : null, baseline.released ? now() : null);
    recordAudit({ tenantId: context.tenantId, projectId: context.project.id, actorId: context.user?.id, action: baseline.released ? "baseline.release" : "baseline.create", resourceType: "baseline", resourceId: baseline.id, description: `${baseline.released ? "Released" : "Created"} baseline ${baseline.name}`, metadata: { version: snapshot.version } });
    return send(res, 201, { baseline: publicBaseline(db.prepare("SELECT * FROM project_baselines WHERE id = ?").get(baseline.id)), versions: snapshotsForProject(context.tenantId, context.project.id), baselines: listBaselines(context.tenantId, context.project.id) });
  }

  const baselineReleaseMatch = pathname.match(/^\/api\/projects\/([^/]+)\/baselines\/([^/]+)\/release$/);
  if (baselineReleaseMatch && req.method === "POST") {
    const context = requireProjectPermission(req, res, baselineReleaseMatch[1], "approve");
    if (!context) return;
    const baseline = db.prepare("SELECT * FROM project_baselines WHERE id = ? AND tenant_id = ? AND project_id = ?").get(baselineReleaseMatch[2], context.tenantId, context.project.id);
    if (!baseline) return send(res, 404, { error: "Baseline not found" });
    assertBaselineMutable(publicBaseline(baseline));
    db.prepare("UPDATE project_baselines SET state = 'released', released = 1, released_by = ?, released_at = ? WHERE id = ?").run(context.user?.id ?? null, now(), baseline.id);
    recordAudit({ tenantId: context.tenantId, projectId: context.project.id, actorId: context.user?.id, action: "baseline.release", resourceType: "baseline", resourceId: baseline.id, description: `Released baseline ${baseline.name}` });
    return send(res, 200, { baseline: publicBaseline(db.prepare("SELECT * FROM project_baselines WHERE id = ?").get(baseline.id)) });
  }

  const projectCompareMatch = pathname.match(/^\/api\/projects\/([^/]+)\/versions\/compare$/);
  if (projectCompareMatch && req.method === "GET") {
    const context = requireProjectPermission(req, res, projectCompareMatch[1], "read");
    if (!context) return;
    const from = snapshotPayload(context.tenantId, context.project.id, searchParams.get("from"));
    const to = snapshotPayload(context.tenantId, context.project.id, searchParams.get("to"));
    if (!from || !to) return send(res, 404, { error: "Both versions are required for comparison" });
    recordAudit({ tenantId: context.tenantId, projectId: context.project.id, actorId: context.user?.id, action: "version.compare", resourceType: "project", resourceId: context.project.id, description: `Compared versions ${from.row.version} and ${to.row.version}` });
    return send(res, 200, { from: from.row.version, to: to.row.version, diff: compareProjectVersions(from.snapshot, to.snapshot) });
  }

  const projectHistoryMatch = pathname.match(/^\/api\/projects\/([^/]+)\/history$/);
  if (projectHistoryMatch && req.method === "GET") {
    const context = requireProjectPermission(req, res, projectHistoryMatch[1], "read");
    if (!context) return;
    const events = db.prepare("SELECT * FROM events WHERE tenant_id = ? AND project_id = ? ORDER BY created_at DESC LIMIT 100").all(context.tenantId, context.project.id).map((item) => ({ ...item, patch: json(item.patch, {}) }));
    const audit = db.prepare("SELECT * FROM audit_records WHERE tenant_id = ? AND project_id = ? ORDER BY created_at DESC LIMIT 100").all(context.tenantId, context.project.id).map((item) => ({ ...item, metadata: json(item.metadata, {}) }));
    return send(res, 200, { model: events, audit });
  }

  const restoreElementMatch = pathname.match(/^\/api\/projects\/([^/]+)\/versions\/([^/]+)\/restore-element$/);
  if (restoreElementMatch && req.method === "POST") {
    const context = requireProjectPermission(req, res, restoreElementMatch[1], "edit");
    if (!context) return;
    const input = await body(req);
    const payload = snapshotPayload(context.tenantId, context.project.id, restoreElementMatch[2]);
    if (!payload) return send(res, 404, { error: "Version not found" });
    const current = diagramFromRow(db.prepare("SELECT * FROM diagrams WHERE id = ? AND tenant_id = ?").get(input.diagram_id, context.tenantId));
    const sourceDiagram = payload.snapshot.diagrams?.find((item) => item.id === input.diagram_id);
    if (!current || !sourceDiagram) return send(res, 404, { error: "Diagram not found" });
    const next = { ...restoreElement(current, sourceDiagram, input.element_id), updated_at: now(), version: current.version + 1 };
    updateDiagram(next);
    recordAudit({ tenantId: context.tenantId, projectId: context.project.id, actorId: context.user?.id, action: "version.restore_element", resourceType: "model-element", resourceId: input.element_id, description: `Restored element ${input.element_id} from version ${payload.row.version}` });
    return send(res, 200, diagramFromRow(db.prepare("SELECT * FROM diagrams WHERE id = ? AND tenant_id = ?").get(next.id, context.tenantId)));
  }

  const restoreDiagramMatch = pathname.match(/^\/api\/projects\/([^/]+)\/versions\/([^/]+)\/restore-diagram$/);
  if (restoreDiagramMatch && req.method === "POST") {
    const context = requireProjectPermission(req, res, restoreDiagramMatch[1], "edit");
    if (!context) return;
    const input = await body(req);
    const payload = snapshotPayload(context.tenantId, context.project.id, restoreDiagramMatch[2]);
    if (!payload) return send(res, 404, { error: "Version not found" });
    const diagram = { ...restoreDiagram(payload.snapshot, input.diagram_id), tenant_id: context.tenantId, project_id: context.project.id, updated_at: now() };
    updateDiagram(diagram);
    recordAudit({ tenantId: context.tenantId, projectId: context.project.id, actorId: context.user?.id, action: "version.restore_diagram", resourceType: "diagram", resourceId: diagram.id, description: `Restored diagram ${diagram.name} from version ${payload.row.version}` });
    return send(res, 200, diagramFromRow(db.prepare("SELECT * FROM diagrams WHERE id = ? AND tenant_id = ?").get(diagram.id, context.tenantId)));
  }

  const projectRestoreMatch = pathname.match(/^\/api\/projects\/([^/]+)\/versions\/([^/]+)\/restore$/);
  if (projectRestoreMatch && req.method === "POST") {
    const projectId = projectRestoreMatch[1];
    const version = Number(projectRestoreMatch[2]);
    const context = requireProjectPermission(req, res, projectId, "edit");
    if (!context) return;
    const row = db.prepare("SELECT * FROM project_snapshots WHERE project_id = ? AND tenant_id = ? AND version = ?").get(projectId, tenantId, version);
    if (!row) return send(res, 404, { error: "Version not found" });
    const snapshot = JSON.parse(row.snapshot);
    db.prepare("DELETE FROM diagram_views WHERE project_id = ? AND tenant_id = ?").run(projectId, tenantId);
    db.prepare("DELETE FROM model_relationships WHERE project_id = ? AND tenant_id = ?").run(projectId, tenantId);
    db.prepare("DELETE FROM model_elements WHERE project_id = ? AND tenant_id = ?").run(projectId, tenantId);
    db.prepare("DELETE FROM diagrams WHERE project_id = ? AND tenant_id = ?").run(projectId, tenantId);
    for (const diagram of snapshot.diagrams ?? []) insertDiagram({ ...diagram, updated_at: now() });
    db.prepare("UPDATE projects SET name = ?, description = ?, updated_at = ? WHERE id = ? AND tenant_id = ?").run(snapshot.project.name, snapshot.project.description ?? "", now(), projectId, tenantId);
    const restoredProject = db.prepare("SELECT * FROM projects WHERE id = ? AND tenant_id = ?").get(projectId, tenantId);
    const diagrams = db.prepare("SELECT * FROM diagrams WHERE project_id = ? AND tenant_id = ? ORDER BY created_at").all(projectId, tenantId).map(diagramFromRow);
    recordAudit({ tenantId, projectId, actorId: context.user?.id, action: "version.restore_model", resourceType: "project", resourceId: projectId, description: `Restored model state from version ${version}` });
    return send(res, 200, { project: restoredProject, diagrams });
  }

  const projectReviewsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/reviews$/);
  if (projectReviewsMatch && req.method === "GET") {
    const context = requireProjectPermission(req, res, projectReviewsMatch[1], "read");
    if (!context) return;
    const reviews = db.prepare("SELECT * FROM project_reviews WHERE tenant_id = ? AND project_id = ? ORDER BY updated_at DESC").all(context.tenantId, context.project.id);
    return send(res, 200, { reviews });
  }

  if (projectReviewsMatch && req.method === "POST") {
    const context = requireProjectPermission(req, res, projectReviewsMatch[1], "review");
    if (!context) return;
    const input = await body(req);
    const review = { id: createId("review"), tenant_id: context.tenantId, project_id: context.project.id, baseline_id: input.baseline_id ?? null, title: input.title || "Engineering Review", description: input.description ?? "", status: "open", created_by: context.user?.id ?? "local-user", created_at: now(), updated_at: now() };
    db.prepare(`
      INSERT INTO project_reviews (id, tenant_id, project_id, baseline_id, title, description, status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(review.id, review.tenant_id, review.project_id, review.baseline_id, review.title, review.description, review.status, review.created_by, review.created_at, review.updated_at);
    recordAudit({ tenantId: context.tenantId, projectId: context.project.id, actorId: context.user?.id, action: "review.create", resourceType: "review", resourceId: review.id, description: `Opened review ${review.title}` });
    return send(res, 201, { review });
  }

  const approvalMatch = pathname.match(/^\/api\/projects\/([^/]+)\/reviews\/([^/]+)\/approval$/);
  if (approvalMatch && req.method === "POST") {
    const context = requireProjectPermission(req, res, approvalMatch[1], "approve");
    if (!context) return;
    const review = db.prepare("SELECT * FROM project_reviews WHERE tenant_id = ? AND project_id = ? AND id = ?").get(context.tenantId, context.project.id, approvalMatch[2]);
    if (!review) return send(res, 404, { error: "Review not found" });
    const input = await body(req);
    const decision = ["approved", "changes-requested", "rejected"].includes(input.decision) ? input.decision : "approved";
    db.prepare(`
      INSERT INTO review_approvals (id, tenant_id, review_id, actor_id, decision, comment, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(createId("approval"), context.tenantId, review.id, context.user?.id ?? "local-user", decision, input.comment ?? "", now());
    const status = decision === "approved" ? "approved" : "changes-requested";
    db.prepare("UPDATE project_reviews SET status = ?, updated_at = ? WHERE id = ?").run(status, now(), review.id);
    recordAudit({ tenantId: context.tenantId, projectId: context.project.id, actorId: context.user?.id, action: "review.approval", resourceType: "review", resourceId: review.id, description: `${decision} review ${review.title}` });
    return send(res, 200, { review: db.prepare("SELECT * FROM project_reviews WHERE id = ?").get(review.id), approvals: db.prepare("SELECT * FROM review_approvals WHERE review_id = ? ORDER BY created_at DESC").all(review.id) });
  }

  const collaborationMatch = pathname.match(/^\/api\/projects\/([^/]+)\/collaboration$/);
  if (collaborationMatch && req.method === "GET") {
    const diagramId = searchParams.get("diagram_id");
    const context = requireProjectPermission(req, res, collaborationMatch[1], "read");
    if (!context) return;
    if (!diagramId) return send(res, 422, { error: "diagram_id is required" });
    const diagram = diagramFromRow(db.prepare(
      "SELECT * FROM diagrams WHERE id = ? AND project_id = ? AND tenant_id = ?"
    ).get(diagramId, context.project.id, context.tenantId));
    if (!diagram) return send(res, 404, { error: "Diagram not found" });
    return send(res, 200, {
      role: context.role,
      permissions: context.permissions,
      diagram,
      presence: activePresence(context.tenantId, context.project.id, diagramId, context.user?.id ?? `guest_${context.tenantId}`),
      comments: commentsForDiagram(context.tenantId, context.project.id, diagramId, context.user?.id ?? "", context.permissions),
      notifications: db.prepare("SELECT * FROM notifications WHERE tenant_id = ? AND project_id = ? AND (user_id IS NULL OR user_id = ?) ORDER BY created_at DESC LIMIT 20").all(context.tenantId, context.project.id, context.user?.id ?? "")
    });
  }

  if (collaborationMatch && req.method === "POST") {
    const context = requireProjectPermission(req, res, collaborationMatch[1], "read");
    if (!context) return;
    const input = await body(req);
    const diagramId = input.diagram_id;
    if (!diagramId) return send(res, 422, { error: "diagram_id is required" });
    const userId = context.user?.id ?? `guest_${context.tenantId}`;
    const name = context.user?.email?.split("@")[0] ?? "Guest";
    const color = `hsl(${Math.abs([...userId].reduce((sum, character) => sum + character.charCodeAt(0), 0)) % 360} 78% 58%)`;
    db.prepare(`
      INSERT INTO collaboration_presence (id, tenant_id, project_id, diagram_id, user_id, name, role, cursor, selection, color, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, diagram_id, user_id) DO UPDATE SET cursor = excluded.cursor, selection = excluded.selection, role = excluded.role, updated_at = excluded.updated_at
    `).run(createId("presence"), context.tenantId, context.project.id, diagramId, userId, name, context.role, JSON.stringify(input.cursor ?? null), JSON.stringify(input.selection ?? []), color, now());
    return send(res, 200, { ok: true, presence: activePresence(context.tenantId, context.project.id, diagramId, userId) });
  }

  const commentsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/comments$/);
  if (commentsMatch && req.method === "POST") {
    const context = requireProjectPermission(req, res, commentsMatch[1], "comment");
    if (!context) return;
    const input = await body(req);
    const commentBody = String(input.body ?? "").trim();
    if (!commentBody || commentBody.length > 5000) return send(res, 422, { error: "Comment text is required and must be 5,000 characters or fewer." });
    const mentions = extractMentions(commentBody);
    let parent = null;
    if (input.parent_id) {
      parent = db.prepare("SELECT * FROM collaboration_comments WHERE id = ? AND tenant_id = ? AND project_id = ?").get(input.parent_id, context.tenantId, context.project.id);
      if (!parent || parent.status !== "open") return send(res, 409, { error: "This comment thread is unavailable or resolved." });
      if (parent.parent_id) parent = db.prepare("SELECT * FROM collaboration_comments WHERE id = ? AND tenant_id = ? AND project_id = ?").get(parent.parent_id, context.tenantId, context.project.id);
      if (!parent || parent.status !== "open") return send(res, 409, { error: "This comment thread is unavailable or resolved." });
    }
    const anchorType = parent?.anchor_type ?? (input.anchor_type === "canvas" ? "canvas" : "element");
    const anchorX = parent?.anchor_x ?? Number(input.anchor_x);
    const anchorY = parent?.anchor_y ?? Number(input.anchor_y);
    const anchorId = parent?.anchor_id ?? String(input.anchor_id || (anchorType === "canvas" && Number.isFinite(anchorX) && Number.isFinite(anchorY) ? `canvas:${Math.round(anchorX)}:${Math.round(anchorY)}` : ""));
    const comment = { id: createId("comment"), tenant_id: context.tenantId, project_id: context.project.id, diagram_id: parent?.diagram_id ?? input.diagram_id, anchor_type: anchorType, anchor_id: anchorId, anchor_x: Number.isFinite(anchorX) ? Math.max(0, anchorX) : null, anchor_y: Number.isFinite(anchorY) ? Math.max(0, anchorY) : null, parent_id: parent?.id ?? null, body: commentBody, mentions, status: "open", created_by: context.user?.id ?? "local-user", created_at: now(), updated_at: now() };
    if (!comment.diagram_id || !comment.anchor_id || (comment.anchor_type === "canvas" && (comment.anchor_x === null || comment.anchor_y === null))) return send(res, 422, { error: "A valid diagram and element or canvas anchor are required." });
    const diagram = diagramFromRow(db.prepare("SELECT * FROM diagrams WHERE id = ? AND project_id = ? AND tenant_id = ?").get(comment.diagram_id, context.project.id, context.tenantId));
    if (!diagram) return send(res, 404, { error: "Diagram not found" });
    if (comment.anchor_type === "element" && !diagram.elements.some((item) => item.id === comment.anchor_id)) return send(res, 422, { error: "The comment element no longer exists." });
    db.prepare(`
      INSERT INTO collaboration_comments (id, tenant_id, project_id, diagram_id, anchor_type, anchor_id, anchor_x, anchor_y, parent_id, body, mentions, status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(comment.id, comment.tenant_id, comment.project_id, comment.diagram_id, comment.anchor_type, comment.anchor_id, comment.anchor_x, comment.anchor_y, comment.parent_id, comment.body, JSON.stringify(comment.mentions), comment.status, comment.created_by, comment.created_at, comment.updated_at);
    markCommentThreadRead({ tenantId: context.tenantId, projectId: context.project.id, threadId: parent?.id ?? comment.id, userId: comment.created_by, readAt: comment.updated_at });
    for (const mention of mentions) {
      const target = getUserByEmail(mention.includes("@") ? mention : `${mention}@local.invalid`);
      db.prepare("INSERT INTO notifications (id, tenant_id, project_id, user_id, type, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(createId("notification"), context.tenantId, context.project.id, target?.id ?? null, "mention", `${context.user?.email ?? "A collaborator"} mentioned @${mention}`, now());
    }
    recordAudit({ tenantId: context.tenantId, projectId: context.project.id, actorId: context.user?.id, action: comment.parent_id ? "comment.reply" : "comment.create", resourceType: "comment", resourceId: comment.id, description: `${comment.parent_id ? "Replied" : "Commented"} on ${comment.anchor_type} ${comment.anchor_id}` });
    return send(res, 201, { comment: { id: comment.id, thread_id: parent?.id ?? comment.id }, comments: commentsForDiagram(context.tenantId, context.project.id, comment.diagram_id, context.user?.id ?? "", context.permissions) });
  }

  const commentMatch = pathname.match(/^\/api\/projects\/([^/]+)\/comments\/([^/]+)$/);
  if (commentMatch && req.method === "PATCH") {
    const context = requireProjectPermission(req, res, commentMatch[1], "read");
    if (!context) return;
    const input = await body(req);
    assertBodyKeys(input, ["action", "body"]);
    const comment = db.prepare("SELECT * FROM collaboration_comments WHERE id = ? AND tenant_id = ? AND project_id = ?").get(commentMatch[2], context.tenantId, context.project.id);
    if (!comment) return send(res, 404, { error: "Comment not found" });
    const rootId = comment.parent_id || comment.id;
    const root = comment.parent_id ? db.prepare("SELECT * FROM collaboration_comments WHERE id = ? AND tenant_id = ? AND project_id = ?").get(rootId, context.tenantId, context.project.id) : comment;
    if (!root) return send(res, 409, { error: "The parent comment thread no longer exists." });
    const isAuthor = comment.created_by === context.user?.id;
    const administer = context.permissions.includes("admin");
    const canResolve = !comment.parent_id && (isAuthor || context.permissions.includes("edit") || administer);
    const action = input.action;
    if (!["mark-read", "mark-unread"].includes(action) && !context.permissions.includes("comment")) return send(res, 403, { error: "Comment permission is required." });
    if (action === "mark-read") markCommentThreadRead({ tenantId: context.tenantId, projectId: context.project.id, threadId: rootId, userId: context.user.id });
    else if (action === "mark-unread") db.prepare("DELETE FROM collaboration_comment_reads WHERE tenant_id = ? AND project_id = ? AND thread_id = ? AND user_id = ?").run(context.tenantId, context.project.id, rootId, context.user.id);
    else if (action === "edit") {
      if (!isAuthor || comment.status === "deleted") return send(res, 403, { error: "You may only edit your own comments." });
      const nextBody = String(input.body ?? "").trim();
      if (!nextBody || nextBody.length > 5000) return send(res, 422, { error: "Comment text is required and must be 5,000 characters or fewer." });
      db.prepare("UPDATE collaboration_comments SET body = ?, mentions = ?, edited_at = ?, updated_at = ? WHERE id = ?").run(nextBody, JSON.stringify(extractMentions(nextBody)), now(), now(), comment.id);
    } else if (action === "delete") {
      if ((!isAuthor && !administer) || comment.status === "deleted") return send(res, 403, { error: "You may only delete your own comments." });
      const timestamp = now();
      if (!comment.parent_id) db.prepare("UPDATE collaboration_comments SET status = 'deleted', deleted_at = ?, updated_at = ? WHERE id = ? OR parent_id = ?").run(timestamp, timestamp, comment.id, comment.id);
      else db.prepare("UPDATE collaboration_comments SET status = 'deleted', deleted_at = ?, updated_at = ? WHERE id = ?").run(timestamp, timestamp, comment.id);
    } else if (action === "resolve" || action === "reopen") {
      if (!canResolve || root.status === "deleted") return send(res, 403, { error: "You do not have permission to change this thread." });
      db.prepare("UPDATE collaboration_comments SET status = ?, updated_at = ? WHERE id = ?").run(action === "resolve" ? "resolved" : "open", now(), rootId);
    } else return send(res, 422, { error: "Unsupported comment action." });
    if (!["mark-read", "mark-unread"].includes(action)) recordAudit({ tenantId: context.tenantId, projectId: context.project.id, actorId: context.user?.id, action: `comment.${action}`, resourceType: "comment", resourceId: comment.id, description: `${action} comment ${comment.id}` });
    return send(res, 200, { comments: commentsForDiagram(context.tenantId, context.project.id, comment.diagram_id, context.user?.id ?? "", context.permissions) });
  }

  // const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
  // if (projectMatch && req.method === "PUT") {
  //   const current = db.prepare("SELECT * FROM projects WHERE id = ? AND tenant_id = ?").get(projectMatch[1], tenantId);
  //   if (!current) return send(res, 404, { error: "Project not found" });
  //   const input = await body(req);
  //   const name = String(input.name ?? "").trim();
  //   if (!name) return send(res, 422, { error: "Project name is required" });
  //   const project = { ...current, name, description: String(input.description ?? current.description), updated_at: now() };
  //   updateProject(project);
  //   return send(res, 200, project);
  // }

  if (pathname === "/api/diagrams" && req.method === "POST") {
    const input = await body(req);
    const context = requireProjectPermission(req, res, input.project_id, "edit");
    if (!context) return;
    const diagram = { id: createId("diagram"), tenant_id: tenantId, project_id: context.project.id, type: input.type, name: input.name, version: 1, created_at: now(), updated_at: now(), metadata: {}, elements: [], relationships: [] };
    insertDiagram(diagram);
    return send(res, 201, diagram);
  }

  const diagramDuplicateMatch = pathname.match(/^\/api\/diagrams\/([^/]+)\/duplicate$/);
  if (diagramDuplicateMatch && req.method === "POST") {
    const current = diagramFromRow(db.prepare("SELECT * FROM diagrams WHERE id = ? AND tenant_id = ?").get(diagramDuplicateMatch[1], tenantId));
    if (!current) return send(res, 404, { error: "Diagram not found" });
    const context = requireProjectPermission(req, res, current.project_id, "edit");
    if (!context) return;
    const copy = { ...current, id: createId("diagram"), name: `${current.name} Copy`, version: 1, created_at: now(), updated_at: now() };
    insertDiagram(copy);
    return send(res, 201, copy);
  }

  const diagramMatch = pathname.match(/^\/api\/diagrams\/([^/]+)$/);
  if (diagramMatch && req.method === "PATCH") {
    const input = await body(req);
    const current = diagramFromRow(db.prepare("SELECT * FROM diagrams WHERE id = ? AND tenant_id = ?").get(diagramMatch[1], tenantId));
    if (!current) return send(res, 404, { error: "Diagram not found" });
    const context = requireProjectPermission(req, res, current.project_id, "edit");
    if (!context) return;
    const next = { ...current, name: input.name?.trim() || current.name, updated_at: now() };
    updateDiagram(next);
    return send(res, 200, next);
  }

  if (diagramMatch && req.method === "DELETE") {
    const current = db.prepare("SELECT * FROM diagrams WHERE id = ? AND tenant_id = ?").get(diagramMatch[1], tenantId);
    if (!current) return send(res, 404, { error: "Diagram not found" });
    const context = requireProjectPermission(req, res, current.project_id, "edit");
    if (!context) return;
    db.prepare("DELETE FROM events WHERE diagram_id = ? AND tenant_id = ?").run(current.id, tenantId);
    db.prepare("DELETE FROM diagrams WHERE id = ? AND tenant_id = ?").run(current.id, tenantId);
    db.prepare("DELETE FROM diagram_views WHERE diagram_id = ? AND tenant_id = ?").run(current.id, tenantId);
    db.prepare("UPDATE projects SET updated_at = ? WHERE id = ? AND tenant_id = ?").run(now(), current.project_id, tenantId);
    return send(res, 200, { ok: true });
  }

  if (diagramMatch && req.method === "PUT") {
    const input = await body(req);
    const current = db.prepare("SELECT * FROM diagrams WHERE id = ? AND tenant_id = ?").get(diagramMatch[1], tenantId);
    if (!current) return send(res, 404, { error: "Diagram not found" });
    const context = requireProjectPermission(req, res, current.project_id, "edit");
    if (!context) return;
    if (Number(input.version) !== Number(current.version)) {
      return send(res, 409, {
        error: "This diagram was changed by another collaborator. Review the latest shared version before saving again.",
        current_version: current.version
      });
    }
    const candidate = {
      ...input,
      id: current.id,
      tenant_id: tenantId,
      project_id: current.project_id,
      updated_at: now(),
      version: current.version + 1
    };
    const validation = validateDiagram(candidate);
    if (!validation.valid) return send(res, 422, validation);
    updateDiagram(candidate);
    recordEvent(candidate, { summary: "Saved full diagram state", operations: [] }, user?.id ?? "local-user", "save");
    db.prepare("UPDATE projects SET updated_at = ? WHERE id = ? AND tenant_id = ?").run(now(), candidate.project_id, tenantId);
    if (searchParams.get("snapshot") === "1") createProjectSnapshot(tenantId, candidate.project_id, "Manual Save", user?.id ?? null);
    return send(res, 200, diagramFromRow(db.prepare("SELECT * FROM diagrams WHERE id = ? AND tenant_id = ?").get(candidate.id, tenantId)));
  }

  if (pathname === "/api/ai/config" && req.method === "GET") {
    const key = activeAiKey(tenantId);
    const provider = key?.provider === "openai" ? "openai" : (["local", "ollama"].includes(process.env.DEFAULT_AI_PROVIDER) ? process.env.DEFAULT_AI_PROVIDER : "local");
    const model = provider === "openai" ? key.model : provider === "ollama" ? (process.env.OLLAMA_MODEL ?? "qwen2.5:7b") : "structured-local-parser";
    return send(res, 200, { provider, model, supported_diagram_types: diagramTypes });
  }

  if (pathname === "/api/ai/preview" && req.method === "POST") {
    const input = await body(req);
    assertBodyKeys(input, ["project_id", "diagram_id", "selected_element_ids", "prompt", "task"]);
    const task = input.task === "review" ? "review" : "generate";
    const context = requireProjectPermission(req, res, input.project_id, task === "review" ? "review" : "edit");
    if (!context) return;
    const diagram = diagramFromRow(db.prepare("SELECT * FROM diagrams WHERE id = ? AND project_id = ? AND tenant_id = ?").get(input.diagram_id, context.project.id, tenantId));
    if (!diagram) return send(res, 404, { error: "Diagram not found" });
    if (!isAiDiagramSupported(diagram.type)) return send(res, 422, { error: `The active diagram type is unsupported: ${diagram.type}` });
    const prompt = String(input.prompt ?? "").trim();
    if (task === "generate" && !prompt) return send(res, 422, { error: "Describe the diagram you want to generate." });
    if (prompt.length > 6000) return send(res, 413, { error: "The AI request is too long." });
    const deterministicValidation = deterministicDiagramValidation(diagram);
    const aiContext = buildAiContext({ task, prompt, diagram, selectedElementIds: Array.isArray(input.selected_element_ids) ? input.selected_element_ids.slice(0, 100) : [], repository: projectRepository(tenantId, context.project.id), validation: deterministicValidation });
    let providerConfig;
    try { providerConfig = configuredAiProvider(tenantId); }
    catch (error) { return send(res, 500, { error: error.message }); }
    const startedAt = Date.now();
    let rawProposal;
    try {
      rawProposal = await aiProviders.proposeWith(providerConfig.provider, { context: aiContext, instructions: providerInstructions });
    } catch (error) {
      return send(res, 502, { error: error.message });
    }
    let proposal;
    try {
      proposal = validateAiProposal(rawProposal, diagram.type);
      validateProposalReferences(diagram, proposal);
    } catch (error) {
      return send(res, 422, { error: `AI returned an invalid proposal: ${error.message}` });
    }
    const materializedPatch = materializeSemanticProposal(diagram, proposal, createId);
    const candidate = applyPatch(diagram, materializedPatch);
    const validation = deterministicDiagramValidation(candidate);
    const introducedErrors = introducedValidationErrors(deterministicValidation, validation);
    if (introducedErrors.length) return send(res, 422, { error: "The proposed model introduced deterministic validation errors.", validation, introduced_errors: introducedErrors });
    const proposalId = createId("ai_proposal");
    const createdAt = now();
    const expiresAt = new Date(Date.now() + 20 * 60 * 1000).toISOString();
    const contextHash = createHash("sha256").update(JSON.stringify(aiContext)).digest("hex");
    db.prepare(`
      INSERT INTO ai_proposals (id, tenant_id, project_id, diagram_id, base_diagram_version, task, prompt, provider, model, proposal, materialized_patch, validation, status, created_by, created_at, expires_at, context_hash, latency_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)
    `).run(proposalId, tenantId, context.project.id, diagram.id, diagram.version, task, prompt, providerConfig.name, providerConfig.model, JSON.stringify(proposal), JSON.stringify(materializedPatch), JSON.stringify(validation), user.id, createdAt, expiresAt, contextHash, Date.now() - startedAt);
    recordAudit({ tenantId, projectId: context.project.id, actorId: user.id, action: `ai.${task}.proposed`, resourceType: "ai-proposal", resourceId: proposalId, description: proposal.summary, metadata: { diagram_id: diagram.id, base_diagram_version: diagram.version, provider: providerConfig.name, operation_count: proposal.operations.length, context_hash: contextHash } });
    return send(res, 201, publicAiProposal(db.prepare("SELECT * FROM ai_proposals WHERE id = ?").get(proposalId)));
  }

  if (pathname === "/api/ai/apply" && req.method === "POST") {
    const input = await body(req);
    assertBodyKeys(input, ["proposal_id", "selected_operation_ids", "approved"]);
    if (input.approved !== true) return send(res, 422, { error: "Explicit approval is required before applying an AI proposal." });
    const row = db.prepare("SELECT * FROM ai_proposals WHERE id = ? AND tenant_id = ?").get(input.proposal_id, tenantId);
    if (!row) return send(res, 404, { error: "AI proposal not found" });
    const context = requireProjectPermission(req, res, row.project_id, "edit");
    if (!context) return;
    if (row.created_by !== user.id && !context.permissions.includes("admin")) return send(res, 403, { error: "Only the proposal creator or a project administrator may apply it." });
    if (row.status !== "pending") return send(res, 409, { error: `This AI proposal is already ${row.status}.` });
    if (new Date(row.expires_at) <= new Date()) {
      db.prepare("UPDATE ai_proposals SET status = 'expired' WHERE id = ?").run(row.id);
      return send(res, 410, { error: "This AI proposal expired. Generate a new preview." });
    }
    const diagram = diagramFromRow(db.prepare("SELECT * FROM diagrams WHERE id = ? AND project_id = ? AND tenant_id = ?").get(row.diagram_id, row.project_id, tenantId));
    if (!diagram) return send(res, 404, { error: "Diagram not found" });
    if (diagram.version !== row.base_diagram_version) return send(res, 409, { error: "The diagram changed after this proposal was created. Generate a new preview." });
    const selectedIds = Array.isArray(input.selected_operation_ids) ? [...new Set(input.selected_operation_ids.map(String))] : [];
    const proposal = json(row.proposal, {});
    const allowedIds = new Set((proposal.operations ?? []).map((item) => item.id));
    if (!selectedIds.length || selectedIds.some((id) => !allowedIds.has(id))) return send(res, 422, { error: "Choose one or more valid proposal operations." });
    const storedPatch = json(row.materialized_patch, {});
    let operations;
    try { operations = selectMaterializedOperations(storedPatch, selectedIds); }
    catch (error) { return send(res, 422, { error: error.message }); }
    const patch = { summary: proposal.summary, operations };
    const next = applyPatch(diagram, patch);
    const validation = deterministicDiagramValidation(next);
    const currentValidation = deterministicDiagramValidation(diagram);
    const introducedErrors = introducedValidationErrors(currentValidation, validation);
    if (introducedErrors.length) return send(res, 422, { error: "The selected proposal operations introduced deterministic validation errors.", validation, introduced_errors: introducedErrors });
    db.exec("BEGIN IMMEDIATE");
    try {
      updateDiagram(next);
      recordEvent(next, patch, user.id, `AI proposal: ${proposal.summary}`);
      db.prepare("UPDATE projects SET updated_at = ? WHERE id = ? AND tenant_id = ?").run(now(), next.project_id, tenantId);
      db.prepare("UPDATE ai_proposals SET status = 'applied', applied_at = ?, applied_operation_ids = ? WHERE id = ? AND status = 'pending'").run(now(), JSON.stringify(selectedIds), row.id);
      recordAudit({ tenantId, projectId: row.project_id, actorId: user.id, action: "ai.proposal.applied", resourceType: "ai-proposal", resourceId: row.id, description: proposal.summary, metadata: { diagram_id: diagram.id, from_version: diagram.version, to_version: next.version, accepted_operation_ids: selectedIds, rejected_operation_ids: [...allowedIds].filter((id) => !selectedIds.includes(id)) } });
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return send(res, 200, { diagram: diagramFromRow(db.prepare("SELECT * FROM diagrams WHERE id = ? AND tenant_id = ?").get(next.id, tenantId)), proposal: publicAiProposal(db.prepare("SELECT * FROM ai_proposals WHERE id = ?").get(row.id)) });
  }

  const aiProposalMatch = pathname.match(/^\/api\/ai\/proposals\/([^/]+)$/);
  if (aiProposalMatch && req.method === "DELETE") {
    const row = db.prepare("SELECT * FROM ai_proposals WHERE id = ? AND tenant_id = ?").get(aiProposalMatch[1], tenantId);
    if (!row) return send(res, 404, { error: "AI proposal not found" });
    const context = requireProjectPermission(req, res, row.project_id, "read");
    if (!context) return;
    if (row.created_by !== user.id && !context.permissions.includes("admin")) return send(res, 403, { error: "Only the proposal creator or a project administrator may reject it." });
    if (row.status === "pending") db.prepare("UPDATE ai_proposals SET status = 'rejected' WHERE id = ?").run(row.id);
    recordAudit({ tenantId, projectId: row.project_id, actorId: user.id, action: "ai.proposal.rejected", resourceType: "ai-proposal", resourceId: row.id, description: "Rejected AI proposal", metadata: { diagram_id: row.diagram_id } });
    return send(res, 200, { ok: true });
  }

  if (pathname === "/api/ai/keys" && req.method === "GET") {
    if (!permissionsForRole(user.role).includes("admin")) return send(res, 403, { error: "Tenant administrator permission is required." });
    const keys = db.prepare("SELECT id, provider, model, display_name, active, created_at FROM ai_keys WHERE tenant_id = ? ORDER BY created_at DESC").all(tenantId).map((item) => ({ ...item, active: Boolean(item.active) }));
    const active = keys.find((item) => item.active);
    return send(res, 200, { provider: active?.provider ?? "local", model: active?.model ?? "structured-local-parser", keys });
  }

  if (pathname === "/api/ai/keys" && req.method === "POST") {
    if (!permissionsForRole(user.role).includes("admin")) return send(res, 403, { error: "Tenant administrator permission is required." });
    const input = await body(req);
    assertBodyKeys(input, ["provider", "model", "display_name", "api_key", "active"]);
    if (input.provider !== "openai") return send(res, 422, { error: "Only OpenAI API keys are accepted here. Local AI does not require a key." });
    const apiKey = String(input.api_key ?? "").trim();
    const model = String(input.model ?? "").trim();
    const displayName = String(input.display_name ?? "").trim();
    if (apiKey.length < 20) return send(res, 422, { error: "Enter a valid OpenAI API key." });
    if (!model || model.length > 100 || !/^[A-Za-z0-9._:-]+$/.test(model)) return send(res, 422, { error: "Enter a valid OpenAI model name." });
    if (!displayName || displayName.length > 80) return send(res, 422, { error: "Enter a display name of 80 characters or fewer." });
    const item = { id: createId("key"), tenant_id: tenantId, provider: "openai", model, display_name: displayName, encrypted_api_key: encryptSecret(apiKey), active: true, created_at: now() };
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("UPDATE ai_keys SET active = 0 WHERE tenant_id = ?").run(tenantId);
      db.prepare("INSERT INTO ai_keys (id, tenant_id, provider, model, display_name, encrypted_api_key, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)").run(item.id, item.tenant_id, item.provider, item.model, item.display_name, item.encrypted_api_key, item.created_at);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    const { encrypted_api_key, ...safe } = item;
    return send(res, 201, safe);
  }

  if (pathname === "/api/ai/provider" && req.method === "POST") {
    if (!permissionsForRole(user.role).includes("admin")) return send(res, 403, { error: "Tenant administrator permission is required." });
    const input = await body(req);
    assertBodyKeys(input, ["provider"]);
    if (input.provider !== "local") return send(res, 422, { error: "Save an OpenAI API key to select OpenAI." });
    db.prepare("UPDATE ai_keys SET active = 0 WHERE tenant_id = ?").run(tenantId);
    return send(res, 200, { provider: "local", model: "structured-local-parser" });
  }

  const exportMatch = pathname.match(/^\/api\/diagrams\/([^/]+)\/export\/pdf$/);
  if (exportMatch && req.method === "GET") {
    const diagram = diagramFromRow(db.prepare("SELECT * FROM diagrams WHERE id = ? AND tenant_id = ?").get(exportMatch[1], tenantId));
    if (!diagram) return send(res, 404, { error: "Diagram not found" });
    const pdf = Buffer.from(toVectorPdf(diagram));
    res.writeHead(200, { "content-type": "application/pdf", "content-disposition": `attachment; filename="${diagram.name}.pdf"` });
    return res.end(pdf);
  }

  return send(res, 404, { error: "Not found" });
}

migrateSchema(db);
await migrateJsonData();
migrateLegacyDiagrams();

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    return await serveStaticFile({ root, res, pathname: url.pathname });
  } catch (error) {
    if ((error.statusCode ?? 500) >= 500) console.error(error);
    send(res, error.statusCode ?? 500, { error: error.message });
  }
}).listen(port, () => {
  console.log(`SysML/UML modeling tool running at http://localhost:${port}`);
  console.log(`SQLite database: ${dbPath}`);
});
