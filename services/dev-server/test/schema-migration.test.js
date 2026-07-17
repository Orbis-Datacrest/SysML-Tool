import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { migrateSchema } from "../src/database/migrateSchema.js";

test("AI proposal migration upgrades an existing legacy table idempotently", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE ai_proposals (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      diagram_id TEXT NOT NULL,
      base_diagram_version INTEGER NOT NULL,
      task TEXT NOT NULL,
      summary TEXT NOT NULL,
      assumptions TEXT NOT NULL DEFAULT '[]',
      comments TEXT NOT NULL DEFAULT '[]',
      operations TEXT NOT NULL DEFAULT '[]',
      validation TEXT NOT NULL DEFAULT '{}',
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      context_hash TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      accepted_operation_ids TEXT NOT NULL DEFAULT '[]',
      rejected_operation_ids TEXT NOT NULL DEFAULT '[]',
      usage TEXT NOT NULL DEFAULT '{}',
      latency_ms INTEGER NOT NULL DEFAULT 0,
      final_diagram_version INTEGER
    )
  `);
  migrateSchema(db);
  migrateSchema(db);
  const columns = new Set(db.prepare("PRAGMA table_info(ai_proposals)").all().map((column) => column.name));
  for (const name of ["prompt", "proposal", "materialized_patch", "applied_at", "applied_operation_ids"]) assert.ok(columns.has(name), `${name} should be added`);
  for (const name of ["summary", "prompt_version", "accepted_operation_ids"]) assert.equal(columns.has(name), false, `${name} should be removed with the legacy schema`);
  db.prepare(`
    INSERT INTO ai_proposals (id, tenant_id, project_id, diagram_id, base_diagram_version, task, prompt, provider, model, proposal, materialized_patch, validation, context_hash, created_by, created_at, expires_at)
    VALUES ('new', 'tenant', 'project', 'diagram', 1, 'generate', '', 'local', 'rules', '{}', '{"operations":[]}', '{}', 'hash', 'user', 'now', 'later')
  `).run();
  const row = db.prepare("SELECT prompt, proposal, materialized_patch, applied_operation_ids FROM ai_proposals WHERE id = 'new'").get();
  assert.equal(row.prompt, "");
  assert.deepEqual(JSON.parse(row.proposal), {});
  assert.deepEqual(JSON.parse(row.materialized_patch).operations, []);
  assert.deepEqual(JSON.parse(row.applied_operation_ids), []);
});
