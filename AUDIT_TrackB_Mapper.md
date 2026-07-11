# Track B / B-2 Phase A — Render-Mapper Assessment (Read-Only)

**Date:** 2026-07-11  
**Scope:** AC-QMS-API-Gateway only — assess what B-2 must build to map Prisma data → locked DOC-Module render contracts (`AwsRenderInput`, `CoaRenderInput`).  
**Constraint:** Read-only audit. No code or schema changes in this phase.

**Governing contracts (DOC-Module, implemented B-1a/B-1b):**

| Contract | File |
|----------|------|
| Shared types | `AC-QMS-DOC-Module/app/schemas/render_common.py` |
| AWS payload | `AC-QMS-DOC-Module/app/schemas/aws_render.py` |
| COA payload | `AC-QMS-DOC-Module/app/schemas/coa_render.py` |
| POST endpoint | `AC-QMS-DOC-Module/app/api/routes/documents.py` — discriminated `POST /render` |

**Render-ready principle:** Backend sends fully-resolved display strings. The Python renderer validates and lays out DOCX only — no derivation of limits, results, conclusions, compliance, readings, or procedure text.

**Current Gateway state:**

| Artifact | Status | Evidence |
|----------|--------|----------|
| `renderDocuments` | Stub (audit log only) | `src/services/render-documents.service.ts:15–45` |
| `mapToSopConfig` | **Does not exist** | 0 matches in `AC-QMS-API-Gateway/` |
| COA row generation | **Exists** | `src/services/coa-generator.ts:94–172` |
| DOC HTTP client | **Not wired** | Stub returns `{ status: "queued" }` |

---

## 1. The batch-field question (decision gate)

`AwsRenderInput` and `CoaRenderInput` both embed `BatchIdentity` from `render_common.py:37–47`:

```python
class BatchIdentity(BaseModel):
    batch_no: str
    arn_no: str | None = None
    mfg_date: str | None = None
    exp_date: str | None = None
    batch_size: str | None = None
    quantity_sampled: str | None = None
    test_request_no: str | None = None
    received_date: str | None = None
    testing_date: str | None = None
    completion_date: str | None = None
```

### 1.1 Prisma `Batch` model

Source: `prisma/schema.prisma:359–385` (`@@map("batches")`).

| `BatchIdentity` field | Prisma field | DB column | Status |
|----------------------|--------------|-----------|--------|
| `batch_no` | `batchNo` | `batch_no` | **EXISTS** (`String @unique`) |
| `arn_no` | `arnNo` | `arn_no` | **EXISTS** (`String?`) |
| `mfg_date` | `mfgDate` | `mfg_date` | **EXISTS** (`DateTime? @db.Date`) |
| `exp_date` | `expDate` | `exp_date` | **EXISTS** (`DateTime? @db.Date`) |
| `batch_size` | `batchSize` | `batch_size` | **EXISTS** (`String?`) |
| `quantity_sampled` | — | — | **ABSENT** |
| `test_request_no` | — | — | **ABSENT** |
| `received_date` | — | — | **ABSENT** |
| `testing_date` | — | — | **ABSENT** |
| `completion_date` | — | — | **ABSENT** |

Confirmed in initial migration `prisma/migrations/20260704120000_rev2_3_reset/migration.sql` — `batches` table has only the five identity columns above plus workflow FKs (`product_id`, `source_spec_id`, `assigned_qc_exec_id`, `status`, `created_by`, `approved_by`, `released_at`).

No related table stores the five absent fields (grep across `prisma/schema.prisma` and migrations returns no matches for `quantity_sampled`, `test_request`, `received_date`, `testing_date`, `completion_date` on batch entities).

### 1.2 What the real AWS document shows

**Layout slots (all 10 fields have render rows):**

`AC-QMS-DOC-Module/app/document_engine/components/aws_layout.py` `_build_batch_info_table` (lines 186–224) mirrors `protocol_layout.py:235–256`:

