# Server Architecture

This document describes the layering conventions for the Aditya Chemicals API server.

## Three layers

```
HTTP (Controller) → Business (Service) → Data (Repository) → Prisma
```

| Layer | Responsibility | May import |
|-------|----------------|------------|
| **Controller** | HTTP parsing, status codes, response shape | Services, schemas, `AuthenticatedRequest` |
| **Service** | Guards, orchestration, transactions, DTO mapping | Repositories, other services, `prisma` **only** for `$transaction` |
| **Repository** | Pure Prisma queries and writes | `Db` / `Tx` from `lib/prisma-types.ts` |

**Dependency rule:** controllers know HTTP; services know rules; repositories know the database. Never pass `req`, `req.body`, or `Response` into a service.

## Session 1 — Rev 2.3 Product Master (admin-owned, EAV)

Session 1 resets the schema to **22 application tables** (Development Bible Rev 2.3) and ships the **identity-only Product Master**:

- `products` — `id`, `name`, `created_at` only
- `product_masters` — revisioned header; `DRAFT | ACTIVE | SUPERSEDED`
- `product_master_fields` — EAV store for variable identity fields (CAS, IUPAC, packing, etc.)

**Ownership:** SADMIN creates directly (`mode: direct` → ACTIVE) or assigns a creator (`mode: assign` → DRAFT). SADMIN approves/rejects/reassigns. **No password** on master actions (Bible 5.1).

**Workflow service:** `master-workflow.service.ts` exposes `getMasterAllowedActions()` — not the generic `workflow-engine` (deferred to Session 2+).

**Routes mounted in Session 1:** `auth`, `products`, `masters`, `notifications` only. Batches, documents, AWS, marketing, and spec-templates are unmounted until later sessions.

**Repository pattern:** `masters.repository.ts` is transaction-aware; supersede-on-activate runs inside `$transaction` with `SUPERSEDE` audit after commit.

## Session 2 — Standing SPEC + MOA (combined approval, US-4-5 revision)

Standing product-level SPEC and paired MOA are authored together by QC Exec, approved in one chain (QC Exec → QC Mgr → QA Mgr), and revised via `POST /specs/:id/revise`. MOA has **no independent routes**.

- `specs` module — CRUD for tests + MOA sections; nested under `/products/:id/specs`
- `workflow-engine.ts` — `STANDING_SPEC` entity; password on approve/sign only
- `render-documents.service.ts` — Epic 21 stub (queued, no Python HTTP)
- `findBatchReadySpec(productId)` — returns current `QA_SIGNED` spec (no-gap during revision)
- Supersede-on-sign — when a revision with `supersedes_id` is QA signed, prior revision + MOA → `SUPERSEDED`

Legacy batch/template workflow lives in `workflow-engine-legacy.ts` (excluded from `tsc`).

## Session 3 — Batch snapshot + AWS/COA chain

Batch creation freezes standing SPEC tests and MOA sections onto the batch (`spec_document_tests`, `moa_document_sections`). Only **AWS + COA** `batch_documents` are created (no per-batch SPEC/MOA).

- `POST /products/:id/batches` — QC Mgr creates batch from `QA_SIGNED` standing SPEC; ARN assigned atomically
- Batch QA workflow — `DRAFT → PENDING_APPROVAL → APPROVED`; **no password** on batch transitions
- **Batch lock** — after `APPROVED`, batch/snapshot mutations return 409; AWS section PATCH allowed
- **AWS opens on batch QA approve** — `aws-open.service.ts` seeds sections from snapshot; AWS doc `PENDING → DRAFT`
- AWS module — limits/formulas from frozen `spec_document_tests`; `readings` JSON; two-person rule; OOS/expiry hard-blocks
- AWS document workflow — submit/approve/sign via `/documents/:id/*`; password on approve/sign
- COA auto-generated on AWS QA sign; `sign-and-issue` releases batch
- `render-documents.service.ts` — stub invoked on AWS sign + COA issue (Epic 21)

**Routes mounted:** `batches`, `documents`, `aws/documents`, `aws/sections`; nested batch create under `/products/:id/batches`.

## Transaction contract

Every repository method accepts an optional client as the last parameter:

```typescript
import type { Db } from "../../lib/prisma-types";
import { prisma } from "../../lib/prisma-types";

export async function findBatchById(id: string, client: Db = prisma) {
  return client.batch.findUnique({ where: { id } });
}
```

