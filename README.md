# SysML/UML Modeling Tool

A browser-based UML and SysML modeling workspace for creating diagrams, maintaining a shared semantic model, validating relationships, collaborating through anchored comments, and reviewing or generating model changes with an AI assistant.

The repository is currently version `0.1.0`. It is implemented as a Node.js workspace with a dependency-free browser client and a single Node HTTP service. SQLite is the active application database.

## What is included

- A pan-and-zoom diagram canvas with an interactive minimap, grid, selection, multi-selection, drag, resize, grouping, locking, copy/paste, duplicate, delete, undo, and redo.
- Diagram-specific element palettes and relationship tools, direct text editing, class/block compartments, relationship routing, multiplicities, line styles, and element/connector color controls.
- UML diagrams: Class, Object, Component, Deployment, Package, Composite Structure, Profile, Use Case, Activity, Sequence, State Machine, Communication, Timing, and Interaction Overview.
- SysML diagrams: Block Definition, Internal Block, Package, Parametric, Use Case, Activity, Sequence, State Machine, and Requirement.
- A project dashboard, multiple diagram tabs per project, automatic diagram saving, named tab milestones, persisted history states, and restore support.
- Deterministic model validation with severity filtering and links from diagnostics back to affected elements or relationships.
- Element- and canvas-anchored comment threads with replies, mentions, unread/resolved states, edit/delete actions, copyable links, permission checks, collaborator presence, and approximately 1.5-second polling updates.
- Email/password signup with verification, login, access-token refresh, logout confirmation, and verified-code password reset.
- Tenant and project sharing roles. The project share UI offers Viewer, Commenter, and Editor; the backend permission model also defines Owner, Admin, and Reviewer.
- AI generation and review through a deterministic local parser, an optional local Ollama model, or a tenant-managed OpenAI API key. AI output is validated as semantic operations, previewed as ghosts, and applied only after explicit approval.
- Studio JSON import (up to 10 MB) and JSON, SVG, PNG, PDF, PlantUML, CSV, and XLSX export. CSV/XLSX exports contain the diagram's requirement records.
- Light and dark themes, resizable/collapsible sidebars, responsive layout behavior, and keyboard-accessible controls.

The backend also contains APIs and storage for baselines, version comparison, engineering reviews/approvals, event history, and audit records. Not every one of these API-level workflows has a complete dedicated user interface yet.

## Technology stack

| Area | Implementation |
| --- | --- |
| Browser client | Vanilla JavaScript ES modules, semantic HTML, CSS, SVG, and Canvas 2D for PNG export |
| UI composition | In-repository micro-frontend registry in `packages/ui`; no bundler or frontend framework |
| Server | Node.js built-in `http`, filesystem, crypto, and fetch APIs |
| Database | SQLite through Node's built-in `node:sqlite` `DatabaseSync`; WAL mode is enabled |
| Domain model | In-repository `packages/model-core` catalog, repository decomposition/hydration, validation, requirements, units, versioning, and collaboration utilities |
| Authentication | Server-side sessions with random bearer and refresh tokens; scrypt password hashes; SQLite persistence |
| AI | Strict JSON-schema proposals; deterministic local parser, Ollama `/api/chat`, or OpenAI Responses API |
| Email | Development outbox, Resend API, or SendGrid API |
| Tests | Node's built-in test runner (`node --test`) |
| Workspace/package manager | npm workspaces and npm lockfile v3 |

There are no third-party npm runtime dependencies in the current lockfile.

## Prerequisites

- **Node.js 22.x or newer.** The server imports `node:sqlite`, which is available in the Node 22 line used by this repository. The checked development environment uses Node `22.22.3`.
- **npm with lockfile v3 support.** No exact minimum is declared in `package.json`; the checked development environment uses npm `10.9.8`. **TODO:** add a `packageManager` or engines declaration to pin the supported version.
- A current desktop release of Chrome, Firefox, Edge, or Safari with JavaScript modules, Pointer Events, `structuredClone`, SVG, and Canvas support. **TODO:** publish minimum browser versions after adding the cross-browser test matrix.
- Optional: Docker with the Compose plugin, for the repository's development Compose stack.
- Optional: Ollama, or an OpenAI API key, for model-backed AI. The deterministic local parser works without either.
- Optional in production: a Resend or SendGrid account for verification and password-reset email.