| Row | Left label | Value key | Right label | Value key |
|-----|------------|-----------|---------------|-----------|
| 0 | Mfg. Date | `batch.mfg_date` | Exp. Date | `batch.exp_date` |
| 1 | Test Request Sheet No. | `batch.test_request_no` | A.R. No. | `batch.ar_no` |
| 2 | Batch Size | `batch.batch_size` | Quantity Sampled | `batch.quantity_sampled` |
| 3 | Received Date | `batch.received_date` | Testing Date | `batch.testing_date` |
| 5 | Completion Date | `batch.completion_date` | — | — |

Repeating header also shows `batch.batch_no` under **"Batch No."** (`aws_layout.py:107–108`).

Optional fields render as `""` when absent — no error (`str(batch.get("test_request_no", ""))` pattern at line 191).

**Real filled AWS reference (`GLYCINE IP.docx` in `AC-QMS-DOC-Module/tests/reference/`):**

`AC-QMS-API-Gateway/docs/epics/epic-21-pdf-display.md` GAP 5c (lines 70–85):

| Field | Real example on sample | AC-QMS today |
|-------|------------------------|--------------|
| Test Request Sheet No. | **(blank)** | Not stored |
| A.R. No. | ties to ARN `2026 GCN 09` | `batches.arn_no` |
| Batch size | `3000 Kgs` | `batches.batch_size` (if populated) |
| Quantity sampled | **(blank)** | Not stored |
| Received date | **(blank)** | Not stored |
| Testing date | **(blank)** | Not stored |
| Completion date | **(blank)** | Not stored |

Ground-truth batch `GCN/010226` in `AC-QMS-API-Gateway/docs/glycine_ip_groundtruth_reference.doc` confirms batch no + ARN; does not enumerate TRS or sampling dates.

Golden AWS fixture `AC-QMS-DOC-Module/tests/fixtures/glycine_aws_gcn010226.json` omits `test_request_no` and `quantity_sampled` intentionally while populating mfg/exp/batch_size/received/testing/completion for layout exercise — the five absent Prisma fields are not required for Glycine fidelity.

### 1.3 Three-way verdict per field

| Field | Verdict | Evidence |
|-------|---------|----------|
| `batch_no` | **(a) exists → map** | `batches.batch_no`; shown in header |
| `arn_no` | **(a) exists → map** | `batches.arn_no`; shown as A.R. No. (mapper may format display per client questionnaire Q1e — not a migration) |
| `mfg_date` | **(a) exists → map** | `batches.mfg_date`; shown on real doc |
| `exp_date` | **(a) exists → map** | `batches.exp_date`; shown on real doc |
| `batch_size` | **(a) exists → map** | `batches.batch_size`; `3000 Kgs` on real sample |
| `quantity_sampled` | **(c) absent + real doc blank → omit; no migration** | Epic 21 line 79; blank on sample |
| `test_request_no` | **(c) absent + real doc blank → omit; no migration** | Epic 21 line 76; blank on sample |
| `received_date` | **(c) absent + real doc blank → omit; no migration** | Epic 21 line 80; blank on sample |
| `testing_date` | **(c) absent + real doc blank → omit; no migration** | Epic 21 line 81; blank on sample |
| `completion_date` | **(c) absent + real doc blank → omit; no migration** | Epic 21 line 82; blank on sample |

**No field received verdict (b)** — absent fields that the real AWS shows populated would require migration; none were found on the Glycine reference.

### 1.4 Migration decision

**No `batches` schema migration required for B-2 render fidelity** against the current Glycine AWS/COA reference set.

Mapper responsibilities for existing fields:

- Read `mfgDate` / `expDate` as `Date` and format to display strings (e.g. `"01 FEB 2026"`) before payload — renderer does not format dates.
- Pass `arn_no` as-is or apply client numbering display rules in mapper only.
- Omit the five absent keys from payload (or send `null`) — layout renders empty cells.

Optional in-system capture of TRS / sampling / date fields is deferred to Epic 21 / client questionnaire (`epic-21-pdf-display.md:85`).

---

## 2. Verifier hygiene — fixture-only confirmation

Three legacy scripts in `package.json:15–17` fail with `"No Batch found"` / `"diya.sharma not found"`. Assessment: **fixture/harness staleness, not production regressions.**

Superseding verifiers (all PASS per `docs/audits/HEALTH_CHECK.md:68–73`):