- `Db` = `PrismaClient | Prisma.TransactionClient`
- `Tx` = `Prisma.TransactionClient`
- Default `client = prisma` so standalone reads work without a transaction.
- **Services own transactions:** open `prisma.$transaction(async (tx) => { ... })` and pass `tx` to every repository call inside the block.

Example:

```typescript
return prisma.$transaction(async (tx) => {
  const batch = await batchesRepo.createBatch(data, tx);
  await batchesRepo.createBatchDocument({ batchId: batch.id, ... }, tx);
  return batch;
});
```

Audit logs run **after** commit unless explicitly passed `tx` via `audit.service.log(input, client)`.

## Authenticated controllers

Use `AuthenticatedRequest` (from `types/authenticated-request.ts`) on routes behind `requireAuth`. Destructure validated body/query/params and `req.user` / `req.ip` first, then call services with plain typed arguments.

```typescript
export const create = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as CreateBatchBody;
  const result = await createBatchService(body, req.user);
  // ...
});
```

Global `express.d.ts` keeps `user?` optional; authed handlers rely on middleware + `AuthenticatedRequest` instead of `if (!req.user)` guards.

## Canonical module layout

```
modules/<name>/
  <name>.routes.ts
  <name>.controller.ts
  <name>.service.ts
  <name>.repository.ts
  <name>.schema.ts
  <name>.constants.ts   # when needed
```

Shared cross-cutting code lives under `src/services/` (audit, workflow-engine, arn-generator, aws-open).

## Shared services

| Service | Role |
|---------|------|
| `audit.service` | Log-and-continue wrapper over `audit.repository` |
| `workflow-engine` | State transitions; uses module repositories with `tx` |
| `moa-auto-create` | MOA document side-effect on SPEC sign; uses `batches` + `masters` repos |
| `arn-generator` | Raw SQL sequence for ARN; documented exception (see below) |

`batches.repository` exposes **shared batch-document methods** used by workflow-engine, moa-auto-create, and the `documents` module.

## Documented exceptions

Direct Prisma outside `*.repository.ts` is allowed only in:

1. **`config/prisma.ts`** — singleton definition
2. **`lib/prisma-types.ts`** — `Db` / `Tx` aliases and re-export
3. **`services/arn-generator.ts`** — `$queryRaw` sequence (no ORM model)
4. **Services** — `import { prisma }` from `lib/prisma-types` **only** to call `prisma.$transaction`
5. **Everywhere** — `import type` and enum imports from `@prisma/client` in schemas, types, and routes

## Adding a new module

1. Create `*.repository.ts` with all Prisma access; every method ends with `client: Db = prisma`.
2. Create `*.service.ts` with guards, mapping, and `$transaction` orchestration.
3. Create `*.controller.ts` using `AuthenticatedRequest` where authed; pass plain args to services.
4. Add `*.schema.ts` (Zod) and wire `*.routes.ts`.
5. Add `*.constants.ts` if the module has shared literals.
6. Do **not** import `config/prisma` or `PrismaClient` in controllers or services (except `$transaction` in services).

## SPEC document workflow

The `documents` module implements SPEC populate (`POST /batches/:batchId/spec/create`) and generic document lifecycle routes (`POST /documents/:id/*`). Documents-specific Prisma queries live in `documents.repository`; shared batch-document operations reuse `batches.repository`.

MOA/AWS/COA lifecycles extend the same pattern: `resolveWorkflowEntityType` cases and engine handlers; reuse generic `/documents/:id/*` routes.

## MOA document workflow (Epic 11)

MOA is **review-only** in DRAFT — no PATCH/edit endpoint. `GET /documents/:id` returns `sections[]` from `moa_document_sections` (populated on SPEC SIGN from master MOA content).

Lifecycle: assigned QC exec submits → QC manager approves → QA manager signs. On **MOA QA_SIGNED**, the engine `onSigned` hook calls `aws-skeleton-create.service.ts`.

## AWS skeleton side effect (Epic 11)

When MOA is QA signed, the system:

1. Finds the batch's PENDING `AWS` batch document
2. Loads the batch SPEC's resolved `spec_document_tests` (not master tests)
3. Creates empty `aws_sections` (`NOT_STARTED`, data fields null) with `spec_document_test_id` FK for lineage
4. Transitions AWS `PENDING → DRAFT` via `authoringTransition`
5. Sets `batch.currentDocPhase = AWS`
6. Audits (`entityType=AWS`, action GENERATE) and notifies QA managers

**Epic 12 limit source:** OOS evaluation reads limits from `spec_document_tests` (frozen at SPEC populate), joined via `aws_sections.spec_document_test_id`. Limit columns are **not** snapshotted on `aws_sections`.

