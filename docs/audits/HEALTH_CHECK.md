# AC-QMS Full-System Health Check

**Date:** 2026-07-09  
**Scope:** `AC-QMS-API-Gateway` + `AC-QMS-Frontend-Next`  
**Mode:** Read-only diagnostic. No code changes except this report.  
**DB state:** As-is (no reset). Postgres container was already running.

---

## 1. Build and compile state

### Backend (`AC-QMS-API-Gateway`)

| Command | Exit code | Result |
|---------|-----------|--------|
| `npm run typecheck` (`tsc --noEmit`) | **0** | **PASS** — no errors |
| `npx prisma validate` | **0** | **PASS** — `The schema at prisma\schema.prisma is valid` |
| `npx prisma migrate status` | **0** | **PASS** — `Database schema is up to date!` (3 migrations) |

**Errors:** None.

### Frontend (`AC-QMS-Frontend-Next`)

| Command | Exit code | Result |
|---------|-----------|--------|
| `npm run typecheck` (`tsc --noEmit`) | **0** | **PASS** — no errors |
| `npm run build` (`next build`) | **0** | **PASS** — compiled successfully |

**ESLint warning (non-blocking):**

```
./src/features/documents/AwsDataEntryPage.tsx
81:9  Warning: The 'sections' logical expression could make the dependencies of useMemo Hook (at line 92) change on every render.  react-hooks/exhaustive-deps
```

**Classification:** Cosmetic (lint only; build succeeded).

---

## 2. Runtime bring-up

| Check | Result | Classification |
|-------|--------|----------------|
| Docker Postgres | **UP** — `ac-qms-api-gateway-acqms-db-1` on `0.0.0.0:5433->5432` | Environment OK |
| `DATABASE_URL` | `postgresql://acqms:acqms_dev_pw@localhost:5433/acqms` | OK |
| `npm run seed` | **Exit 0** — `Seeded 6 users, product "Glycine", master with 18 EAV fields` | PASS |
| Backend health | **HTTP 200** — `GET http://localhost:4000/api/v1/health` → `{"success":true,"data":{"status":"ok"}}` | PASS (server already running) |
| `CORS_ORIGIN` (`.env`) | `http://localhost:5173` | **Stale** — Next.js frontend defaults to `http://localhost:3000` |
| `CORS_ORIGIN` (`.env.example`) | `http://localhost:5173` | Same stale default |

**Seed errors:** None observed (no Product.code class failure on this run).

**[INFERENCE]** With `CORS_ORIGIN=http://localhost:5173`, browser requests from `http://localhost:3000` may be blocked by CORS when using real auth + cookies. This is an **environment/config** issue, not a compile failure.

---

## 3. Backend verify scripts

All run against live Postgres (as-is DB). Backend dev server was up.

| Script | Exit code | Result | Notes |
|--------|-----------|--------|-------|
| `verify:session1` | **0** | **PASS** | 24 tables, 6 users, Glycine 18 fields |
| `verify:session2` | **0** | **PASS** | Standing SPEC/MOA lifecycle |
| `verify:session3` | **0** | **PASS** | Full batch→AWS→COA→RELEASED service chain |
| `verify:audit-tx-s3` | **0** | **PASS** | All 4 audit tx checks |
| `verify:users` | **0** | **PASS** | 11/11 checks |
| `verify:session3-phase-a` | **0** | **PASS** | Batch approve, AWS activation, snapshot immutability |
| `verify:session3-phase-b` | **0** | **PASS** | AWS execution, two-person, OOS/expiry ack |
| `verify:session3-phase-c` | **0** | **PASS** | COA auto-gen, sign-and-issue, `released_at` |
| `verify:p2c` | **0** | **PASS** | Instruments/reagents, AWS DTO gaps, allowedActions |

**Failures:** None.

**Appendix (not run — present in `package.json`):** `verify:12c`, `verify:15`, `verify:16`. `verify:15` targets `/marketing/*` which is **unmounted** (confirmed `GET /api/v1/marketing/documents` → **404**).

---

## 4. Frontend verify scripts

Backend at `http://localhost:4000/api/v1`. DB as-is.

| Script | Exit code | Result | Fixture model |
|--------|-----------|--------|---------------|
| `verify:p2a` | **1** | **FAIL** (15/16 pass) | Mixed static + runtime; uses seed Glycine for some API probes |
| `verify:p2b` | **1** | **FAIL** (13/14 pass) | Runtime needs QA_SIGNED SPEC on product (state-dependent) |
| `verify:p2c` | **0** | **PASS** (8/8) | **Self-contained** per-run fixture |
| `verify:p2d` | **0** | **PASS** (13/13) | **Self-contained** — extends P2-C through COA |

### `verify:p2a` failure detail