- `verify:session3`
- `verify:session3-phase-b`
- `verify:session3-phase-c`
- `verify:p2c`

### 2.1 `verify:12c` (`scripts/verify-epic12c.ts`)

**What it tests:** Full HTTP chain — AWS section completion, submit/approve/sign, COA auto-generation, sign-and-issue, batch release, immutability guards.

**Why it fails:**

| Issue | Evidence |
|-------|----------|
| Stale Prisma imports | Lines 5–12: `DocPhase`, `BatchStatus.ACTIVE` — not in Rev 2.3 schema |
| Stale fixture | Line 14: `ensureGlycineBatchAtAwsDraftForVerification` from `src/fixtures/glycine-batch-fixture.ts` — **excluded** from `tsconfig.json:22` |
| Wrong HTTP routes | Lines 67, 76: `/aws/${awsDocId}/sections` — live routes are `/aws/documents/:awsDocId/sections` (`src/routes/index.ts:22`) and `/aws/sections/:id` (`src/routes/index.ts:23`) |
| Request body drift | Lines 77+: `observations` — API expects `readings` (`src/modules/aws/aws.schema.ts:26`) |
| Schema field drift | `observations`, `oosDetected`, `testParameterId`, `optionalTestsActivated`, `SectionStatus.COMPLETED` — current schema uses `readings`, `isOos`, `SectionStatus.COMPLETE` |
| No seed batch | Expects `batchNo: "B-2026-001"` — not created in `prisma/seed.ts` |

**Fixture needed to pass (if revived):** Self-contained Glycine batch at AWS DRAFT with complete sections (pattern: `verify-session3-phase-c` `createCoaReadyFixture`); dev server on `:4000`; script rewritten for Rev 2.3 routes/schema.

**Real regression?** **No.** Same business logic verified by `verify:session3-phase-b` (AWS sign + `renderDocuments` in tx) and `verify:session3-phase-c` (COA auto-gen, sign-and-issue, `released_at`).

### 2.2 `verify:15` (`scripts/verify-epic15.ts`)

**What it tests:** Marketing read API — released document list, COA detail, batch detail, CC ack, PDF download, role guards.

**Why it fails:**

| Issue | Evidence |
|-------|----------|
| User not seeded | Line 60: `diya.sharma` — `prisma/seed.ts:27–33` seeds only `rajesh.kumar`, `kavya.patel`, `meera.iyer`, `priya.mehta`, `anand.joshi`, `sanjay.reddy` — **no MKT_EXEC user** |
| Batch not seeded | Line 14: `B-2026-001` — not in seed |
| Routes unmounted | `src/routes/index.ts:14–28` — no `router.use("/marketing", …)` |
| Module excluded | `tsconfig.json:17` excludes `src/modules/marketing/**/*` |
| Stale Prisma in script | Lines 102–128: `specTemplate`, `productMasterId`, `arn`, `mfgDateMonth`, `currentDocPhase`, `BatchStatus.ACTIVE` |

**Fixture needed:** `diya.sharma` (MKT_EXEC), released batch `B-2026-001` with issued COA, mount marketing routes, rewrite script for Rev 2.3 schema.

**Real regression?** **No.** Marketing module is intentionally deferred/unmounted; core batch/COA workflow passes session3 verifiers.

### 2.3 `verify:16` (`scripts/verify-epic16.ts`)

**What it tests:** Notification HTTP regression across AWS submit → reject → approve → sign → COA issue → release.

**Why it fails:**

| Issue | Evidence |
|-------|----------|
| Stale fixture | Line 96: same `glycine-batch-fixture.ts` (excluded) |
| Missing batch | Line 118: `batchNo: "B-2026-001"` |
| Missing user | Lines 102, 107: `diya.sharma` for `BATCH_RELEASED` notification |
| Wrong routes / body | Same as verify:12c |

**Fixture needed:** Same as 12c plus `diya.sharma` in seed for MKT_EXEC release notification check.

**Real regression?** **No.** Notification service logic tested in `verify:session3*` at service layer.

### 2.4 Hygiene conclusion

Safe to proceed with B-2 mapper implementation. The three failing verifiers are **legacy HTTP harnesses** excluded from `tsc` and documented as not run in `docs/audits/HEALTH_CHECK.md:75`. They do not indicate broken COA generation, AWS workflow, or notification code paths.

