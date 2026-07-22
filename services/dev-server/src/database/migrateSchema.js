export function migrateSchema(db) {
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
    CREATE TABLE IF NOT EXISTS project_baselines (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      snapshot_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'draft',
      released INTEGER NOT NULL DEFAULT 0,
      created_by TEXT,
      created_at TEXT NOT NULL,
      released_by TEXT,
      released_at TEXT,
      UNIQUE(project_id, name)
    );
    CREATE TABLE IF NOT EXISTS project_reviews (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      baseline_id TEXT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS review_approvals (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      review_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      decision TEXT NOT NULL,
      comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS collaboration_presence (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      diagram_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      cursor TEXT NOT NULL DEFAULT '{}',
      selection TEXT NOT NULL DEFAULT '[]',
      color TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, diagram_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS collaboration_comments (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      diagram_id TEXT NOT NULL,
      anchor_type TEXT NOT NULL,
      anchor_id TEXT NOT NULL,
      parent_id TEXT,
      body TEXT NOT NULL,
      mentions TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'open',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS collaboration_comment_reads (
      tenant_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      read_at TEXT NOT NULL,
      PRIMARY KEY (thread_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      user_id TEXT,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      read_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_records (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      actor_id TEXT,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      description TEXT NOT NULL,
      created_at TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}'
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
    CREATE TABLE IF NOT EXISTS ai_proposals (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      diagram_id TEXT NOT NULL,
      base_diagram_version INTEGER NOT NULL,
      task TEXT NOT NULL,
      prompt TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT,
      proposal TEXT NOT NULL,
      materialized_patch TEXT NOT NULL,
      validation TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      applied_at TEXT,
      applied_operation_ids TEXT NOT NULL DEFAULT '[]',
      context_hash TEXT NOT NULL,
      latency_ms INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS ai_proposals_scope_idx ON ai_proposals(tenant_id, project_id, diagram_id, created_at);
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

  const commentColumns = new Set(db.prepare("PRAGMA table_info(collaboration_comments)").all().map((column) => column.name));
  const requiredCommentColumns = [
    ["anchor_x", "REAL"], ["anchor_y", "REAL"], ["edited_at", "TEXT"], ["deleted_at", "TEXT"]
  ];
  for (const [name, definition] of requiredCommentColumns) {
    if (!commentColumns.has(name)) db.exec(`ALTER TABLE collaboration_comments ADD COLUMN ${name} ${definition}`);
  }
  db.exec("CREATE INDEX IF NOT EXISTS collaboration_comments_diagram_idx ON collaboration_comments(tenant_id, project_id, diagram_id, created_at)");

  // CREATE TABLE IF NOT EXISTS does not evolve an existing SQLite table. Keep
  // this additive upgrade idempotent so databases created by earlier AI
  // proposal implementations can be opened without being deleted or reset.
  const proposalColumns = new Map(db.prepare("PRAGMA table_info(ai_proposals)").all().map((column) => [column.name, column]));
  const requiredProposalColumns = [
    ["prompt", "TEXT NOT NULL DEFAULT ''"],
    ["proposal", "TEXT NOT NULL DEFAULT '{}'"],
    ["materialized_patch", "TEXT NOT NULL DEFAULT '{\"summary\":\"Legacy proposal\",\"base_element_ids\":[],\"operations\":[]}'"],
    ["applied_at", "TEXT"],
    ["applied_operation_ids", "TEXT NOT NULL DEFAULT '[]'"]
  ];
  for (const [name, definition] of requiredProposalColumns) {
    if (!proposalColumns.has(name)) db.exec(`ALTER TABLE ai_proposals ADD COLUMN ${name} ${definition}`);
  }

  const evolvedProposalColumns = new Set(db.prepare("PRAGMA table_info(ai_proposals)").all().map((column) => column.name));
  if (evolvedProposalColumns.has("prompt_version") || evolvedProposalColumns.has("accepted_operation_ids") || evolvedProposalColumns.has("summary")) {
    rebuildLegacyAiProposals(db);
  } else {
    // Older rows contain a different proposal contract and must never become
    // applicable merely because compatibility columns were added.
    db.prepare("UPDATE ai_proposals SET status = 'expired' WHERE proposal = '{}' AND status = 'pending'").run();
  }
}

function parseJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function rebuildLegacyAiProposals(db) {
  const rows = db.prepare("SELECT * FROM ai_proposals").all();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      DROP INDEX IF EXISTS ai_proposals_scope_idx;
      ALTER TABLE ai_proposals RENAME TO ai_proposals_legacy_migration;
      CREATE TABLE ai_proposals (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        diagram_id TEXT NOT NULL,
        base_diagram_version INTEGER NOT NULL,
        task TEXT NOT NULL,
        prompt TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT,
        proposal TEXT NOT NULL,
        materialized_patch TEXT NOT NULL,
        validation TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        applied_at TEXT,
        applied_operation_ids TEXT NOT NULL DEFAULT '[]',
        context_hash TEXT NOT NULL,
        latency_ms INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX ai_proposals_scope_idx ON ai_proposals(tenant_id, project_id, diagram_id, created_at);
    `);
    const insert = db.prepare(`
      INSERT INTO ai_proposals (id, tenant_id, project_id, diagram_id, base_diagram_version, task, prompt, provider, model, proposal, materialized_patch, validation, status, created_by, created_at, expires_at, applied_at, applied_operation_ids, context_hash, latency_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of rows) {
      const existingProposal = parseJson(row.proposal, {});
      const proposal = Object.keys(existingProposal).length ? existingProposal : {
        summary: row.summary || "Legacy AI proposal",
        assumptions: parseJson(row.assumptions, []),
        clarification_questions: [],
        comments: parseJson(row.comments, []),
        operations: parseJson(row.operations, []),
        layout_suggestions: []
      };
      const patch = parseJson(row.materialized_patch, { summary: proposal.summary, base_element_ids: [], operations: [] });
      const status = row.status === "pending" ? "expired" : row.status;
      insert.run(
        row.id, row.tenant_id, row.project_id, row.diagram_id, row.base_diagram_version, row.task,
        row.prompt ?? "", row.provider, row.model ?? null, JSON.stringify(proposal), JSON.stringify(patch),
        typeof row.validation === "string" ? row.validation : JSON.stringify(row.validation ?? {}), status,
        row.created_by, row.created_at, row.expires_at, row.applied_at ?? null,
        row.applied_operation_ids ?? row.accepted_operation_ids ?? "[]", row.context_hash, Number(row.latency_ms ?? 0)
      );
    }
    db.exec("DROP TABLE ai_proposals_legacy_migration; COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
