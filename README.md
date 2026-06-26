# AC-QMS-API-Gateway

Aditya Chemicals QMS API — backend gateway for the AC-QMS quality management system (Phase 1).

## Prerequisites

- Node.js 20 LTS
- Docker (for PostgreSQL 16)
- Docker Postgres runs on host port **5433** (coexists with local Postgres on 5432)

## Project structure

```
/server   — Backend API (Prisma, PostgreSQL)
/client   — Frontend (deferred)
/types    — Shared TypeScript types (deferred)
```

## Architecture

The backend follows a strict layered layout:

```
server/src/
  lib/           — Shared contract (HTTP status, error codes, AppError, api-response, logger)
  middleware/    — Cross-cutting Express middleware (auth, rbac, validate, error-handler)
  routes/        — Route aggregator (mounts all module routers under /api/v1)
  modules/       — Feature modules (each with identical file shape)
  services/      — Cross-domain services (audit, workflow, notifications, generators)
  utils/         — Pure helpers (dates, pagination, doc-number formatters)
  config/        — Environment, Prisma client, app constants
```

### Module shape (canonical)

Every feature module under `modules/<name>/` contains:

| File | Responsibility |
|------|----------------|
| `<name>.routes.ts` | Wire middleware → controller only |
| `<name>.controller.ts` | HTTP: parse req, call service, return `ok()` |
| `<name>.service.ts` | Business logic; owns all Prisma for this domain |
| `<name>.schema.ts` | Zod request schemas |
| `<name>.types.ts` | Module-local DTOs |
| `<name>.constants.ts` | Module constants (optional) |

**Rules:** controllers never touch Prisma; services never touch req/res; no try/catch in controllers (`asyncHandler` handles errors).

### Database

21 application tables (+ `_prisma_migrations` = 22 physical tables in PostgreSQL).

## Setup

1. Start PostgreSQL:

   ```bash
   cd server
   npm run db:up
   ```

2. Install dependencies and run migrations:

   ```bash
   cd server
   npm install
   npm run migrate
   ```

3. Seed reference data:

   ```bash
   npm run seed
   ```

4. Open Prisma Studio (optional):

   ```bash
   npm run studio
   ```

## Phase 1 scope

- Docker PostgreSQL 16 (port 5433)
- Prisma schema (21 application tables)
- Initial migration + seed (departments, users)
- Auth: JWT login, refresh, RBAC middleware
- Audit service (login/logout wired)

**Deferred:** business modules (products, masters, documents), frontend.

## Dev login credentials

All seeded users share the dev password:

- **Username:** any seeded user (e.g. `kavya.patel`)
- **Password:** `Acqms@2026`

Run `npm run seed` to reset passwords if changed during testing.

## API server

```bash
cd server
npm run dev
```

Server runs at `http://localhost:4000`. Health check: `GET /api/v1/health`.

```bash
npm run typecheck   # TypeScript validation
```