---

## 3. Mapper data-join surface — AWS

**Target contract:** `AwsRenderInput` + `AwsSectionRender` (`aws_render.py`).

**Proposed entry point:** `mapToAwsRenderInput(awsDocId: string, client?: Db)` — does not exist today.

### 3.1 Document-level joins

| `AwsRenderInput` field | Prisma / join source | Mapper action |
|------------------------|----------------------|---------------|
| `document_no` | `batch_documents.doc_no` where `doc_type = AWS` | Read stored value (`batches.repository.ts:374`) |
| `document_no_label` | Constant default `"AWS NO."` | Pass default or product override (Epic 19) |
| `document_type_label` | Constant `"FINISHED PRODUCT ANALYSIS PROTOCOL"` | Pass default |
| `revision_no` | Standing spec `revision_no` or `"01"` (INFERRED) | TBD — batch docs have no revision column on `batch_documents` |
| `effective_date`, `review_date` | `specs.effective_date`, standing review policy | Join `batches.source_spec_id` → `specs` |
| `superseded_revision` | Standing lineage | Optional |
| `company_name`, `department` | Constants / config | Defaults per contract |
| `product` | `batches.product_id` → `products` + EAV (`product_master_fields`) | Map to `ProductIdentity` |
| `batch` | `batches` row | Map 5 existing fields per §1; omit 5 absent |
| `sections[]` | `aws_sections` for `batch_document_id` | See §3.2 |
| `summary_rows` | Optional | Omit — layout projects from `sections` (`aws_layout.py:228–241`) |
| `compliance_note` | Static or derived phrase | Default protocol note string |
| `approval` | `batch_documents.created_by`, `qc_approved_by`, `qa_signed_by` | Join `users` → `DocumentApproval` |
| `revision_history` | Not on batch docs today | Empty list |
| `logo_path` | Config / static | Optional |

### 3.2 Per-section joins (`AwsSectionRender`)

Base query pattern: extend `awsSectionInclude` (`src/modules/aws/aws.repository.ts:4–40`) — already loads `specDocumentTest`, `instrument`, `reagent`, `analyst`, `checker`, `batchDocument`.

Additional join for `procedure_text`: `moa_document_sections` on `(batch_id, spec_document_test_id)` — snapshot stored at batch create (`batches.repository.ts:356–366`, column `procedure_snapshot`).

| Field | Prisma source | Backend today | Mapper must build |
|-------|---------------|---------------|-------------------|
| `sort_order` | `spec_document_tests.sort_order` | `aws.mapper.ts:79` | Project |
| `section_no` | **No column** | Not stored | **New:** `String(sortOrder)` (INFERRED — matches golden fixture `"1"`, `"2"`, …) |
| `test_name` | `spec_document_tests.test_name` | DTO | Pass through |
| `limits_display` | `spec_document_tests` snapshot (`operator`, `min_value`, `max_value`, `uom`, `acceptance_criteria`, `result_type`) | Raw limits in `toResolvedLimits` (`aws.mapper.ts:27–37`) | **New:** `formatAcceptanceLimits(specDocumentTest)` (`coa-generator.ts:28–47`) |
| `procedure_text` | `moa_document_sections.procedure_snapshot` | Stored at batch create | **New:** join by `specDocumentTestId` + `batchId` |
| `readings_display` | `aws_sections.readings` JSON | Raw JSON in API (`aws.mapper.ts:84`) | **New:** human-readable string from qualitative `text` or quantitative variable summary |
| `calculated_result` | `aws_sections.calculated_result` | `toString()` in mapper (`aws.mapper.ts:85`) | Pass formatted decimal string |
| `result_display` | `aws_sections.result_display` | Backend-computed at data entry | Pass through |
| `conclusion_display` | `aws_sections.conclusion` enum | Enum in DTO | **New:** `formatConclusionLabel()` → `"Satisfactory"` / `"Not Satisfactory"` (`coa-generator.ts:49–61`) |
| `is_oos` | `aws_sections.is_oos` | DTO | Pass through |
| `oos_acknowledged` | `aws_sections.oos_acknowledged` | DTO | Pass through |
| `oos_ack_comment` | `aws_sections.oos_ack_comment` | DTO | Pass through |
| `instrument_display` | `instruments` FK (`instrument_id`, `name`, `calibration_date`, `use_before`) | Expiry flags only (`aws.mapper.ts:49–51`) | **New:** display string per Epic 21 GAP 5b (e.g. `"pH Meter MET-PH-04 (Cal. due 15 JAN 2027)"`) |
| `reagent_display` | `reagents` FK (`name`, `lot_no`, `expiry_date`) | Partial | **New:** joined display string |
| `instrument_expired_ack` | `readings.instrumentExpiredAck` | `expiryAckFields()` (`aws.mapper.ts:54–66`) | Map to contract field name |
| `reagent_expired_ack` | `readings.reagentExpiredAck` | Same | Map |
| `expiry_ack_comment` | `readings.instrumentExpiredAckComment` or `reagentExpiredAckComment` | Parsed in mapper | Merge to single `expiry_ack_comment` per section |
| `analyst` | `analyst_id` → `users.full_name` | Name only (`aws.mapper.ts:100–102`) | **New:** `PersonSignature` + designation + date |
| `checker` | `checker_id` → `users.full_name` | Name only (`aws.mapper.ts:104–106`) | **New:** `PersonSignature` + designation + date |

