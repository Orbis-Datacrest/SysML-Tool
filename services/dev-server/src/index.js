import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { applyPatch, createId, decomposeDiagram, hydrateDiagram, validateDiagram, validateRelationshipCompatibility } from "../../../packages/model-core/src/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const configuredDataDir = process.env.DATA_DIR ?? ".data";
const dataDir = path.isAbsolute(configuredDataDir) ? configuredDataDir : path.join(root, configuredDataDir);
const dbPath = path.join(dataDir, process.env.SQLITE_DB_FILE ?? "sysml-studio.db");
const port = Number(process.env.PORT ?? 8080);
const accessTokenDays = Number(process.env.SESSION_DAYS ?? 7);
const refreshTokenDays = Number(process.env.REFRESH_SESSION_DAYS ?? 30);
const authWindowMs = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS ?? 15 * 60 * 1000);
const authMaxAttempts = Number(process.env.AUTH_RATE_LIMIT_MAX ?? 10);

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

function now() {
  return new Date().toISOString();
}

function addDays(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function normalizeEmail(email) {
  return String(email ?? "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(password) {
  if (String(password ?? "").length < 8) return "Password must be at least 8 characters.";
  return "";
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("base64url")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("base64url");
  return { salt, hash };
}

function verifyPassword(password, user) {
  if (!user?.password_hash || !user?.password_salt) return false;
  const candidate = crypto.scryptSync(password, user.password_salt, 64);
  const stored = Buffer.from(user.password_hash, "base64url");
  return stored.length === candidate.length && crypto.timingSafeEqual(stored, candidate);
}

function makeVerificationCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function makeToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function tenantIdForEmail(email) {
  return `tenant_${crypto.createHash("sha1").update(email).digest("hex").slice(0, 12)}`;
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

function migrateSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      tenant_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'Owner',
      password_hash TEXT,
      password_salt TEXT,
      created_at TEXT NOT NULL,
      verified_at TEXT
    );
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      owner_user_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tenant_members (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      user_id TEXT,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      invited_by TEXT,
      accepted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(tenant_id, email)
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS recent_projects (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      opened_at TEXT NOT NULL,
      UNIQUE(user_id, project_id)
    );
    CREATE TABLE IF NOT EXISTS project_shares (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      invited_by TEXT,
      accepted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, email)
    );
    CREATE TABLE IF NOT EXISTS project_snapshots (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      description TEXT NOT NULL,
      snapshot TEXT NOT NULL,
      created_by TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(project_id, version)
    );
    CREATE TABLE IF NOT EXISTS diagrams (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      elements TEXT NOT NULL DEFAULT '[]',
      relationships TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS model_elements (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      owner_id TEXT,
      package_id TEXT,
      semantic TEXT NOT NULL DEFAULT '{}',
      stereotypes TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS model_elements_project_idx ON model_elements(tenant_id, project_id);
    CREATE TABLE IF NOT EXISTS model_relationships (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      semantic TEXT NOT NULL DEFAULT '{}',
      stereotypes TEXT NOT NULL DEFAULT '[]',
      validation TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS model_relationships_project_idx ON model_relationships(tenant_id, project_id);
    CREATE TABLE IF NOT EXISTS diagram_views (
      diagram_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      element_refs TEXT NOT NULL DEFAULT '[]',
      relationship_refs TEXT NOT NULL DEFAULT '[]',
      viewport TEXT NOT NULL DEFAULT '{}',
      display TEXT NOT NULL DEFAULT '{}',
      metadata TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      access_token TEXT NOT NULL UNIQUE,
      refresh_token TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      refresh_expires_at TEXT NOT NULL,
      revoked_at TEXT
    );
    CREATE TABLE IF NOT EXISTS auth_challenges (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      purpose TEXT NOT NULL,
      password_hash TEXT,
      password_salt TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      reset_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS password_resets (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      diagram_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      actor_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL,
      patch TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ai_keys (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      display_name TEXT NOT NULL,
      encrypted_api_key TEXT NOT NULL,
      active INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS email_outbox (
      id TEXT PRIMARY KEY,
      recipient TEXT NOT NULL,
      subject TEXT NOT NULL,
      text TEXT NOT NULL,
      provider TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY,
      theme TEXT NOT NULL DEFAULT 'dark',
      updated_at TEXT NOT NULL
    );
  `);
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

function createProjectSnapshot(tenantId, projectId, description = "Auto Save", actorId = null) {
  const project = db.prepare("SELECT * FROM projects WHERE id = ? AND tenant_id = ?").get(projectId, tenantId);
  if (!project) return null;
  const diagrams = db.prepare("SELECT * FROM diagrams WHERE project_id = ? AND tenant_id = ? ORDER BY created_at").all(projectId, tenantId).map(diagramFromRow);
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
    SELECT id, project_id, version, description, created_by, created_at
    FROM project_snapshots
    WHERE tenant_id = ? AND project_id = ?
    ORDER BY version DESC
  `).all(tenantId, projectId);
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

function send(res, status, payload, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(payload));
}

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function encryptSecret(secret) {
  const master = crypto.createHash("sha256").update(process.env.API_KEY_ENCRYPTION_SECRET ?? "local-dev-secret").digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", master, iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
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

async function api(req, res, urlOrPath) {
  const pathname = typeof urlOrPath === "string" ? urlOrPath : urlOrPath.pathname;
  const searchParams = typeof urlOrPath === "string" ? new URLSearchParams() : urlOrPath.searchParams;
  if (pathname === "/api/auth/request-code" && req.method === "POST") {
    const limited = rateLimit(req, "auth-code");
    if (limited) return send(res, 429, limited, { "retry-after": String(limited.retryAfter) });
    const input = await body(req);
    const email = normalizeEmail(input.email);
    if (!isValidEmail(email)) return send(res, 422, { error: "Enter a valid email address." });
    const wantsPassword = input.password !== undefined;
    let passwordCredential = {};
    if (wantsPassword) {
      const passwordError = validatePassword(input.password);
      if (passwordError) return send(res, 422, { error: passwordError });
      const { salt, hash } = hashPassword(input.password);
      passwordCredential = { password_salt: salt, password_hash: hash };
    }
    db.prepare("DELETE FROM auth_challenges WHERE expires_at <= ?").run(now());
    const challenge = { id: createId("challenge"), email, code: makeVerificationCode(), purpose: wantsPassword ? "password_signup" : "email_login", expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), created_at: now(), ...passwordCredential };
    db.prepare(`
      INSERT INTO auth_challenges (id, email, code, purpose, password_hash, password_salt, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(challenge.id, challenge.email, challenge.code, challenge.purpose, challenge.password_hash ?? null, challenge.password_salt ?? null, challenge.expires_at, challenge.created_at);
    await sendVerificationEmail(email, challenge.code);
    return send(res, 200, { ok: true, message: "Verification code sent.", dev_code: process.env.NODE_ENV === "production" ? undefined : challenge.code });
  }

  if (pathname === "/api/auth/verify" && req.method === "POST") {
    const limited = rateLimit(req, "auth-verify");
    if (limited) return send(res, 429, limited, { "retry-after": String(limited.retryAfter) });
    const input = await body(req);
    const email = normalizeEmail(input.email);
    const code = String(input.code ?? "").trim();
    const challenge = db.prepare("SELECT * FROM auth_challenges WHERE email = ? AND code = ? AND expires_at > ?").get(email, code, now());
    if (!challenge) return send(res, 401, { error: "Invalid or expired verification code." });

    const timestamp = now();
    let user = getUserByEmail(email);
    if (!user) {
      const invite = db.prepare("SELECT * FROM tenant_members WHERE email = ? ORDER BY created_at LIMIT 1").get(email);
      user = {
        id: createId("user"),
        email,
        tenant_id: invite?.tenant_id ?? tenantIdForEmail(email),
        role: invite?.role ?? "Owner",
        created_at: timestamp,
        verified_at: timestamp,
        password_hash: challenge.password_hash,
        password_salt: challenge.password_salt
      };
    } else {
      user = { ...user, verified_at: timestamp, password_hash: challenge.password_hash ?? user.password_hash, password_salt: challenge.password_salt ?? user.password_salt };
    }
    upsertUser(user);
    db.prepare("DELETE FROM auth_challenges WHERE id = ?").run(challenge.id);
    ensureUserWorkspace(user);
    const session = createSession(user);
    return send(res, 200, { token: session.access_token, refreshToken: session.refresh_token, expires_at: session.expires_at, user: publicUser(user) });
  }

  if (pathname === "/api/auth/password-login" && req.method === "POST") {
    const limited = rateLimit(req, "password-login");
    if (limited) return send(res, 429, limited, { "retry-after": String(limited.retryAfter) });
    const input = await body(req);
    const user = getUserByEmail(input.email);
    if (!user || !verifyPassword(input.password ?? "", user)) return send(res, 401, { error: "Email or password is incorrect." });
    ensureUserWorkspace(user);
    const session = createSession(user);
    return send(res, 200, { token: session.access_token, refreshToken: session.refresh_token, expires_at: session.expires_at, user: publicUser(user) });
  }

  if (pathname === "/api/auth/request-password-reset" && req.method === "POST") {
    const limited = rateLimit(req, "password-reset");
    if (limited) return send(res, 429, limited, { "retry-after": String(limited.retryAfter) });
    const input = await body(req);
    const email = normalizeEmail(input.email);
    const passwordError = validatePassword(input.password);
    if (!isValidEmail(email)) return send(res, 422, { error: "Enter a valid email address." });
    if (passwordError) return send(res, 422, { error: passwordError });
    const user = getUserByEmail(email);
    if (user) {
      const { salt, hash } = hashPassword(input.password);
      const reset = { id: createId("reset"), email, code: makeVerificationCode(), password_hash: hash, password_salt: salt, expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), created_at: now() };
      db.prepare("INSERT INTO password_resets (id, email, code, password_hash, password_salt, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(reset.id, reset.email, reset.code, reset.password_hash, reset.password_salt, reset.expires_at, reset.created_at);
      await sendPasswordResetEmail(email, reset.code);
    }
    return send(res, 200, { ok: true, message: "If that email exists, a reset code has been sent." });
  }

  if (pathname === "/api/auth/confirm-password-reset" && req.method === "POST") {
    const limited = rateLimit(req, "password-reset-confirm");
    if (limited) return send(res, 429, limited, { "retry-after": String(limited.retryAfter) });
    const input = await body(req);
    const email = normalizeEmail(input.email);
    const code = String(input.code ?? "").trim();
    const reset = db.prepare("SELECT * FROM password_resets WHERE email = ? AND code = ? AND expires_at > ?").get(email, code, now());
    if (!reset) return send(res, 401, { error: "Invalid or expired reset code." });
    db.prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE email = ?").run(reset.password_hash, reset.password_salt, email);
    db.prepare("DELETE FROM password_resets WHERE id = ?").run(reset.id);
    return send(res, 200, { ok: true });
  }

  if (pathname === "/api/auth/refresh" && req.method === "POST") {
    const input = await body(req);
    const refreshToken = String(input.refreshToken ?? "");
    const session = db.prepare("SELECT * FROM sessions WHERE refresh_token = ? AND revoked_at IS NULL").get(refreshToken);
    if (!session || new Date(session.refresh_expires_at) <= new Date()) return send(res, 401, { error: "Refresh session expired." });
    const accessToken = makeToken();
    const expiresAt = addDays(accessTokenDays);
    db.prepare("UPDATE sessions SET access_token = ?, expires_at = ? WHERE id = ?").run(accessToken, expiresAt, session.id);
    const user = getUserById(session.user_id);
    return send(res, 200, { token: accessToken, refreshToken, expires_at: expiresAt, user: publicUser(user) });
  }

  if (pathname === "/api/auth/me" && req.method === "GET") {
    const { user } = authContext(req);
    return send(res, 200, { user: publicUser(user) });
  }

  if (pathname === "/api/auth/logout" && req.method === "POST") {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    db.prepare("UPDATE sessions SET revoked_at = ? WHERE access_token = ?").run(now(), token);
    return send(res, 200, { ok: true });
  }

  const { user, tenantId } = authContext(req);
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

  const projectVersionsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/versions$/);
  if (projectVersionsMatch && req.method === "GET") {
    const project = db.prepare("SELECT * FROM projects WHERE id = ? AND tenant_id = ?").get(projectVersionsMatch[1], tenantId);
    if (!project) return send(res, 404, { error: "Project not found" });
    return send(res, 200, { versions: snapshotsForProject(tenantId, project.id) });
  }

  const projectRestoreMatch = pathname.match(/^\/api\/projects\/([^/]+)\/versions\/([^/]+)\/restore$/);
  if (projectRestoreMatch && req.method === "POST") {
    const projectId = projectRestoreMatch[1];
    const version = Number(projectRestoreMatch[2]);
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
    return send(res, 200, { project: restoredProject, diagrams });
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
    const pdf = Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R>>endobj\n4 0 obj<</Length 72>>stream\nBT /F1 18 Tf 72 720 Td (${diagram.name} export - ${diagram.elements.length} elements) Tj ET\nendstream endobj\ntrailer<</Root 1 0 R>>\n%%EOF`);
    res.writeHead(200, { "content-type": "application/pdf", "content-disposition": `attachment; filename="${diagram.name}.pdf"` });
    return res.end(pdf);
  }

  return send(res, 404, { error: "Not found" });
}

function contentType(file) {
  if (file.endsWith(".html")) return "text/html";
  if (file.endsWith(".css")) return "text/css";
  if (file.endsWith(".js")) return "text/javascript";
  if (file.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

async function serveStatic(req, res, pathname) {
  const publicRoot = path.join(root, "apps/shell/public");
  const filePath = pathname === "/" ? path.join(publicRoot, "index.html") : path.join(root, pathname);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(root) || !existsSync(resolved)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  res.writeHead(200, { "content-type": contentType(resolved) });
  createReadStream(resolved).pipe(res);
}

migrateSchema();
await migrateJsonData();
migrateLegacyDiagrams();

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    return await serveStatic(req, res, url.pathname);
  } catch (error) {
    console.error(error);
    send(res, 500, { error: error.message });
  }
}).listen(port, () => {
  console.log(`SysML/UML modeling tool running at http://localhost:${port}`);
  console.log(`SQLite database: ${dbPath}`);
});
