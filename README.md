<div align="center">
  <img src="assets/Logo.png" alt="HyperHost Official Logo" width="120" />
  <h1>HyperHost</h1>
  <p><strong>Powered by HyperSoft</strong></p>
  <p>Professional Discord &amp; Telegram Bot Hosting Platform</p>
</div>

---

## Description

**HyperHost** is an enterprise-grade hosting control plane engineered by **HyperSoft** for deploying, managing, and scaling **Discord Bots**, **Telegram Bots**, and polyglot workloads (**Node.js**, **Python**, **Java**, **Go**, and **Rust**, with extensible adapters for PHP, Ruby, .NET, and C++).

HyperHost enforces a strict separation between the **Control Plane** (authentication, database persistence, granular RBAC permissions, scheduling, audit logging, and WebSocket multiplexing) and the **Runtime Plane** (remote isolated container execution nodes). Every user account is governed by a strict backend quota of **10 Hosts maximum** (`MAX_HOSTS_PER_USER = 10`).

---

## Features

- **Control Plane & Runtime Plane Separation**: The Web Control Plane never executes untrusted user processes on its own host OS; all container operations are delegated to remote Runtime Nodes.
- **Discord OAuth2 Authentication & Login DM Notifications**: Native OAuth2 authorization code flow with HMAC-SHA256 + cookie CSRF state validation, encrypted token storage, HTTP-only session cookies, and automated Discord Login DM Notifications (`DISCORD_BOT_TOKEN`) localized in `ar-IQ` or `en-US` with official link buttons (`Visit HyperHost` / `زيارة HyperHost` and `HyperSoft Discord` / `سيرفر HyperSoft`).
- **Exact Bilingual Localization (`ar-IQ` RTL & `en-US` LTR)**: Built-in localization engine (`src/client/i18n.tsx`) supporting `"ar-IQ"` (default, RTL) and `"en-US"` (LTR) with persistent `localStorage` + cookie synchronization and dynamic `dir="rtl"` / `dir="ltr"` layout adaptation.
- **Strict 10-Host Account Quota**: Enforced at the Fastify API & PostgreSQL transaction layer (`MAX_HOSTS_PER_USER = 10`).
- **12-Module Host Control Panel**:
  - **Console**: Real-time WebSocket stream (`/api/hosts/:id/console/ws`) supporting `stdout`, `stderr`, `stdin`, clear, and reconnect. Reports `"Runtime node unavailable"` when no Runtime Node is connected.
  - **Files**: Remote Runtime Node file manager (`Browse`, `Create File`, `Create Folder`, `Edit`, `Rename`, `Move`, `Delete`, `Upload`, `Download`).
  - **Startup**: Configurable runtime version, startup command, arguments, working directory, and AES-256-GCM encrypted environment variables.
  - **Network**: Node IP/Port/Protocol allocation management (`TCP`, `UDP`, `BOTH`) with primary allocation binding.
  - **Metrics**: Real-time container CPU, Memory, Disk, Network RX/TX, and Uptime telemetry. Displays `"No metrics available"` when no Runtime Node is connected.
  - **Management**: `Start`, `Stop`, `Restart`, `Kill`, and `Reinstall` lifecycle operations with truthful node availability responses.
  - **Databases**: Abstraction layer for provisioning **PostgreSQL**, **MySQL**, **MongoDB**, and **Redis** host databases.
  - **Schedules**: Server-side Control Plane Cron Scheduler supporting automated restarts, commands, and backups.
  - **Backups**: S3 / Object Storage archive snapshot abstraction (`Create`, `Restore`, `Download`, `Delete`).
  - **Administration & Users**: Collaborator management with **21 granular permission scopes**.
  - **Settings & Activity**: Host configuration and cryptographically sanitized audit logs.

---

## Architecture

```text
HyperHost Control Plane
        ↓
Clever Cloud API Bridge (https://api-bridge.clever-cloud.com/)
        ↓
Dedicated Clever Cloud Application (hyperhost-runtime-{hostPublicId})
        ↓
Runtime Node Agent (src/runtime/node-agent.ts)
        ↓
Host Process
```

