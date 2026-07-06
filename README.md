# AC-QMS API (Backend)

Aditya Chemicals QMS API — backend for the AC-QMS quality management system (Phase 1).

## Prerequisites

- Node.js 20 LTS
- Docker (for PostgreSQL 16)
- Docker Postgres runs on host port **5433** (coexists with local Postgres on 5432)

## Project structure

```
src/           — Application code (modules, services, middleware, routes)
prisma/        — Schema, migrations, seed
scripts/       — Verification and utility scripts
docs/          — Verification reports and design notes
```

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for layering, module shape, and session implementation notes.

```
src/
  lib/           — Shared contract (HTTP status, error codes, AppError, api-response, logger)
  middleware/    — Cross-cutting Express middleware (auth, rbac, validate, error-handler)
  routes/        — Route aggregator (mounts all module routers under /api/v1)
  modules/       — Feature modules (each with identical file shape)
  services/      — Cross-domain services (audit, workflow, notifications, generators)
  utils/         — Pure helpers (dates, pagination, doc-number formatters)
  config/        — Environment, Prisma client, app constants
```

## Setup

1. Start PostgreSQL:

   ```bash
   npm run db:up
   ```

2. Install dependencies and run migrations:

   ```bash
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

## API server

```bash
npm run dev
```

Server runs at `http://localhost:4000`. Health check: `GET /api/v1/health`.

```bash
npm run typecheck          # TypeScript validation
npm run verify:session1    # Session 1 regression
npm run verify:session2    # Session 2 regression
npm run verify:session3    # Session 3 regression
```

## Dev login credentials

All seeded users share the dev password:

- **Username:** any seeded user (e.g. `kavya.patel`)
- **Password:** `Acqms@2026`

Run `npm run seed` to reset passwords if changed during testing.