### 3.3 AWS mapper effort summary

**Already backend-owned:** `result_display`, OOS flags, raw readings JSON, analyst/checker IDs, instrument/reagent FKs.

**Mapper must build (net-new formatting):** `limits_display`, `procedure_text` join, `readings_display`, `conclusion_display`, `instrument_display`, `reagent_display`, expiry ack projection, `section_no`, per-section and document-level `PersonSignature`, date formatting, product/batch identity envelope.

---

## 4. Mapper data-join surface — COA

**Target contract:** `CoaRenderInput` + `CoaResultRow` (`coa_render.py`).

**Proposed entry point:** `mapToCoaRenderInput(coaDocId: string, client?: Db)` — does not exist today.

| `CoaRenderInput` field | Prisma source | Reusable today |
|------------------------|---------------|----------------|
| `document_no` | `batch_documents.doc_no` where `doc_type = COA` | Stored at batch create: `COA/{productCode}/{batchNo}` (`batch-doc-number.ts:7–8`, `batches.repository.ts:380–383`); verified in `verify-session3-phase-c` check 12 |
| `document_no_label` | Default `"COA NO."` | Constant |
| `document_type_label` | Default `"ANALYTICAL REPORT"` | Constant |
| `revision_no` | Standing spec or `"01"` | INFERRED |
| `effective_date`, `review_date` | `specs.effective_date` via batch lineage | Join |
| `company_name` | Constant | Default |
| `product` | `batches.product_id` + EAV | Existing queries |
| `batch` | `batches` | §1 mapping (5 fields) |
| `coa_results[]` | `coa_results` table | **Already populated** by `generateCoaFromSignedAws` (`coa-generator.ts:117–127`) |
| `compliance_verdict` | `batch_documents.compliance_verdict` | Set at auto-gen (`coa-generator.ts:133–134`) |
| `compliance_remark` | **Not stored** | **New:** `formatComplianceRemark(verdict)` per `epic-21-pdf-display.md:23–27` |
| `approval` | `batch_documents.created_by_id`, `qc_approved_by_id`, `qa_signed_by_id` | **New:** join `users` → three `PersonSignature` blocks |

**COA semantics** (per `render_common.py:15–26` docstring):

- `prepared_by` ← AWS document creator (`created_by` on COA doc, set from signed AWS at auto-gen line 139)
- `checked_by` ← AWS QC approver (`qc_approved_by_id`, line 140)
- `approved_by` ← QA_MGR at COA sign-and-issue (`qa_signed_by_id`, set on `SIGN_ISSUE`)

**COA mapper is ~60% done** — `coa_results` rows already match `CoaResultRow` shape (`test_name`, `result`, `acceptance_limits`, `conclusion`, `sort_order`). Remaining work: envelope fields, `compliance_remark`, `approval` PersonSignatures, date formatting.

