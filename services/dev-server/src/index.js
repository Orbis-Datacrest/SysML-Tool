import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { applyPatch, assertBaselineMutable, compareProjectVersions, createBaseline, createId, decomposeDiagram, hydrateDiagram, restoreDiagram, restoreElement, validateDiagram, validateRelationshipCompatibility } from "../../../packages/model-core/src/index.js";
import { toVectorPdf } from "../../../apps/import-export/src/exporters.js";
import { accessTokenDays, authMaxAttempts, authWindowMs, dataDir, dbPath, port, refreshTokenDays, root } from "./config.js";
import { addDays, encryptSecret, hashPassword, isValidEmail, makeToken, makeVerificationCode, normalizeEmail, now, tenantIdForEmail, validatePassword, verifyPassword } from "./auth/security.js";
import { readJsonBody as body, sendJson as send } from "./http/responses.js";
import { serveStaticFile } from "./http/staticFiles.js";
import { migrateSchema } from "./database/migrateSchema.js";
import { createAuthRouter } from "./routes/createAuthRouter.js";

await mkdir(dataDir, { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

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

function commentsForDiagram(tenantId, projectId, diagramId) {
  return db.prepare(`
    SELECT c.*, COALESCE(u.email, c.created_by) AS author
    FROM collaboration_comments c
    LEFT JOIN users u ON u.id = c.created_by
    WHERE c.tenant_id = ? AND c.project_id = ? AND c.diagram_id = ?
    ORDER BY c.created_at ASC
  `).all(tenantId, projectId, diagramId).map((item) => ({
    id: item.id,
    anchor_type: item.anchor_type,
    anchor_id: item.anchor_id,
    parent_id: item.parent_id,
    body: item.body,
    mentions: json(item.mentions, []),
    status: item.status,
    author: item.author,
    created_by: item.created_by,
    created_at: item.created_at,
    updated_at: item.updated_at
  }));
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

function makeAiPatch(diagram, prompt) {
  const lower = prompt.toLowerCase();
  const baseX = 120 + diagram.elements.length * 42;
  const baseY = 280 + diagram.elements.length * 18;
  if (lower.includes("requirement")) {
    return {
      summary: "Add a SysML-style requirement note and trace relationship for review.",
      operations: [
        { op: "addElement", element: { id: createId("req"), kind: "requirement", name: "Derived Requirement", x: baseX, y: baseY, width: 210, height: 120, properties: { text: prompt } } }
      ]
    };
  }
  const newClassId = createId("class");
  const firstClass = diagram.elements.find((element) => element.kind === "class" || element.kind === "block");
  const operations = [
    { op: "addElement", element: { id: newClassId, kind: "class", name: "AIRecommendedComponent", x: baseX, y: baseY, width: 210, height: 112, properties: { attributes: ["status"], operations: ["validate()"] } } }
  ];
  if (firstClass) {
    operations.push({ op: "addRelationship", relationship: { id: createId("rel"), kind: "dependency", source_id: firstClass.id, target_id: newClassId, label: "uses", properties: { proposed_by: "ai" } } });
  }
  return { summary: "Add a recommended component and dependency based on the current canvas context.", operations };
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
      recent: recentProjectsForUser(tenantId, user?.id ?? null)
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
    return send(res, 200, {
      role: context.role,
      permissions: context.permissions,
      presence: activePresence(context.tenantId, context.project.id, diagramId, context.user?.id ?? `guest_${context.tenantId}`),
      comments: commentsForDiagram(context.tenantId, context.project.id, diagramId),
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
    const mentions = [...String(input.body ?? "").matchAll(/@([\w.+-]+@[\w.-]+|\w+)/g)].map((match) => match[1]);
    const comment = { id: createId("comment"), tenant_id: context.tenantId, project_id: context.project.id, diagram_id: input.diagram_id, anchor_type: input.anchor_type || "element", anchor_id: input.anchor_id || "", parent_id: input.parent_id ?? null, body: String(input.body ?? "").trim(), mentions, status: "open", created_by: context.user?.id ?? "local-user", created_at: now(), updated_at: now() };
    if (!comment.diagram_id || !comment.anchor_id || !comment.body) return send(res, 422, { error: "diagram_id, anchor_id, and body are required" });
    db.prepare(`
      INSERT INTO collaboration_comments (id, tenant_id, project_id, diagram_id, anchor_type, anchor_id, parent_id, body, mentions, status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(comment.id, comment.tenant_id, comment.project_id, comment.diagram_id, comment.anchor_type, comment.anchor_id, comment.parent_id, comment.body, JSON.stringify(comment.mentions), comment.status, comment.created_by, comment.created_at, comment.updated_at);
    for (const mention of mentions) {
      const target = getUserByEmail(mention.includes("@") ? mention : `${mention}@local.invalid`);
      db.prepare("INSERT INTO notifications (id, tenant_id, project_id, user_id, type, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(createId("notification"), context.tenantId, context.project.id, target?.id ?? null, "mention", `${context.user?.email ?? "A collaborator"} mentioned @${mention}`, now());
    }
    recordAudit({ tenantId: context.tenantId, projectId: context.project.id, actorId: context.user?.id, action: "comment.create", resourceType: "comment", resourceId: comment.id, description: `Commented on ${comment.anchor_type} ${comment.anchor_id}` });
    return send(res, 201, { comments: commentsForDiagram(context.tenantId, context.project.id, comment.diagram_id) });
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
    const diagram = { id: createId("diagram"), tenant_id: tenantId, project_id: input.project_id, type: input.type, name: input.name, version: 1, created_at: now(), updated_at: now(), metadata: {}, elements: [], relationships: [] };
    insertDiagram(diagram);
    return send(res, 201, diagram);
  }

  const diagramDuplicateMatch = pathname.match(/^\/api\/diagrams\/([^/]+)\/duplicate$/);
  if (diagramDuplicateMatch && req.method === "POST") {
    const current = diagramFromRow(db.prepare("SELECT * FROM diagrams WHERE id = ? AND tenant_id = ?").get(diagramDuplicateMatch[1], tenantId));
    if (!current) return send(res, 404, { error: "Diagram not found" });
    const copy = { ...current, id: createId("diagram"), name: `${current.name} Copy`, version: 1, created_at: now(), updated_at: now() };
    insertDiagram(copy);
    return send(res, 201, copy);
  }

  const diagramMatch = pathname.match(/^\/api\/diagrams\/([^/]+)$/);
  if (diagramMatch && req.method === "PATCH") {
    const input = await body(req);
    const current = diagramFromRow(db.prepare("SELECT * FROM diagrams WHERE id = ? AND tenant_id = ?").get(diagramMatch[1], tenantId));
    if (!current) return send(res, 404, { error: "Diagram not found" });
    const next = { ...current, name: input.name?.trim() || current.name, updated_at: now() };
    updateDiagram(next);
    return send(res, 200, next);
  }

  if (diagramMatch && req.method === "DELETE") {
    const current = db.prepare("SELECT * FROM diagrams WHERE id = ? AND tenant_id = ?").get(diagramMatch[1], tenantId);
    if (!current) return send(res, 404, { error: "Diagram not found" });
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
    const candidate = { ...input, tenant_id: tenantId, updated_at: now(), version: current.version + 1 };
    const validation = validateDiagram(candidate);
    if (!validation.valid) return send(res, 422, validation);
    updateDiagram(candidate);
    recordEvent(candidate, { summary: "Saved full diagram state", operations: [] }, user?.id ?? "local-user", "save");
    db.prepare("UPDATE projects SET updated_at = ? WHERE id = ? AND tenant_id = ?").run(now(), candidate.project_id, tenantId);
    if (searchParams.get("snapshot") === "1") createProjectSnapshot(tenantId, candidate.project_id, "Manual Save", user?.id ?? null);
    return send(res, 200, diagramFromRow(db.prepare("SELECT * FROM diagrams WHERE id = ? AND tenant_id = ?").get(candidate.id, tenantId)));
  }

  if (pathname === "/api/ai/preview" && req.method === "POST") {
    const input = await body(req);
    const diagram = diagramFromRow(db.prepare("SELECT * FROM diagrams WHERE id = ? AND tenant_id = ?").get(input.diagram_id, tenantId));
    if (!diagram) return send(res, 404, { error: "Diagram not found" });
    const patch = makeAiPatch(diagram, input.prompt ?? "");
    const preview = applyPatch(diagram, patch);
    const validation = validateDiagram(preview);
    return send(res, validation.valid ? 200 : 422, { patch, validation, preview });
  }

  if (pathname === "/api/ai/apply" && req.method === "POST") {
    const input = await body(req);
    const diagram = diagramFromRow(db.prepare("SELECT * FROM diagrams WHERE id = ? AND tenant_id = ?").get(input.diagram_id, tenantId));
    if (!diagram) return send(res, 404, { error: "Diagram not found" });
    const next = applyPatch(diagram, input.patch);
    const validation = validateDiagram(next);
    if (!validation.valid) return send(res, 422, validation);
    updateDiagram(next);
    recordEvent(next, input.patch, "ai-advisor", input.patch.summary);
    db.prepare("UPDATE projects SET updated_at = ? WHERE id = ? AND tenant_id = ?").run(now(), next.project_id, tenantId);
    return send(res, 200, diagramFromRow(db.prepare("SELECT * FROM diagrams WHERE id = ? AND tenant_id = ?").get(next.id, tenantId)));
  }

  if (pathname === "/api/ai/keys" && req.method === "POST") {
    const input = await body(req);
    const item = { id: createId("key"), tenant_id: tenantId, provider: input.provider, model: input.model, display_name: input.display_name, encrypted_api_key: encryptSecret(input.api_key), active: Boolean(input.active), created_at: now() };
    db.prepare("INSERT INTO ai_keys (id, tenant_id, provider, model, display_name, encrypted_api_key, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(item.id, item.tenant_id, item.provider, item.model, item.display_name, item.encrypted_api_key, item.active ? 1 : 0, item.created_at);
    const { encrypted_api_key, ...safe } = item;
    return send(res, 201, safe);
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
    console.error(error);
    send(res, 500, { error: error.message });
  }
}).listen(port, () => {
  console.log(`SysML/UML modeling tool running at http://localhost:${port}`);
  console.log(`SQLite database: ${dbPath}`);
});
