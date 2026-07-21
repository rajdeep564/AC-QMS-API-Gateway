# SOP / DOC-Module Contract (Epic 21)

**Source of truth:** live [`AC-QMS-DOC-Module`](../AC-QMS-DOC-Module/) schemas — not prior assumptions.

**Service URL (dev):** `http://127.0.0.1:8000`  
**Start:** from `AC-QMS-DOC-Module/`:

```bash
uvicorn app.main:app --reload --app-dir .
```

**Auth:** `X-API-Key` header (env `API_KEY` in DOC-Module = `DOC_MODULE_API_KEY` in Gateway).  
**Health:** `GET /health` — no auth — `{ "status": "ok", "app": "..." }`.

---

## Endpoints the Gateway uses

| Use case | Method / path | Body | Response |
|----------|---------------|------|----------|
| Standing SPEC | `POST /generate` | `InlineGenerateRequest` with `document_type: "specification"` | DOCX binary |
| Standing MOA | `POST /generate` | `document_type: "moa"` | DOCX binary |
| Batch AWS | `POST /render` | `{ "document_type": "aws", "payload": AwsRenderInput }` | DOCX binary |
| Batch COA | `POST /render` | `{ "document_type": "coa", "payload": CoaRenderInput }` | DOCX binary |
| DOCX → PDF | `POST /convert/pdf` | multipart file (`.docx`) | PDF binary |

**Not used by Gateway:** DB-backed `/moa/generate`, `/specification/generate`, `GET /documents/{id}/pdf` (those require a DOC-Module DB row).

---

## Standing documents — `InlineGenerateRequest`

Schema: `app/schemas/document.py`

```
document_type: "moa" | "protocol" | "specification" | "sop" | "annexure"
product: ProductConfig
document_no?: string
revision_no: string = "01"
subject?: string
department: string = "QUALITY ASSURANCE"
effective_date?: date
review_date?: date
superseded_revision?: string
approval: ApprovalBlock
revision_history: RevisionHistoryEntry[]
batch: object
extra_context: object
```

### `ProductConfig` (`app/schemas/product.py`)

| Field | Notes |
|-------|--------|
| `product_code` | ERP FG code (e.g. `FG00038`) |
| `product_name` | Display name |
| `reference`, `molecular_weight`, `chemical_formula` | Optional identity |
| `specification_no`, `moa_no`, `protocol_no` | Document numbers |
| `tests`, `additional_tests`, `microbiological_tests` | `TestConfig[]` |
| `sop_sections` | SOP only |
| `revision_history`, `metadata` | Optional |

### `TestConfig`

- `name`, `procedure?`, `acceptance_criteria?`, `instruments[]`, `reagents[]`, `tables[]`, `sub_tests[]`, `section_no?`

### Acceptance criteria types

`range` | `between` | `nmt` | `max` | `nlt` | `min` | `equals` | `text`  
Also accepts a plain **string** (descriptive, no machine validation).

### `ApprovalBlock`

```
prepared_by / checked_by / approved_by: { name?, designation?, signature?, date? }
```

---

## Batch documents — `POST /render`

Discriminated union (`app/schemas/render_request.py`):

### AWS — `AwsRenderInput` (`app/schemas/aws_render.py`)

- Identity: `document_no`, `revision_no`, `product`, `batch`, `company_name`, `department`
- `sections[]`: `test_name`, `limits_display`, `procedure_text?`, `readings_display?`, `calculated_result?`, `result_display`, `conclusion_display`, OOS/expiry flags, `analyst` / `checker` signatures
- `approval`, `revision_history`

### COA — `CoaRenderInput` (`app/schemas/coa_render.py`)

- `coa_results[]`: `sort_order`, `test_name`, `result`, `acceptance_limits?`, `conclusion?`
- `compliance_verdict`: `"COMPLIES"` | `"DOES_NOT_COMPLY"`
- `compliance_remark`, `approval`

---

## Reference fixtures

| File | Purpose |
|------|---------|
| `AC-QMS-DOC-Module/config/products/glycine_ip.json` | Standing ProductConfig (Glycine IP) |
| `AC-QMS-DOC-Module/tests/fixtures/glycine_aws_gcn010226.json` | AWS render fixture |
| `AC-QMS-DOC-Module/tests/fixtures/glycine_coa_gcn010226.json` | COA render fixture |

---

## Domain mapping gaps (honest)

| Gap | Approach |
|-----|----------|
| User has no `designation` column | Use role label (`QC Executive`, `QC Manager`, `QA Manager`) |
| No handwritten signature image | `signature: null` (audit trail is e-sign evidence) |
| ERP `product_code` (FG00038) vs batch short code (GCN) | Master EAV `product_code` → ProductConfig; batch short code lives in `batch.batch_no` / ARN only |
| Standing SPEC+MOA share one lineage | Same `approval` block for both renders from SPEC signature columns |
| PDF requires LibreOffice | `POST /convert/pdf` uses `PDFService`; set `LIBREOFFICE_PATH` if needed. Gateway `DOC_MODULE_PDF_OPTIONAL=true` (default) stores DOCX and continues if LibreOffice is missing. |

---

## Differences vs Session prompt assumptions

| Assumption | Reality |
|------------|---------|
| Single `/generate` with `format` | Standing → `/generate`; batch → `/render`; no format param |
| PDF from same generate call | Separate `/convert/pdf` (added for Epic 21) |
| `SOP_SERVICE_URL` | Gateway uses existing `DOC_MODULE_URL` + `DOC_MODULE_API_KEY` |

---

## Contract verification (STEP 0 gate)

| Check | Result |
|-------|--------|
| Service start | `py -3.11` venv; `uvicorn app.main:app --reload --app-dir . --host 127.0.0.1 --port 8000` |
| URL | `http://127.0.0.1:8000` |
| `GET /health` | `{ "status": "ok", "app": "Pharmaceutical QMS Document Platform" }` |
| Glycine SPEC via `POST /generate` | `generated/epic21_glycine_spec_gate.docx` — **59778 bytes**, ZIP magic `PK` (valid DOCX) |