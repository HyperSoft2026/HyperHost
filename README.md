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
- **Discord OAuth2 Authentication**: Native OAuth2 authorization code flow with CSRF state validation, encrypted token storage, and HTTP-only session cookies.
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
+-----------------------------------------------------------------------+
|                        HYPERHOST CONTROL PLANE                        |
|  Fastify 5 + TypeScript + Prisma ORM + Zod + WebSocket + Scheduler    |
|                                                                       |
|  - Discord OAuth2 & Session Management                                |
|  - Host & Node Metadata (PostgreSQL)                                  |
|  - AES-256-GCM Secret Vault (HostEnvironment)                         |
|  - 21-Scope Granular RBAC & Sanitized Activity Logs                   |
+-----------------------------------+-----------------------------------+
                                    |
                    Mutual-Auth RPC / WebSocket Tunnel
                                    |
+-----------------------------------v-----------------------------------+
|                         HYPERHOST RUNTIME PLANE                       |
|       Remote Runtime Nodes (NodeAgent / ContainerManager / Docker)    |
|                                                                       |
|  - ProcessManager & ContainerManager (CPU / RAM / Disk quotas)        |
|  - Live Console Streams (stdout / stderr / stdin)                     |
|  - Isolated Volume FileManager & S3 BackupStorageAdapter              |
|  - MetricsCollector & DatabaseProvisioner                             |
+-----------------------------------------------------------------------+
```

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
3. Clever Cloud automatically runs `npm install` and `npm run build`, then starts the application via `npm start`.
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