| # | Result | Evidence |
|---|--------|----------|
| 13 | **FAIL** | `batch-api still demo-only` |

**Root cause:** **Harness staleness (code in repo is correct).** Check #13 asserts `!batchApi.includes('@/lib/api/client')` — but `batch-api.ts` was rewired live in P2-B. All other checks including full SPEC lifecycle runtime **PASS**.

### `verify:p2b` failure detail

| # | Result | Evidence |
|---|--------|----------|
| 7 | **FAIL** | `AWS/COA PENDING indicators non-navigable` |

**Root cause:** **Harness staleness (code in repo is correct).** Check #7 expects `BatchDocumentIndicator` without `<Link>` and with `"Execution opens in a later release"`. After P2-C/D, AWS and COA indicators link when navigable. Runtime lifecycle check #11 **PASS**.

### Raw runtime highlights (self-contained scripts)

```
[P2-C GATE #13] AWS submit → SUBMITTED | approve → QC_APPROVED | sign → QA_SIGNED
[P2-D GATE #8]  COA status=AUTO_GENERATED results=2 verdict=COMPLIES
[P2-D GATE #9]  COA status=ISSUED batch.status=RELEASED
[P2-D GATE #10] priya allowedActions=[] POST HTTP 403
```

---

## 5. Backend↔frontend contract drift

### Endpoint matrix (live `*-api.ts` + `auth-api.ts`)

All frontend calls below are mounted in [`AC-QMS-API-Gateway/src/routes/index.ts`](AC-QMS-API-Gateway/src/routes/index.ts).

| Frontend module | Method | Path | Backend mounted? |
|-----------------|--------|------|------------------|
| auth-api | POST | `/auth/login` | Yes |
| auth-api | POST | `/auth/refresh` | Yes |
| auth-api | GET | `/auth/me` | Yes |
| auth-api | POST | `/auth/logout` | Yes |
| product-api | GET/POST | `/products`, `/products/:id` | Yes |
| product-api | GET/POST | `/products/:id/masters` | Yes |
| product-api | GET/PATCH/POST | `/masters/:id/*` | Yes |
| spec-api | GET/POST | `/products/:id/specs` | Yes |
| spec-api | GET/PATCH/POST | `/specs/:id/*` | Yes |
| batch-api | GET | `/batches`, `/batches/:id` | Yes |
| batch-api | POST | `/products/:id/batches` | Yes (on products router) |
| batch-api | POST | `/batches/:id/submit|approve|reject` | Yes |
| aws-api | GET | `/documents/:id` | Yes |
| aws-api | POST | `/documents/:id/submit|approve|sign|reject` | Yes |
| aws-api | GET | `/aws/documents/:id/sections` | Yes |
| aws-api | GET/PATCH/POST | `/aws/sections/:id/*` | Yes |
| aws-api | GET | `/instruments`, `/reagents` | Yes |
| coa-api | GET | `/documents/:id` | Yes |
| coa-api | POST | `/documents/:id/sign-and-issue` | Yes |
| users-api | GET | `/users` | Yes |

**Frontend calls to unmounted backend routes:** None in live `*-api.ts` modules.

**Backend routes exist but frontend does not call (expected deferred):**

| Path prefix | Mounted? | Frontend |
|-------------|----------|----------|
| `/marketing/*` | **No** (404) | Not built |
| `/notifications/*` | Yes | Frontend notifications use **demo store**, not API |
| Audit log list | **No route** | `audit-api.ts` → demo only |

### DTO / request body mismatches

| Area | Frontend | Backend | Severity | Classification |
|------|----------|---------|----------|----------------|
| **AWS document submit** | `submitAwsDocument` posts `{}` ([`aws-api.ts:87`](AC-QMS-Frontend-Next/src/lib/data/aws-api.ts)) | `transitionBodySchema` requires `{ password: string }` ([`masters.schema.ts:42`](AC-QMS-API-Gateway/src/modules/masters/masters.schema.ts)) | **Blocker** for production AWS Submit button | **Code** — probed: `POST /documents/:id/submit` with `{}` → **HTTP 422** |
| **Batch `releasedAt`** | Not on [`BatchDetailDto`](AC-QMS-Frontend-Next/src/types/batch.ts) | Set in DB on release ([`batches.repository.ts`](AC-QMS-API-Gateway/src/modules/batches/batches.repository.ts)); omitted from [`toBatchDetail`](AC-QMS-API-Gateway/src/modules/batches/batches.service.ts) | **Degraded** — COA issued UI cannot show release timestamp | **Code** (API gap) |
| **Users list name** | `UserListItemDto.name` | Backend maps `fullName` → `name` | **OK** — aligned |
| **AWS `oosAcknowledged`** | On section DTO types | Exposed in [`aws.mapper.ts`](AC-QMS-API-Gateway/src/modules/aws/aws.mapper.ts) post P2-C | **OK** — gap closed |
| **`current_doc_phase`** | N/A | **Absent** from [`schema.prisma`](AC-QMS-API-Gateway/prisma/schema.prisma); still mentioned in [`ARCHITECTURE.md`](AC-QMS-API-Gateway/ARCHITECTURE.md) | Tracked docs drift | **Expected** |