SQLite, PostgreSQL, Redis, and Kafka do **not** need to be installed for normal local development. SQLite is supplied by Node. Although the Compose file starts PostgreSQL, Redis, and Kafka, the current application code does not read their connection variables.

## Installation

```bash
git clone https://github.com/Orbis-Datacrest/SysML-Tool.git
cd SysML-Tool
npm ci
cp .env.example .env
```

Edit `.env` for the environment. Do not commit that file or real credentials.

No manual database command is required. At server startup the application:

1. creates `DATA_DIR`;
2. opens the configured SQLite file;
3. creates or upgrades tables idempotently;
4. migrates legacy JSON data from `DATA_DIR` if the database is empty; and
5. migrates legacy diagram and AI-proposal records when necessary.

By default, runtime data is stored in `.data/sysml-studio.db`. SQLite can also create `-wal` and `-shm` files beside the database.

## Running the application

The frontend and API are served by the same process, so there is no separate frontend startup order.

### Development with built-in defaults

```bash
npm run dev
```

Open <http://localhost:8080>. This command watches the server source and restarts it after changes.

The npm script does not automatically parse `.env`. To load the environment file with Node 22, run:

```bash
node --env-file=.env --watch services/dev-server/src/index.js
```

### Production-mode process

Run the repository checks, then start the same HTTP service without watch mode:

```bash
npm ci
npm run build
node --env-file=.env services/dev-server/src/index.js
```

Set `NODE_ENV=production` in `.env` before using this command in production. If the deployment platform injects environment variables itself, `npm start` is equivalent to the final command.

`npm run build` is currently a source-layout/build-readiness check; it does not bundle, transpile, or minify assets.

### Docker Compose development stack

```bash
docker compose -f infra/docker-compose.yml up --build
```

