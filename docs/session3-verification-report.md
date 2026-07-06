# Session 3 Verification Report

**Date:** 2026-06-27  
**Scope:** Batch snapshot from QA_SIGNED SPEC, batch QA lock, AWS/COA chain (Rev 2.3)

## Result

`npm run verify:session3` — **ALL CHECKS PASSED** (includes S1/S2 regression)

## Checks

| # | Check | Result |
|---|-------|--------|
| 1 | `npm run typecheck` clean | PASS |
| 2 | QC_MGR creates batch from QA_SIGNED Glycine SPEC → snapshots + ARN + AWS/COA PENDING + assigned exec | PASS |
| 3 | Batch without QA_SIGNED SPEC → 409 | PASS |
| 4 | **Snapshot immutability:** revise standing SPEC after batch create → batch `spec_document_tests` unchanged | PASS |
| 5 | **Batch lock:** submit → approve → APPROVED; edit locked batch → 409; AWS opens PENDING→DRAFT for assignee | PASS |
| 6 | AWS: backend recompute; reject client `calculatedResult`; two-person rule; OOS + expiry hard-blocks | PASS |
| 7 | AWS sign → COA auto-generated (verdict correct) → sign-and-issue → RELEASED; render stub at AWS sign + COA issue | PASS |
| 8 | Full regression: `verify:session1` + `verify:session2` + `verify:session3` all pass | PASS |
| 9 | Audit + notifications participate in `$transaction` where applicable | PASS (workflow side effects in tx) |
| 10 | ARN concurrency: parallel generate in tx does not duplicate sequences | PASS |
| 11 | No standalone MOA batch routes; Prisma only in `*.repository.ts` | PASS |

## Highlights

### #4 Snapshot immutability

Standing SPEC test names were mutated after batch creation. Batch `spec_document_tests` retained frozen names (`Appearance`, `Assay`) — snapshots are independent of live standing SPEC rows.

### #5 Batch lock

After QA approval the batch moves to `APPROVED`. `assertBatchLocked()` returns 409 for further batch/snapshot mutation. AWS document transitions from `PENDING` to `DRAFT` and `aws_sections` are seeded from the frozen snapshot for the assigned QC exec.

### COA verdict

Assay entered below NLT 99% with OOS acknowledgement. COA auto-generated as `DOES_NOT_COMPLY`. Sign-and-issue released batch to `RELEASED`.

## Commands

```bash
npm run typecheck
npm run verify:session1
npm run verify:session2
npm run verify:session3
```

## Notes

- `render-documents.service.ts` queues Epic 21 stub on AWS QA sign and COA sign-and-issue.
- Session 2 verify script updated to clean batch FK data before spec teardown for repeatable regression.