```text
Host A ──► Clever Cloud App A ──► Node A ──► Host A Process
Host B ──► Clever Cloud App B ──► Node B ──► Host B Process
```

---

## Automatic Per-Host Runtime Provisioning on Clever Cloud (`CleverCloudRuntimeProvisioner`)

HyperHost provisions a dedicated **Clever Cloud Node.js Application** for every Host (`src/runtime/providers/clever-cloud.ts` & `src/runtime/provisioner.ts`). Runtime Nodes are **never** added manually by admins or users, and users **never** interact with `NODE_ID`, `NODE_TOKEN`, or `CONTROL_PLANE_WS_URL`.

### 1. Required Control Plane Environment Variables

Configure the following server-side variables on the HyperHost Control Plane:

```dotenv
CLEVER_CLOUD_API_TOKEN=<clever-cloud-api-token>
CLEVER_CLOUD_ORGANISATION_ID=<orga_xxx-or-self>
CLEVER_CLOUD_API_BASE_URL=https://api-bridge.clever-cloud.com
```

> **Security & Auth:** Authentication uses standard HTTP `Authorization: Bearer ${CLEVER_CLOUD_API_TOKEN}` against `https://api-bridge.clever-cloud.com/v2/...`. No OAuth1 is used. `CLEVER_CLOUD_API_TOKEN`, `NODE_ID`, and `NODE_TOKEN` are handled exclusively on the backend Control Plane, never sent to the Frontend, and automatically scrubbed from logs. Only the HMAC-SHA256 hash (`agentTokenHash`) of `NODE_TOKEN` is stored in PostgreSQL.

### 2. Clever Cloud Public API Bridge Provisioning Flow

When a user creates a Host (`POST /api/hosts`), `runtimeProvisionerService.provisionHostRuntime(hostId)` executes:

1. `PENDING` → Creates the `Host` record in PostgreSQL.
2. `PROVISIONING` →
   - Generates per-Host `NODE_ID` and `NODE_TOKEN` server-side and stores only `agentTokenHash` in PostgreSQL.
   - Queries `GET https://api-bridge.clever-cloud.com/v2/products/instances` to resolve the active Node.js runtime variant on Clever Cloud.
   - Calls `POST https://api-bridge.clever-cloud.com/v2/organisations/{orgId}/applications` to create a dedicated Clever Cloud Node.js Application named `hyperhost-runtime-{hostPublicIdentifier}`.
   - If the Clever Cloud API Bridge call fails, transitions to `PROVISIONING_FAILED`.
3. `BOOTSTRAPPING` →
   - Calls `PUT https://api-bridge.clever-cloud.com/v2/organisations/{orgId}/applications/{appId}/env` to inject `CONTROL_PLANE_WS_URL`, `NODE_ID`, `NODE_TOKEN`, `HOST_ID`, and `CC_RUN_COMMAND="npm run start:node-agent"`.
   - Packages and pushes the standalone Runtime Node Agent (`src/runtime/node-agent.ts` + `package.json`) to the Clever Cloud Application's Git deployment URL (`deployUrl`) and triggers `POST https://api-bridge.clever-cloud.com/v2/organisations/{orgId}/applications/{appId}/instances`.
   - Polls `GET https://api-bridge.clever-cloud.com/v2/organisations/{orgId}/applications/{appId}/deployments` and `/instances` until the Clever Cloud deployment and instance reach a real running state.
   - If deployment or startup fails, transitions to `BOOTSTRAP_FAILED`.
4. `NODE_CONNECTING` → Waits for the deployed Runtime Node Agent on Clever Cloud to establish its authenticated WebSocket connection (`/api/runtime/nodes/ws`). While the Node has not connected yet, the Host remains in `NODE_CONNECTING`.
5. `NODE_ONLINE` → Dedicated Node completes its `hello` handshake and is verified `ONLINE`.
6. `STARTING` → Control Plane dispatches workspace initialization and `process.start` to the dedicated Node Agent.
7. `RUNNING` → Dedicated Node Agent spawns the real OS process (`child_process.spawn`) inside the Host's isolated workspace.