---

## 5. Existing formatters — reuse inventory

Source: `src/services/coa-generator.ts`.

| Formatter | Lines | Exported? | COA mapper | AWS mapper | Notes |
|-----------|-------|-----------|------------|------------|-------|
| `formatAcceptanceLimits` | 28–47 | **Yes** | Via stored `coa_results.acceptance_limits` | **Reuse** for `limits_display` | Phrasing gap: code `Between 5.9 and 6.3` vs client `5.9 to 6.3` (Epic 21 GAP 3) |
| `formatConclusionLabel` | 49–61 | No | Via stored `coa_results.conclusion` | **Reuse** for `conclusion_display` | AWS uses Satisfactory wording; COA rows may later use "Complies" per Epic 21 |
| `formatSectionResult` | 64–77 | No | Via stored `coa_results.result` | **Reuse pattern** for result/readings | Export to shared module |
| `computeComplianceVerdict` | 79–86 | No | Applied at auto-gen | **COA-only** | AWS has no document-level verdict enum |
| `formatComplianceRemark` | — | **Does not exist** | **New** | N/A | Suggested in `epic-21-pdf-display.md:23–27` |

### 5.1 Net-new formatters for B-2

| Formatter | Used by | Purpose |
|-----------|---------|---------|
| `formatReadingsDisplay` | AWS | JSON → display string (qualitative text, quantitative variable summary) |
| `formatInstrumentDisplay` | AWS | Instrument master → single line (Epic 21 GAP 5b) |
| `formatReagentDisplay` | AWS | Reagent master → single line |
| `formatDisplayDate` | AWS + COA | `Date` → `"01 FEB 2026"` |
| `roleToDesignation` | AWS + COA | `Role` enum → `"QC Executive"` etc. (INFERRED — no `designation` column on `users`) |
| `mapPersonSignature` | AWS + COA | `User` + role + timestamp → `PersonSignature` |
| `projectSectionNo` | AWS | `sortOrder` → `section_no` string |

### 5.2 Refactor recommendation

Extract shared formatters from `coa-generator.ts` into `src/services/render-formatters.ts` (or `src/services/document-render-mapper/`) so AWS mapper does not import from a COA-named module. Keep `generateCoaFromSignedAws` calling the same functions to avoid drift.

---

## 6. `renderDocuments` stub + STANDING_SPEC fan-out

### 6.1 Current stub

`src/services/render-documents.service.ts:15–45`:

```typescript
export async function renderDocuments(
  docType: RenderDocType,  // "STANDING_SPEC" | "AWS" | "COA"
  entityId: string,
  meta?: { userId?: string; docNo?: string },
  client?: Db,
): Promise<RenderDocumentsResult>
```

Behavior: logs TODO, writes `AuditAction.GENERATE` audit, returns `{ status: "queued" }`. **No HTTP call** to DOC-Module.

### 6.2 Call sites (production)

| Event | File:line | `docType` | `entityId` | `meta` |
|-------|-----------|-----------|------------|--------|
| Standing SPEC QA sign | `workflow-engine.ts:419–427` | `STANDING_SPEC` | `spec.id` | `{ userId, docNo: entity.specNo }` |
| AWS QA sign (`SIGN` → `QA_SIGNED`) | `workflow-engine.ts:828–836` | `AWS` | `batchDocument.id` | `{ userId, docNo: entity.docNo }` |
| COA sign-and-issue | `documents.service.ts:124–127` | `COA` | `batchDocument.id` | `{ userId, docNo: doc.docNo }` |

AWS sign call is **in the same transaction** as `generateCoaFromSignedAws` (`workflow-engine.ts:837`). Phase B verifier confirms `renderDocuments(AWS)` receives live `tx` (`verify-session3-phase-b.ts:633`).

### 6.3 STANDING_SPEC fan-out

Standing SPEC sign must produce **two** rendered documents:

1. **Specification** — `POST /generate` with `document_type: "specification"` and `ProductConfig`
2. **MOA** — `POST /generate` with `document_type: "moa"` and same product config

Uses DOC-Module `POST /generate` + `ProductConfig` — **not** `POST /render` / `AwsRenderInput`. MOA auto-create already runs on SPEC sign (`moa-auto-create.service.ts`); render fan-out is separate.

