# AC-QMS Client Questionnaire

Open decisions gathered from implementation and document audits. **Do not change numbering or schema until these are answered** — reversing a legacy-fidelity choice after build is costly rework.

**Related audit:** [Glycine Downstream Audit](audits/glycine-downstream-audit.md) (June 2026)

---

## Q1 — Document numbering convention (GAP 1) — **BLOCKING**

Real Glycine IP documents use **two code systems** and **different patterns per document type**. AC-QMS today uses one uniform pattern: `<TYPE>/<productCode>/<batchNo>` (e.g. `SPEC/GLC/ B-2026-001`).

### What the real documents use

| Document | Real example | Pattern |
|---|---|---|
| SPEC (standing) | `SPEC/FG00038/01` (R-02) | FG product code + revision — **not per-batch** |
| MOA (standing) | `MOA/FG00038/01` | Same FG code + revision |
| AWS | `AWS/GCN/01` | Batch-family **GCN** code + short sequence |
| Batch number | `GCN/010226` | GCN family + date code |
| ARN / A.R. No. | `2026 GCN 09` | FY + GCN + sequence |
| COA | Analytical Report title; batch `GCN/010226` | No `COA/…` prefix on customer-facing report |

### Questions for Aditya Chemicals

**Q1a.** Should the new system **replicate legacy numbering** (FG code for standing SPEC/MOA, GCN for batch/AWS/ARN) or adopt the **cleaner uniform scheme** already built?

| Option | Description |
|---|---|
| **A — Legacy fidelity** | Add `fgProductCode` (e.g. `FG00038`), `batchFamilyCode` (e.g. `GCN`); SPEC/MOA template numbers use FG; AWS uses `AWS/GCN/01` style sequence; ARN `2026 GCN 09`; batch `GCN/DDMMYY` |
| **B — Uniform (current)** | Keep `TYPE/productCode/batchNo` for all batch documents; standing template numbers via `SPEC-TPL/…`; ARN `AR-YYYY-NNN` |
| **C — Hybrid** | Uniform internally; **display aliases** on PDFs only (printed numbers match legacy, system IDs stay clean) |

**Q1b.** For standing SPEC/MOA: should the **printed document number** on every batch copy show the product revision number (`SPEC/FG00038/01`) while the system tracks a separate per-batch document ID?

**Q1c.** AWS protocol number: confirm whether `/01` is a **protocol revision** (same for all batches of Glycine IP) or a **per-batch sequence**. Real doc shows `AWS/GCN/01(R-00)` in revision history.

**Q1d.** Batch number format: adopt `GCN/DDMMYY` (e.g. `GCN/010226`) instead of `B-2026-001`?

**Q1e.** ARN / A.R. No. format: adopt `YYYY GCN NN` (e.g. `2026 GCN 09`) instead of `AR-2026-001`?

**Client response (fill in):**

```
Q1a: [ A / B / C ]
Q1b: [ Yes / No / N/A ]
Q1c: [ Protocol revision / Per-batch sequence / Other: ___ ]
Q1d: [ Yes / No ]
Q1e: [ Yes / No ]
Notes:
```

---

## Q2 — Multiple instruments per AWS section (GAP 5a)

Real AWS Identification (IR) lists **Balance ID** and **FTIR ID**, each with calibration and use-before dates. AC-QMS allows **one** linked instrument per section (with expiry enforcement).

**Q2.** For v1, is it acceptable to:

| Option | Description |
|---|---|
| **A** | Link primary instrument only (e.g. FTIR); balance ID as free text in remarks/observations |
| **B** | Require schema change: multiple instruments per section with per-instrument expiry ack |
| **C** | Split Identification into separate test parameters (IR vs chemical) with one instrument each |

**Client response:**

```
Q2: [ A / B / C ]
Notes:
```

---

## Q3 — Change Control numbering (Epic 27 evidence)

Real Glycine SPEC revision history uses CC numbers: `CC/2022/003`, `CC/2023/010` — format **`CC/YYYY/NNN`**.

**Q3.** Confirm this is the standard CC numbering format for Epic 27 (Change Control module).

**Client response:**

```
Q3: [ Confirmed / Different format: ___ ]
```

---

## Q4 — Finished-product shelf life

Real batch GCN/010326: Mfg March 2026 → Exp February 2031 (**60 months / 5 years**). SPEC header also states "Shelf Life of Raw Materials: 5 years."

**Q4.** What shelf life should drive **batch expiry** for Glycine IP finished product?

**Client response:**

```
Q4: [ ___ months ]  Notes (raw vs finished distinction):
```

---

## Submission

| Field | Value |
|---|---|
| Completed by | |
| Role | |
| Date | |
| Sign-off | |

Return completed questionnaire before implementing numbering changes or final Glycine seed from Product Master.
`