## AWS section data entry (Epic 12a)

The `aws` module exposes section list/detail, PATCH auto-save, and POST preview endpoints. The **backend is the single source of truth** for calculated results — PATCH bodies never accept `calculatedResult`, `conclusion`, or `resultDisplay`; the server always recomputes via `formula-engine.ts`.

### Formula configuration (`test_parameters.formula_variables`)

```json
{
  "variables": [{ "name": "A_sample", "label": "Sample absorbance", "uom": "AU" }],
  "steps": [{ "name": "ratio", "formula": "A_sample / A_standard" }, { "name": "result", "formula": "ratio * Purity" }]
}
```

- **Input variables:** analyst-entered observation fields.
- **Steps (optional):** evaluated in order; each step `name` becomes a variable for later steps.
- **Single-step fallback:** when `steps` is absent, `calculation_formula` is evaluated directly.
- **Legacy object-map shape** is normalized at runtime for backward compatibility.

### Replicate observations

When `observations.sets` is an array of measurement sets, each input variable is the **arithmetic mean** across sets before formula evaluation. Explicit `observations.variables` override computed means.

### Limit vs formula sources

| Data | Source |
|------|--------|
| Limits, `resultType`, operator | Frozen `spec_document_tests` via `spec_document_test_id` |
| Formula, variable definitions | Live `test_parameters` via `testParameterId` |

Conclusion is derived on recompute: QUANTITATIVE uses BETWEEN/NMT/NLT against frozen limits; QUALITATIVE uses `passFail`. Provisional `oos_detected` is set when conclusion is NOT_SATISFACTORY/FAIL — acknowledgement enforcement is Epic 12b.

**Cross-section formulas (GAP 6 — not implemented):** Assay on dried basis requires `%LOD` from the Loss on Drying section. Current engine is section-scoped only. Proposed design: `docs/designs/formula-cross-section-references.md`.

**Epic 12c:** AWS document approval lifecycle, COA auto-generation, COA sign-and-issue → batch release. See section below.

## AWS compliance guardrails (Epic 12b)

Two-stage section flow per ICH Q7:

| Status | Meaning |
|--------|---------|
| `NOT_STARTED` / `IN_PROGRESS` | Analyst data entry (assigned QC exec) |
| `AWAITING_CHECK` | Analyst completed; locked from analyst PATCH |
| `COMPLETED` | Checker verified (different QC exec) |

**Hard blocks on analyst `/complete`:** conclusion required; `oos_detected` requires `oos_acknowledged`; expired instrument/reagent requires acknowledgement with comment.

**Two-person rule:** checker must be QC_EXEC in QC dept and **not** the analyst (`SAME_AS_ANALYST` if violated).

**OOS ack reset:** any PATCH that changes `observations` clears `oos_acknowledged` so stale acks cannot carry.

**Expiry ack reset:** changing `instrumentId` or `reagentsUsed` clears instrument/reagent expired acknowledgements.

**Readiness (for 12c):** `GET /aws/:awsDocId/sections` returns `{ sections, allSectionsComplete, sectionStatusSummary }` where `allSectionsComplete` is true when every section is `COMPLETED`.

## AWS document lifecycle + COA (Epic 12c)

### AWS approval (generic `/documents/:id/*` routes)

| Transition | Actor | Guard |
|------------|-------|-------|
| DRAFT → SUBMITTED | Assigned QC exec | Password; **all AWS sections COMPLETED** (`409 AWS_SECTIONS_INCOMPLETE`) |
| SUBMITTED → QC_APPROVED | QC_MGR | Approver ≠ submitter; password |
| SUBMITTED → DRAFT | QC_MGR reject | Comment; password |
| QC_APPROVED → QA_SIGNED | QA_MGR | Signer ≠ QC approver; password; **side effect: COA auto-generation** |
| QC_APPROVED → DRAFT | QA_MGR reject | Comment; password |

**Reject after sections complete:** AWS reject returns document to `DRAFT` but **does not reset section status** — sections remain `COMPLETED`; analyst re-submits when ready.

### COA auto-generation (on AWS QA_SIGNED)

Inside the same workflow transaction, `generateCoaFromSignedAws`:

1. Finds batch PENDING COA document (existing `doc_no` retained).
2. Reads completed AWS sections ordered by `sort_order`.
3. Inserts `coa_results` rows (test name, formatted result, acceptance limits, conclusion).
4. Sets `compliance_verdict` on COA document: `COMPLIES` if every section is SATISFACTORY/PASS, else `DOES_NOT_COMPLY`.
5. Copies AWS signature lineage onto COA: `created_by` ← AWS submitter, `qc_approved_by`, `qa_signed_by`.
6. Transitions COA `PENDING → AUTO_GENERATED`; sets `batch.current_doc_phase = COA`.
7. System audit `GENERATE`; notifies QA managers.
8. Calls `generateCoaPdf()` stub (no PDF until Epic 21).