Current stub passes a single `STANDING_SPEC` audit — B-2 must replace with two HTTP calls (or one queue job with two children).

### 6.4 B-2 stub replacement shape

| `docType` | DOC endpoint | Payload type |
|-----------|--------------|--------------|
| `STANDING_SPEC` | `POST /generate` × 2 (spec + moa) | `ProductConfig` + context kwargs |
| `AWS` | `POST /render` | `{ document_type: "aws", payload: AwsRenderInput }` |
| `COA` | `POST /render` | `{ document_type: "coa", payload: CoaRenderInput }` |

`mapToSopConfig` (referenced in `AC-QMS-DOC-Module/AUDIT_TrackB_AWSCOA.md:454`) should be split into explicit functions — no unified name exists in Gateway today.

---

## 7. Document numbering for render

Payload field `document_no` must be explicit. **Mapper should read stored `batch_documents.doc_no`, not recompute** (Epic 19 per-product formats not implemented).

| Document | Storage | Formatter at create | Example (Glycine GCN/010226) |
|----------|---------|---------------------|------------------------------|
| AWS | `batch_documents.doc_no` | `formatBatchAwsDocNo(batchNo)` → `AWS/{batchNo}` (`batch-doc-number.ts:2–3`, `batches.repository.ts:374`) | `AWS/GCN/010226` |
| COA | `batch_documents.doc_no` | `formatBatchCoaDocNo({ productCode, batchNo })` → `COA/{productCode}/{batchNo}` (`batch-doc-number.ts:7–8`, `batches.repository.ts:380–383`) | `COA/FG00038/GCN/010226` |
| Standing SPEC | `specs.spec_no` | Authored at SPEC create (`specs.service.ts:225, 399`) | `SPEC/FG00038/01` |
| Standing MOA | `moa_docs.moa_no` | Auto-created on SPEC sign (`moa-auto-create.service.ts:71`) | `MOA/FG00038/01` |

### 7.1 Known numbering seam (Epic 19)

Ground-truth AWS uses `AWS/GCN/01` (glycine fixture `glycine_aws_gcn010226.json`, ground-truth doc) while code produces `AWS/GCN/010226` (`AWS/{batchNo}`). FG vs GCN dual-code is tracked in glycine downstream audit — **display concern for mapper/render, not renderer logic**. Until Epic 19 (`Epics_Rev2_3_1.md` Epic 19) implements per-product numbering config, pass `batch_documents.doc_no` as authoritative system number.

### 7.2 Dead duplicate formatters

`src/utils/doc-number.ts:40–45` defines `formatBatchAwsDocNo` / `formatBatchCoaDocNo` with `productCode` in AWS path — **excluded** from `tsconfig.json:21` and **not imported** by `batches.repository.ts` (imports `batch-doc-number.ts` only).

---

## 8. PersonSignature — what the backend can supply

Contract (`render_common.py:8–12`):

```python
class PersonSignature(BaseModel):
    name: str | None = None
    designation: str | None = None
    signature: str | None = None
    date: date | str | None = None
```

### 8.1 User model capabilities

`prisma/schema.prisma:138–153` — `User` has `fullName`, `role`, `departmentId`. **No** `designation` column, **no** signature image field, **no** `FileAttachment` relation on users.

### 8.2 Field supply matrix

| Field | Supplyable? | Source |
|-------|-------------|--------|
| `name` | **Yes** | `users.full_name` |
| `designation` | **INFERRED** | Map `Role` enum → display label (e.g. `QC_EXEC` → `"QC Executive"`) — not stored per user |
| `date` | **Partial** | Workflow timestamps on `batch_documents` or section-level dates — per-stage mapping TBD in B-2 |
| `signature` | **No** | No image storage in schema |

### 8.3 Fidelity flag (signature images)

Client scanned AWS/COA documents show **handwritten signature marks** in PREPARED BY / CHECKED BY / APPROVED BY blocks and per-section analyst/checker lines. AC-QMS stores approvals as **user ID FKs + audit trail timestamps**, not signature images.