---

## 6. Residual demo / live inconsistency (frontend)

### `*-api.ts` module status

| Module | State | Evidence |
|--------|-------|----------|
| `product-api.ts` | **LIVE** | `apiClient` |
| `spec-api.ts` | **LIVE** | `apiClient` |
| `batch-api.ts` | **LIVE** | `apiClient` |
| `aws-api.ts` | **LIVE** | `apiClient` |
| `coa-api.ts` | **LIVE** | `apiClient` |
| `users-api.ts` | **LIVE** | `apiClient` |
| `document-api.ts` | **DEMO** | `demo-data.core.js` — timeline, approval review |
| `dashboard-api.ts` | **DEMO** | QC/QA dashboards, released register |
| `audit-api.ts` | **DEMO** | no `apiClient` |

### Screens mixing live and demo

| Screen / area | Data source | Issue |
|---------------|-------------|-------|
| Product masters, SPEC, batch list/detail, AWS, COA | Live APIs | OK |
| Document timeline, approval review | `document-api` demo | Expected deferred |
| QC/QA dashboards | `dashboard-api` demo | Demo queues, docNo URLs |
| Notifications | `useDemoStore` | Not wired to `/notifications` API |
| Audit log viewer | `audit-api` demo | No backend list route |
| Instruments master page | `instruments-data.ts` static | Demo UI; AWS pickers use live `/instruments` via `aws-api` |
| Released batches report | `dashboard-api` demo | Demo COA links |

### Stale docNo-based links (tracked cleanup)

| Consumer | Function | Problem |
|----------|----------|---------|
| [`notification-routes.ts`](AC-QMS-Frontend-Next/src/lib/routes/notification-routes.ts) | `appDocCoaUrl(docNo)`, `appDocAwsUrl(docNo)` | docNo paths; live routes use UUID (`/documents/coa/[coaDocId]`, `/documents/aws/[awsDocId]`) |
| [`qms-routes.ts`](AC-QMS-Frontend-Next/src/lib/routes/qms-routes.ts) | `appDocCoaUrl`, `appDocAwsUrl` | HTML-era route mapping |
| [`audit-entity-routes.ts`](AC-QMS-Frontend-Next/src/lib/data/audit-entity-routes.ts) | `appDocCoaUrl` | COA entity links broken for live COA |
| [`QaManagerDashboard.tsx`](AC-QMS-Frontend-Next/src/features/dashboard/QaManagerDashboard.tsx) | `docUrl('COA Sign & Issue.html', d.docNo)` | Demo dashboard COA queue |

**Note:** [`document-api.appDocAwsUrl`](AC-QMS-Frontend-Next/src/lib/data/document-api.ts) was updated to UUID form for AWS, but demo route helpers still pass **docNo** strings in several places.

### Dead routes / imports

- Old COA route `[...docNo]` removed; live route `/documents/coa/[coaDocId]` present in build output.
- No broken imports detected in `tsc` / `next build`.

---

## 7. Known tracker items — current status

| Item | Status | Evidence |
|------|--------|----------|
| Marketing routes | **Open (expected)** | Module exists under `src/modules/marketing/`; **not** in `routes/index.ts`; `GET /marketing/documents` → 404 |
| Audit-log list API | **Open (expected)** | No `audit` router in gateway; frontend `audit-api.ts` demo-only |
| `current_doc_phase` schema drift | **Open (docs only)** | Not in Prisma schema; referenced in `ARCHITECTURE.md` |
| `released_at` (Session 3C) | **Present in DB** | Migration `20260708140000_session3c_coa_released_at`; `verify:session3-phase-c` check #10 PASS; **not exposed** on batch API DTO |
| Frozen-doc residue (US-22-2, Epic 6/11 MOA-on-Master wording) | **Open (docs only)** | Expected; not re-audited line-by-line in this run |
| `appDocCoaUrl(docNo)` cleanup | **Open** | See Section 6 consumers |
| Epic 21 Python render | **Stub** | `TODO Epic 21` log lines in verify output; expected pre-production |

---

## 8. Legacy / dead code

### `tsconfig.json` exclusions (confirmed)

[`AC-QMS-API-Gateway/tsconfig.json`](AC-QMS-API-Gateway/tsconfig.json) excludes:

- `src/modules/spec-templates/**/*`
- `src/modules/marketing/**/*`
- `src/services/workflow-engine-legacy.ts`
- `src/services/aws-skeleton-create.service.ts`
- `src/services/moa-auto-create.service.ts`
- `src/utils/doc-number.ts`
- `src/fixtures/glycine-batch-fixture.ts`
- `scripts/verify-epic12c.ts`, `verify-epic15.ts`, `verify-epic16.ts`

### Active `src/` import grep

| Legacy module | Imported from active (non-excluded) `src/`? |
|---------------|-----------------------------------------------|
| `workflow-engine-legacy` | **No** |
| `spec-templates` (runtime) | **No** — only within excluded `doc-number.ts` / excluded module tree |
| `marketing` | **No** — only within excluded marketing module |
| `moa-auto-create` | **No** |
| `aws-skeleton-create` | **No** |

Active code uses `workflow-engine.ts` (not legacy), `batch-doc-number.ts`, `standing-doc-number.ts`.

**Verdict:** Legacy code remains excluded and not wired into active paths.

---

## 9. Other observations

| Observation | Classification |
|-------------|----------------|
| `verify:p2a` check #13 and `verify:p2b` check #7 fail due to **outdated static assertions**, not production regressions | Harness / cosmetic |
| `verify:p2b` check #13 still expects `document-api` demo-only — **still true** for `document-api.ts`, but AWS/COA are live via dedicated APIs | Harness message partially stale |
| `verify:p2c` harness posts `{ password }` on AWS submit; production `submitAwsDocument` posts `{}` | Code gap (see Section 5) |
| Backend verify scripts emit Epic 21 render TODO logs | Expected stub |
| Frontend `instruments` master page is static demo data; instrument **pickers** in AWS use live API | Intentional partial wiring |
| No `current_doc_phase` column in schema despite ARCHITECTURE narrative | Docs drift (tracked) |

---

## 10. Summary verdict

### Is the system in a consistent, working state end-to-end?

**Mostly yes, with known gaps.** Backend compile, migrations, seed, all nine backend verify scripts, and the self-contained frontend P2-C/P2-D harnesses pass on the as-is database. The core regulated chain **Master → SPEC/MOA → Batch → AWS → COA → RELEASED** is verified at both service layer (backend `verify:session3*`) and HTTP layer (frontend `verify:p2c`, `verify:p2d`). Build artifacts compile cleanly in both repos.

The system is **not fully consistent** for operator UI polish and deferred slices: demo dashboards/notifications/audit/reports remain on localStorage fixtures; CORS is misaligned with the Next.js dev port; and one production code path (`submitAwsDocument`) does not match the backend password contract.

### Genuine problems (excluding tracked/expected deferred scope)

| # | Severity | Type | Issue | Evidence |
|---|----------|------|-------|----------|
| 1 | **Blocker** | Code | AWS Submit from UI sends `{}`; backend requires `{ password }` → 422 | [`aws-api.ts:87`](AC-QMS-Frontend-Next/src/lib/data/aws-api.ts), [`masters.schema.ts:42`](AC-QMS-API-Gateway/src/modules/masters/masters.schema.ts); runtime probe HTTP 422 |
| 2 | **Degraded** | Environment | `CORS_ORIGIN=http://localhost:5173` but Next dev is `:3000` | [`.env`](AC-QMS-API-Gateway/.env) line 7 |
| 3 | **Degraded** | Code | `releasedAt` written on release but not returned in `BatchDetailDto` | [`schema.prisma`](AC-QMS-API-Gateway/prisma/schema.prisma), [`batches.service.ts`](AC-QMS-API-Gateway/src/modules/batches/batches.service.ts) `toBatchDetail` |
| 4 | **Degraded** | Code / harness | `verify:p2a` #13 and `verify:p2b` #7 fail on stale static checks | Scripts not updated after P2-B/C/D; production code behaves correctly per P2-C/D harness |
| 5 | **Cosmetic** | Code | ESLint `react-hooks/exhaustive-deps` on `AwsDataEntryPage.tsx:81` | `next build` output |
| 6 | **Cosmetic** | Code | Demo docNo COA/AWS links in dashboards and route helpers | Section 6 — tracked cleanup |

### What is healthy (no action required for core chain)

- Backend `tsc`, Prisma validate/migrate, seed
- All backend session / phase / P2-C verify scripts
- Frontend `tsc`, `next build`
- Frontend `verify:p2c`, `verify:p2d` (self-contained, full AWS+COA HTTP path)
- Live API modules for product, spec, batch, aws, coa, users
- Legacy modules excluded and unmounted
- Marketing deferred (unmounted, frontend not built)

---

*Report generated by read-only health check. No repository files were modified except this document.*
