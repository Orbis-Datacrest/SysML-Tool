# SysML/UML Modeling Tool

A professional multi-tenant SysML and UML modeling workspace with a working vertical slice:

- Create tenant and project
- Create/load/save UML class diagrams
- Drag classes and interfaces onto a canvas
- Add relationships
- Ask the AI Advisor for a diagram update
- Preview and apply AI-generated changes
- Export the diagram to PDF

## Architecture

This repository is organized as a micro-frontend and service monorepo.

### Apps

- `apps/shell`: application shell and runtime composition
- `apps/project-explorer`: tenant, project, model, and diagram navigation
- `apps/diagram-canvas`: editable diagram canvas
- `apps/ai-advisor`: AI chat, upload surface, previews, and apply flow
- `apps/import-export`: import/export panel
- `apps/element-palette`: drag palette for UML/SysML elements
- `apps/properties-panel`: selected element and diagram metadata editor
- `apps/auth-tenant-settings`: auth, tenant, RBAC, and API key settings UI

The shell uses a lightweight module registry in `packages/ui` as the module-federation equivalent for the vertical slice. It keeps each MFE independently mounted and replaceable.

### Services

- `services/dev-server`: local vertical-slice API and static app host
- `services/auth-service`: auth/RBAC contract
- `services/tenant-service`: tenant lifecycle contract
- `services/project-service`: project lifecycle contract
- `services/model-repository-service`: versioned model storage contract
- `services/diagram-service`: diagram command and query contract
- `services/ai-advisor-service`: provider abstraction and validated patch preview
- `services/export-service`: PDF/PNG/SVG/export contract
- `services/audit-history-service`: event history and audit contract

The local vertical slice uses JSON files under `.data` so it can run without dependency installation. Docker Compose provides Kafka, PostgreSQL, Redis, and service containers for the production-like stack.

## Commands

```bash
./scripts/dev.sh
./scripts/build.sh
./scripts/test.sh
./scripts/start.sh
./scripts/stop.sh
./scripts/reset.sh
```

On Windows PowerShell you can also run:

```powershell
npm run dev
npm test
```

## Local Development

1. Copy `.env.example` to `.env`.
2. Run `npm run dev`.
3. Open `http://localhost:8080`.

The app seeds a demo tenant, project, and UML class diagram on first start.

## Security Model

- Every persisted entity has `tenant_id`.
- API handlers require tenant context and filter by tenant.
- AI provider API keys are encrypted at rest with AES-256-GCM before saving.
- Saved keys are never returned to the frontend.
- AI changes are returned as previews and validated before apply.
- RBAC roles are modeled as `Owner`, `Admin`, `Editor`, and `Viewer`.

## Event Model

Every diagram mutation writes a versioned event with:

- `tenant_id`
- `project_id`
- `diagram_id`
- actor
- reason
- timestamp
- before/after patch summary

The same event envelope is ready for Kafka publication in the production services.
