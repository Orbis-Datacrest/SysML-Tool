# Model Studio

Model Studio is a lightweight, client-first UML and SysML diagram editor. It
opens directly into the canvas and has no accounts, sessions, database, or
backend project persistence.

## Data model

- The active project, diagrams, viewport, and undo/redo stacks are stored
  temporarily in browser `localStorage`.
- Refreshing the page restores the current local workspace.
- Browser storage is not a durable backup. Use **Export → JSON** to download a
  restorable project file.
- SVG, PNG, PDF, PlantUML, CSV, and XLSX exports are also available.
- Existing `sysml-studio-project` JSON files remain import-compatible.

## Run

Requires Node.js 22 or newer.

```bash
npm install
npm run dev
```

Open <http://localhost:8080>. The development server only serves static files;
all project editing and persistence happen in the browser.

## Commands

```bash
npm test
npm run lint
npm run build
```

## Workspace

- `apps/shell` — editor shell and local workspace persistence
- `apps/diagram-canvas` — diagram rendering, editing, routing, and geometry
- `apps/element-palette` — UML/SysML element palette
- `apps/project-explorer` — project and diagram navigation
- `apps/import-export` — JSON import and downloadable exports
- `packages/model-core` — model validation and domain utilities
- `packages/ui` — micro-frontend registration utilities
- `services/dev-server` — static development host

## AI API

Model Studio has no bundled or fallback AI model. Configure the remote,
stateless proposal API when starting the server:

```bash
AI_API_URL=https://example.com/model-proposals \
AI_API_KEY=optional-bearer-token \
npm run dev
```

The server only proxies `POST /api/ai`; it does not store prompts, proposals,
projects, or user data. The API must return the proposal object described by
`services/ai-advisor-service/src/proposalContract.js`, either directly or under
a `proposal` property.

## Deploy to Vercel

The repository includes `vercel.json`, a static build output in `public/`, and
the serverless `POST /api/ai` function. Import the repository with its root as
the Vercel project root. The output directory is already configured.

Configure these Vercel environment variables for the desired environments:

```text
AI_API_KEY=your-provider-key
AI_API_URL=https://api.openai.com/v1/responses
AI_MODEL=gpt-4o-mini
```

Only `AI_API_KEY` is required. Never expose it through a `VITE_`, `PUBLIC_`, or
similar browser-visible variable. Project data remains in browser
`localStorage`; use JSON export for durable backups and transfer.

## Browser storage

The workspace key is `model-studio.workspace.v1`. History is bounded to 100
entries. If storage is blocked or full, Model Studio displays a warning and the
current model can still be downloaded through JSON export.