This exposes the application on port `8080`, PostgreSQL on `5432`, Redis on `6379`, and Kafka on `9092` (with Kafka's host listener on `29092`). The shell container mounts the repository and runs `npm run dev`. PostgreSQL, Redis, Kafka, and ZooKeeper are architecture scaffolding and are not used by the current SQLite-backed server.

Stop the stack with:

```bash
docker compose -f infra/docker-compose.yml down
```

The shell wrappers mirror these commands: `scripts/dev.sh`, `scripts/build.sh`, and `scripts/test.sh` call the corresponding npm scripts; `scripts/start.sh` and `scripts/stop.sh` start and stop Compose. `scripts/reset.sh` deletes `.data` and the Compose volumes and is intentionally destructive.

## Environment variables

The tracked [`.env.example`](.env.example) contains every environment variable read by the running application.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | Node default | Use `production` to suppress development verification codes and require an AI-key encryption secret. |
| `PORT` | `8080` | HTTP port for both the UI and REST API. |
| `DATA_DIR` | `.data` | Absolute path or repository-relative directory for SQLite, development email, and legacy JSON data. |
| `SQLITE_DB_FILE` | `sysml-studio.db` | SQLite filename inside `DATA_DIR`. |
| `API_KEY_ENCRYPTION_SECRET` | Development fallback | Master secret used to derive the AES-256-GCM key for tenant OpenAI credentials. Required for production use of tenant API keys. |
| `SESSION_DAYS` | `7` | Access-token lifetime in days. |
| `REFRESH_SESSION_DAYS` | `30` | Refresh-token lifetime in days. |
| `AUTH_RATE_LIMIT_WINDOW_MS` | `900000` | Authentication rate-limit window in milliseconds. |
| `AUTH_RATE_LIMIT_MAX` | `10` | Maximum attempts per authentication bucket and client IP in one window. |
| `EMAIL_PROVIDER` | `dev` | `dev`, `resend`, or `sendgrid`. |
| `EMAIL_FROM` | Local no-reply address | Sender identity used by external email providers. |
| `RESEND_API_KEY` | unset | Server-side Resend credential when `EMAIL_PROVIDER=resend`. |
| `SENDGRID_API_KEY` | unset | Server-side SendGrid credential when `EMAIL_PROVIDER=sendgrid`. |
| `DEFAULT_AI_PROVIDER` | `local` | Server default: `local` or `ollama`. An active tenant OpenAI key takes precedence. |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama server URL. |
| `OLLAMA_MODEL` | `qwen2.5:7b` | Ollama model sent to `/api/chat`. |

`OPENAI_API_KEY` is intentionally not an environment variable in the current implementation. An Owner/Admin adds it in **AI panel → Settings**; the server encrypts it in SQLite and never returns the secret. Anthropic is not implemented.

## Authentication and first use

### Development email flow

With `EMAIL_PROVIDER=dev`, verification and reset messages are appended to `.data/emailOutbox.json`, the six-digit code is printed in the server console, and non-production authentication responses may include `dev_code` for the UI. Codes expire after 10 minutes.

### Account flow

1. Open the application and choose **Sign Up**.
2. Enter an email, password, and confirmation. Passwords require at least six characters and must contain uppercase, lowercase, and numeric characters.
3. Enter the emailed verification code. A verified user receives a workspace, an initial project, and a session.
4. Existing verified users use **Log In** with email and password.
5. **Forgot Password** sends a separate 10-minute code. A successful reset revokes all existing sessions for the user.
6. Logout asks for confirmation and revokes the current server session.

The browser stores the access and refresh tokens in `localStorage`, restores the session with `/api/auth/me`, and refreshes expired access tokens with the server-side refresh session.

## Using the modeling workspace

### Projects and diagrams

1. Create a project from the dashboard or open a recent project.
2. Use the diagram tabs to switch between diagrams, and the add-tab control to choose any supported UML/SysML diagram type.
3. Choose a matching element or relationship from **Elements**, then place it on the canvas. Palette contents are filtered for the active diagram type.
4. Select elements to move, resize, group, lock, duplicate, copy/paste, delete, or change fill, border, text, line, and font styles. Double-click editable text/compartments to edit in place.
5. Pan and zoom with the canvas controls or minimap. Sidebar resizing immediately adjusts the canvas viewport.
6. Changes auto-save after a short debounce. **Save Diagram** creates a selectable milestone for chosen tabs. The History panel shows the current state and saved project versions and can restore a selected state.

### Validation

The collapsible Validation panel is at the bottom of the left sidebar. It validates the shared model repository, including missing references, incompatible relationship endpoints, requirement properties, interface/port rules, quantities, and unit compatibility. Filter by severity and select a diagnostic to focus its model item.

### Comments and collaboration

- Share a project from the top bar as Viewer, Commenter, or Editor. The invited address must register/login with that same email to join the tenant workspace.
- Commenters and Editors can select the Comment tool and click an element or any canvas position. A submitted composer becomes an anchored pin.
- Select a pin to open its thread. Threads support replies and `@mentions`; available edit, delete, resolve, reopen, read/unread, and copy-link actions depend on authorship and role.
- Presence, cursor/selection information, comments, replies, and status changes are synchronized by polling every 1.5 seconds. The repository does not currently use WebSockets.

### AI advisor

The right sidebar offers **Generate** and **Review**:

1. Enter a natural-language modeling request, or optionally provide a review focus.
2. The server builds bounded context from the active diagram, selected elements, project repository, and deterministic validation results.
3. The provider returns a strict semantic proposal. Coordinates, executable code, SQL, arbitrary client patches, and direct database access are not accepted.
4. The server validates references, materializes layout separately, rejects newly introduced deterministic errors, stores the proposal against the current diagram version, and returns a ghost preview.
5. Select individual operations, check the explicit approval box, and apply them. The server rechecks permissions, proposal expiry, base version, selected operations, and validation before committing. The change remains undoable in the client and is recorded in event/audit storage.

Pending proposals expire after 20 minutes. Only the proposal creator or a project administrator can apply or reject one.

Provider choices:

- **Local parser (default):** no external service or key; deterministic prompt parsing and validation-based review.
- **Ollama:** set `DEFAULT_AI_PROVIDER=ollama`, start Ollama separately, and pull the configured model, for example:

  ```bash
  ollama serve
  ollama pull qwen2.5:7b
  ```

- **OpenAI:** an Owner/Admin opens AI **Settings**, selects OpenAI, and supplies the model, key label, and API key. This uses the OpenAI Responses API from the server. Account access to ChatGPT does not itself supply an API key or API billing.

### Import and export

- **Import:** Studio JSON only. The client rejects empty files, files larger than 10 MB, unsupported schema versions, invalid geometry/colors, duplicate IDs, and relationships to missing elements before replacing the active diagram.
- **Export:** Studio JSON, SVG, 2× PNG, vector PDF, PlantUML (`.puml`), requirements CSV, and requirements XLSX.
- Studio JSON schema version 3 is written; version 2 and legacy unversioned diagram exports remain readable.

## Project structure

```text
apps/
  shell/                    Application state, routing, layout, tabs, and static entry page
  diagram-canvas/           Canvas rendering, editing, tools, minimap, and comments
  element-palette/          Diagram-aware element and relationship palette
  project-dashboard/        Project and recent-project dashboard
  project-explorer/         Diagram-type selection and validation panel
  properties-panel/         Requirement and element property editing
  ai-advisor/               AI prompt, proposal, ghost-preview, approval UI
  auth-tenant-settings/     Signup/login/reset UI and tenant AI settings
  import-export/            JSON import and JSON/SVG/PNG/PDF/PUML/CSV/XLSX export
packages/
  model-core/               Catalog, semantic repository, validation, units, and versioning
  shared-types/             TypeScript domain/API interface declarations
  ui/                       Browser micro-frontend registry
services/
  dev-server/               Active HTTP/API/static server, SQLite schema, auth, and routes
  ai-advisor-service/       Provider adapters, prompt parsing, schemas, and layout materializer
  */src/contract.js         Service-boundary contracts for planned service extraction
infra/
  docker-compose.yml        Development stack and future infrastructure dependencies
scripts/                    Start/stop/reset wrappers and repository checks
samples/                    Example project data
```

The service folders other than `dev-server` and `ai-advisor-service` are currently contracts, not independently running network services.

## Tests and quality checks

```bash
# Run 18 test files containing 92 test definitions
npm test

# Verify expected workspace directories exist
npm run lint

# Verify build-critical source files exist
npm run build
```

The complete root npm command set is `npm run dev`, `npm start`, `npm test`, `npm run lint`, and `npm run build`.

Tests cover the model core, canvas geometry and routing, class/block variants, comment state and positioning, sidebar/tab state, navigation/theme behavior, import/export, authentication security, SQLite schema migration, AI prompt parsing, providers, and proposal validation.

Current limitations:

- `npm run lint` is a workspace structure check, not ESLint.
- `npm run build` is a readiness check, not a production asset build.
- No formatter command is configured. **TODO:** choose and configure one.
- No TypeScript compiler/type-check command is configured; `packages/shared-types` is declarations only. **TODO:** add a type-check pipeline if these declarations become compiled inputs.
- No automated cross-browser end-to-end suite is committed. **TODO:** add browser automation for Chrome, Firefox, Edge, and Safari/WebKit; current tests run in Node.

## Troubleshooting

### `node:sqlite` cannot be found

Use Node 22 or newer and verify with `node --version`. Older Node releases cannot start this server.

### `.env` changes have no effect

`npm run dev` uses inherited environment variables but does not parse `.env`. Use:

```bash
node --env-file=.env --watch services/dev-server/src/index.js
```

Restart the server after changing environment settings.

### Port 8080 is already in use

Set another port in `.env`, then start with `--env-file`:

```bash
PORT=8081 node --env-file=.env --watch services/dev-server/src/index.js
```

The explicit shell assignment takes precedence over the file.

### Database or migration errors

- Confirm the process can write to `DATA_DIR`.
- Back up the SQLite database and its `-wal`/`-shm` companions before investigating or upgrading.
- Schema upgrades run automatically; there is no separate migration CLI.
- `scripts/reset.sh` deletes `.data` and Docker volumes. It is destructive and should only be used when all local data can be discarded.

### Verification or password-reset email does not arrive

- In development, inspect the server console and `.data/emailOutbox.json`.
- In production, set `EMAIL_PROVIDER` to `resend` or `sendgrid`, set the matching key, configure a provider-approved `EMAIL_FROM`, and verify outbound network access.
- Codes expire after 10 minutes. Authentication attempts are also rate-limited by IP and operation.

### Login loops or protected routes return 401

Clear stale `sysml.authToken` and `sysml.refreshToken` browser storage, log in again, and confirm the SQLite data directory is persistent. A password reset intentionally revokes existing sessions.

### Ollama connection failures

Run `ollama serve` directly (not `run ollama serve`), pull the exact `OLLAMA_MODEL`, and confirm `OLLAMA_BASE_URL/api/chat` is reachable from the Node process. When the app is inside Docker and Ollama is on the host, `127.0.0.1` points to the container; configure a host-reachable URL.

### OpenAI returns 401 or provider errors

Replace the tenant key in AI Settings, confirm the selected model is available to that API account, and check API billing. A ChatGPT subscription is not an OpenAI API credential. If an encrypted key stops decrypting, restore the original `API_KEY_ENCRYPTION_SECRET` or save a new key.

### Color picker, canvas, or comment positioning problems

- Update to a current supported browser and reload without stale cached files.
- The color toolbar includes synchronized text/hex controls and a native picker fallback; enter a valid `#RRGGBB` value if the native picker behaves differently.
- Ensure browser zoom is not being confused with the application's canvas zoom.
- If collaboration displays Retry, verify the API is reachable and the session still has project permission.
- For reproducible browser-specific failures, include browser/version, OS, diagram type, zoom level, and console error in the issue report.

## Security notes

- Never commit `.env`, provider keys, database files, development email outboxes, or exported customer models.
- Passwords are hashed with Node scrypt and a random salt. Verification/reset codes and authentication attempts expire or are rate-limited.
- Access and refresh tokens are random server-side session identifiers persisted in SQLite. The current browser client stores them in `localStorage`; use HTTPS and a strict Content Security Policy. **TODO:** evaluate secure, HttpOnly, SameSite cookies before an Internet-facing deployment.
- Tenant OpenAI keys are encrypted with AES-256-GCM using a key derived from `API_KEY_ENCRYPTION_SECRET`; they are masked in API responses. Back up and rotate this secret through an intentional key-rotation process.
- Project and comment actions are permission checked on the server. Do not rely on disabled UI controls as authorization.
- AI responses are treated as untrusted proposals. Strict fields, bounded sizes, semantic references, base diagram versions, deterministic validation, explicit approval, and audit records are enforced server-side.
- Studio JSON import is parsed and validated in the browser and is limited to 10 MB. It is not uploaded to a general-purpose server file store.
- The development static server does not currently set production security headers, TLS, cache controls, or a request-body size limit. **TODO:** provide these at a hardened reverse proxy and add an API body limit before public deployment.
- The development email provider writes verification/reset content to disk and logs codes. Never use `EMAIL_PROVIDER=dev` for a real production environment.

## Deployment

The repository supports direct Node startup and a source-mounted development Compose stack. It does **not** currently contain a production Dockerfile, Kubernetes manifests, cloud deployment configuration, or an external database adapter.

For a single-instance deployment:

1. provision Node 22+ and persistent storage for `DATA_DIR`;
2. run `npm ci` and `npm run build`;
3. inject the documented production environment variables;
4. run `npm start` under a process supervisor;
5. place it behind an HTTPS reverse proxy; and
6. back up the SQLite database consistently, including WAL state.

SQLite and the in-process collaboration poller make the current server a single-instance architecture. Do not run multiple replicas against one SQLite file over a network filesystem. **TODO:** implement the intended PostgreSQL/Redis/Kafka adapters before horizontal scaling. **TODO:** add health/readiness endpoints and a production container image.

## Contributing

No repository-specific contributing policy is committed yet. Until one is added:

1. create a focused branch from the repository's active integration branch;
2. keep commits scoped and use clear imperative or Conventional Commit-style messages;
3. preserve existing persisted-diagram and SQLite migration compatibility;
4. add or update tests for behavior changes;
5. run `npm test`, `npm run lint`, and `npm run build`; and
6. open a pull request describing behavior, data/schema impact, security considerations, and manual browser checks.

Avoid committing generated runtime data or secrets. **TODO:** add `CONTRIBUTING.md`, an explicit branching policy, pull-request template, and CI workflow.

## License and support

No license file or package license field is present. **TODO:** the repository owner must choose and add a license; until then, no license grant should be assumed.

Use the repository's [GitHub issue tracker](https://github.com/Orbis-Datacrest/SysML-Tool/issues) for defect reports and feature requests. **TODO:** add a maintainer/support contact and response policy.