### 3. Host Deletion & Orphan Prevention

When a Host is deleted (`DELETE /api/hosts/:id`):
1. Stops the running Host process on the Node.
2. Disconnects the Runtime Node WebSocket.
3. Calls `DELETE https://api-bridge.clever-cloud.com/v2/organisations/{orgId}/applications/{appId}` to delete the dedicated Clever Cloud Application.
4. Deletes the `Node` and `Host` records in PostgreSQL.
5. If Clever Cloud API deletion fails transiently, logs the error, records a retry audit entry, and marks the Node record `DELETE_RETRY_REQUIRED` so the Control Plane Scheduler automatically retries deleting the Clever Cloud Application.

---

## Tech Stack

- **Backend**: Node.js (22+ / 24 compatible), TypeScript, Fastify 5
- **Frontend**: React 19, TypeScript, Vite 6, Tailwind CSS 4
- **Database**: PostgreSQL
- **ORM**: Prisma
- **Realtime**: `@fastify/websocket` (WebSocket)
- **Validation**: Zod
- **Authentication**: Discord OAuth2
- **Package Manager**: `npm`

---

## Development

```bash
# 1. Install dependencies
npm install

# 2. Generate Prisma Client
npm run db:generate

# 3. Run database migrations (requires DATABASE_URL)
npm run db:migrate

# 4. Start development server (binds to 0.0.0.0:$PORT)
npm run dev
```

---

## Environment Variables

Copy `.env.example` to `.env` and configure the required variables:

```dotenv
NODE_ENV=development
PORT=8080
HOST=0.0.0.0

DATABASE_URL=postgresql://user:password@host:5432/hyperhost?schema=public

SESSION_SECRET=replace-with-64-char-random-hex
ENCRYPTION_KEY=replace-with-64-char-random-hex

DISCORD_CLIENT_ID=your-discord-application-client-id
DISCORD_CLIENT_SECRET=your-discord-application-client-secret
DISCORD_REDIRECT_URI=https://your-domain.example.com/api/auth/discord/callback
DISCORD_BOT_TOKEN=optional-discord-bot-token-for-user-dm-login-notifications
DISCORD_LOGIN_WEBHOOK_URL=optional-discord-webhook-url-for-login-notifications
DISCORD_NOTIFICATION_CHANNEL_ID=optional-discord-channel-id-for-login-notifications
ADMIN_DISCORD_IDS=optional-comma-separated-admin-discord-ids

APP_URL=https://your-domain.example.com
CORS_ORIGIN=https://your-domain.example.com

S3_ENDPOINT=
S3_BUCKET=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_REGION=
```

---

## Database Setup

HyperHost uses **PostgreSQL** with **Prisma ORM** (`prisma/schema.prisma`):

```bash
# Generate typed Prisma client
npm run db:generate

# Apply production migrations
npm run db:deploy
```

---

## Discord OAuth2 Setup

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and create an application.
2. Under **OAuth2 → Redirects**, register your callback URL:
   - `<APP_URL>/api/auth/discord/callback`
3. Set `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, and `DISCORD_REDIRECT_URI` in your environment variables.

---

## Production Deployment

```bash
npm install
npm run build
npm start
```

---

## Clever Cloud Deployment

HyperHost is engineered for zero-friction deployment on **Clever Cloud** (Node.js runtime + PostgreSQL add-on):

1. Create a **Node.js** application and link a **PostgreSQL** add-on on Clever Cloud (`DATABASE_URL` is injected automatically).
2. Configure environment variables (`SESSION_SECRET`, `ENCRYPTION_KEY`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI`, `APP_URL`).
3. Clever Cloud automatically executes the following deployment sequence:
   - `npm install` (automatically triggers `postinstall` → `prisma generate`)
   - `npm start` (automatically triggers `prestart` → `npm run db:deploy` → `prisma migrate deploy` before starting `tsx src/server/index.ts --production`). If database migrations fail, `prestart` exits with a non-zero status code and prevents a broken application from starting.
