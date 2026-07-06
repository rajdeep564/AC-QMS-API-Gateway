# Session 1 Verification Report — Rev 2.3 Schema Reset + Product Master

**Date:** 2026-07-04  
**Scope:** API Gateway server — schema baseline, SADMIN-owned Product Master (EAV), Session 1 seed.

## Implemented

| Area | Status | Notes |
|------|--------|-------|
| `schema.prisma` Rev 2.3 (22 tables) | Done | `spec_templates` / `spec_template_tests` removed; EAV `product_master_fields` added |
| Prisma client regenerate | Done | `npx prisma generate` |
| `master-workflow.service.ts` | Done | SADMIN transitions; `APPROVE` / `REJECT` / `ASSIGN` / `EDIT_FIELDS` |
| Masters module (EAV CRUD) | Done | Create via `POST /products/:id/masters`; patch/approve/reject/assign on `/masters/:id/*` |
| Products module simplified | Done | `id`, `name`, `created_at` only |
| Auth session model | Done | `tokenHash` on `sessions` (no `refreshToken` / IP / UA columns) |
| Deferred routes unmounted | Done | spec-templates, batches, documents, aws, marketing removed from `routes/index.ts` |
| Typecheck | **Pass** | `npm run typecheck` (S2/S3 modules excluded in `tsconfig.json`) |
| Session 1 seed | Done | 6 users, Glycine product, ACTIVE master rev 1, 18 EAV fields (Rajesh) |
| `verify-session1.ts` | Done | `npm run verify:session1` |
| Baseline migration SQL | Done | `prisma/migrations/20260704120000_rev2_3_reset/migration.sql` |

## Blocked (environment)

Docker Desktop was **not running** during this session. The following could not be executed:

```powershell
cd AC-QMS-API-Gateway
docker compose up -d
npm run db:up
npx prisma migrate reset    # or: npx prisma db push --force-reset
npm run seed
npm run verify:session1
npm run dev
```

### Recommended local bootstrap (after starting Docker)

Because pre-Rev-2.3 migration history conflicts with the new baseline, use a **force reset** for local dev:

```powershell
cd AC-QMS-API-Gateway
npx prisma db push --force-reset
npm run seed
npm run verify:session1
```

Alternatively, archive legacy migration folders and run `npx prisma migrate reset` against only `20260704120000_rev2_3_reset`.

## Session 1 seed credentials

| User | Username | Role | Password |
|------|----------|------|----------|
| Rajesh Kumar | `rajesh.kumar` | SADMIN | `Acqms@2026` |
| Kavya Patel | `kavya.patel` | QC_EXEC | `Acqms@2026` |
| Meera Iyer | `meera.iyer` | QC_EXEC | `Acqms@2026` |
| Priya Mehta | `priya.mehta` | QC_MGR | `Acqms@2026` |
| Anand Joshi | `anand.joshi` | QA_EXEC | `Acqms@2026` |
| Sanjay Reddy | `sanjay.reddy` | QA_MGR | `Acqms@2026` |

**Glycine:** one ACTIVE Product Master (revision 1), 18 EAV identity fields, created/approved by Rajesh. No batches, specs, or tests in seed.

## API surface (Session 1)

| Method | Path | Role |
|--------|------|------|
| POST | `/api/products` | SADMIN |
| GET | `/api/products` | Any authenticated |
| GET | `/api/products/:id` | Any authenticated |
| GET | `/api/products/:id/masters` | Any authenticated |
| POST | `/api/products/:productId/masters` | SADMIN — `mode: direct \| assign` |
| GET | `/api/masters/:id` | Any authenticated |
| PATCH | `/api/masters/:id/fields` | SADMIN or assignee (DRAFT only) |
| POST | `/api/masters/:id/approve` | SADMIN |
| POST | `/api/masters/:id/reject` | SADMIN |
| POST | `/api/masters/:id/assign` | SADMIN |

Master workflow actions do **not** require password re-entry (Bible 5.1).

## Manual smoke test (after DB up)

1. `POST /api/auth/login` as `rajesh.kumar`
2. `GET /api/products` — Glycine present
3. `GET /api/products/{id}/masters` — one ACTIVE rev 1
4. `GET /api/masters/{id}` — 18 fields, `allowedActions: []` (ACTIVE)
5. `POST /api/products/{id}/masters` with `mode: assign`, `assignedTo: <kavya id>` — DRAFT + notification
6. Login as Kavya → `PATCH /api/masters/{id}/fields`
7. Login as Rajesh → `POST /api/masters/{id}/approve` — ACTIVE, prior ACTIVE superseded