Rendered documents will show **typed names and dates only** (no signature marks). This is consistent with an e-signature QMS where the audit log is the signature evidence. If client later mandates visual signature embedding, that requires new storage + Epic 21 PDF work — **flag now, decide later**.

DOC contract `signature` field remains `null` / omitted in B-2 unless a future asset store is added.

---

## 9. Build-size verdict + recommended B-2 slicing

| Area | Verdict | Effort drivers |
|------|---------|----------------|
| **COA mapper** | **Small** | `coa_results` + `compliance_verdict` exist; add envelope, `compliance_remark`, `approval` PersonSignatures |
| **AWS mapper** | **Substantial** | Per-section joins (MOA snapshot, instrument/reagent display, readings formatting, section signatures) |
| **Formatter extraction** | **Medium** | Shared module + Epic 21 phrasing fixes |
| **renderDocuments HTTP** | **Medium** | Wire stub to DOC-Module; handle response persistence |
| **STANDING_SPEC fan-out** | **Separate track** | `ProductConfig` path, not batch render contracts |

### 9.1 Recommended slice order

| Slice | Deliverable | Rationale |
|-------|-------------|-----------|
| **B-2.1** | `render-formatters.ts` + refactor `coa-generator.ts` | Unblocks both mappers; centralizes Epic 21 phrasing |
| **B-2.2** | `mapToCoaRenderInput` + wire `renderDocuments("COA")` HTTP | Smallest E2E proof; reuses existing `coa_results` |
| **B-2.3** | `mapToAwsRenderInput` + wire `renderDocuments("AWS")` HTTP | Larger join surface; depends on formatters from B-2.1 |
| **B-2.4** | `STANDING_SPEC` → dual `POST /generate` | Defer until batch render path proven |
| **B-2.5** | Persist DOCX/PDF via `file_attachments` | Epic 21; after HTTP render works |

**Relative sizing (INFERRED):** AWS mapper ≈ **1.5–2×** COA mapper LOC. COA path reuses ~60% of generator output as-is.

### 9.2 Risk items (not LOC)

- Instrument multi-line display (Epic 21 GAP 5b) — backend must pre-join into `instrument_display`
- Assay cross-section formula — `result_display` must arrive pre-computed from backend (no renderer math)
- `formatAcceptanceLimits` phrasing vs client docs — fix before golden render compare
- AWS `doc_no` format vs ground-truth `AWS/GCN/01` — Epic 19; pass stored `docNo` for now
- Per-section analyst/checker **dates** — no dedicated column; may use section `created_at` or workflow event timestamps (TBD)

---

## Verification checklist (this audit)

| # | Item | Status |
|---|------|--------|
| 1 | No files changed except `AUDIT_TrackB_Mapper.md` | See git diff after write |
| 2 | Every `BatchIdentity` field verdicted (a/b/c) with schema + reference evidence | §1.3 — 5×(a), 5×(c), 0×(b) |
| 3 | `verify:12c`, `verify:15`, `verify:16` confirmed fixture-only | §2 |
| 4 | AWS + COA join surfaces mapped field-by-field | §3, §4 |
| 5 | Formatter reuse inventory | §5 |
| 6 | Stub signature, call sites, STANDING_SPEC fan-out documented | §6 |
| 7 | Doc numbering: stored `docNo` vs Epic 19 gap identified | §7 |
| 8 | Signature-image fidelity question answered | §8 |
| 9 | B-2 slicing recommendation (COA first) | §9 |

---

## References

| Document | Path |
|----------|------|
| Track B AWS/COA audit (DOC) | `AC-QMS-DOC-Module/AUDIT_TrackB_AWSCOA.md` |
| Epic 21 display gaps | `AC-QMS-API-Gateway/docs/epics/epic-21-pdf-display.md` |
| Gateway health / verifier status | `AC-QMS-API-Gateway/docs/audits/HEALTH_CHECK.md` |
| Glycine ground truth | `AC-QMS-API-Gateway/docs/glycine_ip_groundtruth_reference.doc` |
| AWS golden fixture | `AC-QMS-DOC-Module/tests/fixtures/glycine_aws_gcn010226.json` |
| Epic 19 numbering | `Epics_Rev2_3_1.md` (workspace root) |