4. The Fastify server dynamically listens on `process.env.PORT` and binds to `0.0.0.0`.
5. Health checks are exposed at `/health` and `/api/health`.

---

## Runtime Node Architecture

The Runtime Plane contract is defined in `src/runtime/interfaces.ts` and `src/runtime/registry.ts`:

- `NodeAgent`: Represents a remote Runtime Node daemon authenticated via HMAC-SHA256 token hash.
- `RuntimeAdapter`: Resolves container images and entrypoint commands for Node.js, Python, Java, Go, Rust, PHP, Ruby, .NET, and C++.
- `ProcessManager` & `ContainerManager`: Controls isolated container lifecycle (`start`, `stop`, `restart`, `kill`, `reinstall`).
- `FileManager`: Executes sandboxed remote file operations with path-traversal protection.
- `MetricsCollector`: Streams real-time container CPU, memory, disk, and network counters.

---

## Security

- **HTTP Security Headers**: Managed via `@fastify/helmet`.
- **Rate Limiting**: Enforced on `/api/*` via `@fastify/rate-limit`.
- **Input Validation**: Strict Zod schema validation on all request payloads and path traversal prevention.
- **Secret Encryption**: Host environment variables and OAuth tokens are encrypted at rest using **AES-256-GCM** (`src/server/crypto.ts`).
- **Session Security**: Sessions use HMAC-SHA256 hashed tokens with `HttpOnly`, `Secure`, and `SameSite` cookie attributes.
- **Sanitized Error & Audit Handling**: Stack traces are never leaked in production responses, and secrets are automatically redacted from `ActivityLog` and application logs.

---

## Roadmap

- Standalone Rust/Go `hyperhost-node-agent` daemon for bare-metal Linux servers
- Automated S3 multipart streaming for multi-gigabyte container backups
- Runtime adapters for PHP, Ruby, .NET 9, and C++20 workloads
- Multi-node container migration and failover orchestration

---

## Project Structure

```text
HyperHost/
├── assets/
│   └── Logo.png                  # Official HyperHost identity (preserved)
├── prisma/
│   ├── schema.prisma             # PostgreSQL Prisma schema (13 models)
│   └── migrations/               # SQL migrations
├── src/
│   ├── shared/
│   │   ├── types.ts              # Shared DTOs, Runtimes, 21 Permissions, Quota constants
│   │   └── validation.ts         # Zod validation schemas
│   ├── runtime/
│   │   ├── interfaces.ts         # NodeAgent, RuntimeAdapter, Process/Container/File/Metrics interfaces
│   │   └── registry.ts           # RuntimeNodeRegistry & RuntimeAdapter resolution
│   ├── server/
│   │   ├── config.ts             # Environment configuration (PORT, HOST=0.0.0.0, OAuth, DB)
│   │   ├── logger.ts             # Structured logger with secret redaction
│   │   ├── crypto.ts             # AES-256-GCM encryption & HMAC-SHA256 token hashing
│   │   ├── database.ts           # PrismaClient singleton & health checks
│   │   ├── errors.ts             # Structured API error handler
│   │   ├── auth.ts               # Session middleware, RBAC & ownership guards, ActivityLog writer
│   │   ├── scheduler.ts          # Control Plane Cron Scheduler Worker
│   │   ├── routes/
│   │   │   ├── health.ts         # /health and /api/health
│   │   │   ├── auth.ts           # Discord OAuth2 flow (/api/auth/*)
│   │   │   ├── users.ts          # /api/users/*
│   │   │   ├── hosts.ts          # /api/hosts/* (12 Host Panel APIs + WebSocket console)
│   │   │   └── admin.ts          # /api/admin/* (Nodes, Allocations, Overview)
│   │   └── index.ts              # Fastify server entrypoint
│   ├── client/                   # Modular React frontend views & API client
│   ├── App.tsx                   # Main application workspace shell
│   ├── main.tsx                  # React DOM entry
│   └── index.css                 # Tailwind CSS 4 theme
├── .env.example
├── .gitignore
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

---

## License

Copyright © HyperSoft. All rights reserved.
