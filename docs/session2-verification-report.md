# Session 2 Verification Report — Standing SPEC + MOA (+ US-4-5 Revision)

**Date:** 2026-07-04  
**Scope:** Standing SPEC+MOA authoring, combined approval, revision/supersede.

## Results

| # | Check | Result |
|---|-------|--------|
| 1 | `npm run typecheck` | PASS |
| 2 | QC_EXEC authors Glycine SPEC+MOA → DRAFT; tests + 1:1 MOA + sections; audit CREATE | PASS |
| 3 | Author without ACTIVE master → 409 | PASS |
| 4 | Submit → SUBMITTED; MOA mirrors | PASS |
| 5 | Approve (QC_MGR) → QC_APPROVED | PASS |
| 6 | Sign (QA_MGR) → QA_SIGNED; MOA mirrors; `renderDocuments` stub invoked | PASS |
| 7 | Author self-approve → 403 | PASS |
| 8 | Reject without comment → 422 | PASS |
| 9 | Approve/sign without password → 422 | PASS |
| 10 | No standalone MOA create/approve route | PASS |
| 11 | Revise DRAFT spec → 409 | PASS |
| 12 | Revise QA_SIGNED → new DRAFT rev+1, copied tests/MOA; source stays QA_SIGNED | PASS |
| 13 | Second `/revise` while DRAFT open → 409 | PASS |
| 14 | New revision submit→approve→sign → prior SUPERSEDED; one QA_SIGNED remains | PASS |
| 15 | No-gap: `findBatchReadySpec` returns prior signed spec until new revision signs | PASS |

`npm run verify:session2` — **PASSED**

## API surface

| Method | Path | Role |
|--------|------|------|
| POST | `/api/v1/products/:productId/specs` | QC_EXEC |
| GET | `/api/v1/products/:id/specs` | Authenticated |
| GET | `/api/v1/specs/:id` | Authenticated |
| PATCH | `/api/v1/specs/:id` | QC_EXEC (author, DRAFT only) |
| POST | `/api/v1/specs/:id/submit` | QC_EXEC |
| POST | `/api/v1/specs/:id/approve` | QC_MGR + password |
| POST | `/api/v1/specs/:id/sign` | QA_MGR + password |
| POST | `/api/v1/specs/:id/reject` | QC_MGR or QA_MGR + comment |
| POST | `/api/v1/specs/:id/revise` | QC_EXEC |

## Notes

- MOA has no independent lifecycle or routes — status mirrors paired SPEC in every transition.
- `renderDocuments()` is a stub (`status: queued`); Epic 21 will wire the Python microservice.
- Frozen snapshot immutability across revision is verified in **Session 3**.

## Dev credentials

Same as Session 1 (`Acqms@2026`): `kavya.patel` (QC_EXEC), `priya.mehta` (QC_MGR), `sanjay.reddy` (QA_MGR).