**Epic 21 display backlog** (PDF wording/layout from Glycine audit — no core logic changes): see `docs/epics/epic-21-pdf-display.md` (COA verdict phrase, BETWEEN limit phrasing `to` vs `Between`, AWS header fields, Balance ID layout, MOA procedure on AWS pages).

### COA sign-and-issue (terminal)

`POST /documents/:id/sign-and-issue` — QA_MGR only, password required.

- Guard: COA status must be `AUTO_GENERATED` (`409 COA_NOT_SIGNABLE` otherwise).
- Effect: COA → `ISSUED`; batch → `RELEASED` with `released_at`; `current_doc_phase = RELEASED`.
- Audit: `SIGN_ISSUE` on COA + batch status update.
- **No self-approval guard** vs AWS signer (distinct issuance act).
- **COA issuer not stored on `qa_signed_by`** — that field holds AWS QA lineage copied at generation; terminal issuance is captured in `SIGN_ISSUE` audit.

COA has **no** generic SUBMIT/APPROVE/SIGN workflow — only auto-generation + sign-and-issue.

### COA read

`GET /documents/:id` for COA returns `coaResults[]`, `complianceVerdict`, signature lineage fields, and `allowedActions: ["SIGN_AND_ISSUE"]` when `AUTO_GENERATED` and actor is QA_MGR.

## In-app notifications (Epic 16)

Phase 1 delivers a persisted in-app feed (`notifications` table). Email/SMS/push are out of scope.

### Dispatch (`notification.service.ts`)

```typescript
notify({
  recipients: RecipientSpec,  // resolved via notifications.repository
  type, title, message, link?,
  excludeUserId?,              // actor exclusion
  tx?,                         // participates in caller transaction when provided
})
```

**Recipient resolution** (`resolveRecipients`): only `ACTIVE`, non-deleted users; optional `departmentId` scopes role-based targets; de-duplicated.

**Semantics:**
- Inserts one row per recipient when `notify()` runs.
- When `tx` is passed, rows commit/rollback with the business transaction (workflow transitions call `notify` inside `runTransition`).
- Failures are logged and **never rethrown** — a notification error must not block signatures (best-effort).

**Deep links:** `/qc/batches/{id}`, `/qc/batches/{batchId}/documents/{docId}`, `/qc/masters/{id}`, `/qc/spec-templates/{id}`.

### Read API (`/api/v1/notifications`)

| Method | Path | Scope |
|--------|------|-------|
| GET | `/` | Caller only; `?unreadOnly=true`, paginated, newest first |
| GET | `/unread-count` | Badge count for caller |
| PATCH | `/:id/read` | 404 if not caller's row |
| POST | `/mark-all-read` | Returns `{ count }` |

Workflow call sites (submit/approve/sign/reject, MOA/AWS auto-create, COA generated, batch assigned, batch released) use role+department recipient specs with `excludeUserId` on the actor.

## Marketing read-only portal (Epic 15)

Module: `src/modules/marketing/` — **read-only** surface for `MKT_EXEC` (Diya Sharma).

### Access scoping (repository-enforced)

Every marketing query applies:

- `batch.status = RELEASED`
- Documents: `(docType != COA) OR (docType = COA AND status = ISSUED)`

Unreleased or in-flight documents return **404** (not 403) when accessed by id.

### Routes (`/api/v1/marketing/*`)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/documents` | Paginated list; filters `product`, `customer`, `type`, `search` |
| GET | `/coas/:id` | Issued COA + `coaResults`, verdict, signature lineage |
| GET | `/coas/:id/download` | **501** — Epic 21 PDF pending |
| GET | `/batches/:id` | RELEASED batch summary + visible documents |
| PATCH | `/cc-notifications/:id/ack` | **501** — Epic 27 Change Control stub |

All routes: `requireAuth` + `requireRole(Role.MKT_EXEC)`.

### Seed demo data

After seed, `B-2026-001` is driven to `RELEASED` with issued COA (`advanceGlycineBatchToReleased` in `src/fixtures/glycine-batch-fixture.ts`). Verify scripts for Epics 12c/16 reset to AWS DRAFT via `ensureGlycineBatchAtAwsDraftForVerification` before running.
