# Glycine IP — Product Master Reconciliation Checklist

Run when the **Product Master** arrives from Aditya Chemicals. Reconcile against real documents and [ground-truth reference](../glycine_ip_groundtruth_reference.doc) before finalising seed/demo fixture.

**Audit context:** [Glycine Downstream Audit](../audits/glycine-downstream-audit.md)  
**Client decisions first:** [Client questionnaire](../client-questionnaire.md) (numbering, shelf life)

---

## 1. Master identity

- [ ] Master revision produces SPEC/MOA **Rev 02** (or document mismatch recorded)
- [ ] Effective dates align with revision history (R-00 21/04/2021, R-01 01/06/2022, R-02 01/06/2023)
- [ ] CC references on revisions: `CC/2022/003`, `CC/2023/010` if change-control module links

---

## 2. Test count and grouping (~18 groups)

Replace 4-test placeholder seed. Confirm presence of:

| # | Test group | Type | Notes |
|---|---|---|---|
| 1 | Description | Qualitative | |
| 2 | Solubility | Qualitative | |
| 3A | Identification — IR | Qualitative | Sub-test A |
| 3B | Identification — chemical | Qualitative | Sub-test B |
| 4 | Appearance of solution | Qualitative | |
| 5 | pH | Quantitative BETWEEN | **5.9 to 6.3** (not 5.5–7.0) |
| 6 | Chlorides | NMT 100 ppm | |
| 7 | Heavy metals | NMT 10 ppm | |
| 8 | Sulphated ash | NMT 0.1% | Formula: residue × 100 / weight |
| 9 | Loss on drying | NMT 0.5% | Formula: loss × 100 / weight |
| 10 | Assay (dried basis) | BETWEEN **98.5–101.5%** | Cross-ref LOD — see §4 |
| 11–13 | Sieve, Bulk density, Tapped density | Optional | `is_optional = true` |
| 14 | Elemental impurities (10 metals) | Per-element NMT | See §3 |
| 15 | Foreign matter | Qualitative | |
| 16 | OVI / Residual solvent (Methanol) | Outside lab | `is_outside_lab = true` |
| 17 | Ethylene oxide | Outside lab | NMT 0.1 ppm |
| 18 | Microbiological block (9 params) | Mixed | Bacterial endotoxin, TAMC, TYMC, pathogens |

- [ ] Test count matches ~18 groups (not 4)
- [ ] Identification split IR vs chemical (not single collapsed test)
- [ ] Optional tests: Sieve, Bulk density, Tapped density flagged `is_optional`
- [ ] Outside-lab: OVI/Residual solvent, Ethylene oxide flagged `is_outside_lab`

---

## 3. Elemental impurities (ICH Q3D)

SPEC sheet lists generic "Lowest detection limit NMT 0.5 µg/g" for most metals. **AWS/COA per-element limits are authoritative:**

| Metal | Real limit (AWS/COA) |
|---|---|
| Pb, As, Cd | NMT 0.5 µg/g |
| Hg | NMT 0.1 µg/g |
| Co | NMT 5.0 µg/g |
| V | NMT 10.0 µg/g |
| Ni | NMT 20.0 µg/g |
| Li | NMT 25.0 µg/g |
| Sb | NMT 9.0 µg/g |
| Cu | NMT 30.0 µg/g |

- [ ] Master uses per-element limits above (not generic 0.5 for all)
- [ ] AAS formula: `Content (µg/g) = software content × SD / W`

---

## 4. Formulas

- [ ] **Assay** includes `(100 − %LOD)` dried-basis correction and **F = 0.00751**
- [ ] Assay `externalRefs` LOD from Loss on drying section ([design doc](../designs/formula-cross-section-references.md)) **or** documented manual workaround rejected by client
- [ ] LOD formula: `% LOD = (Loss in weight × 100) / Weight of sample`
- [ ] Sulphated ash: `% = (Weight of residue × 100) / Weight of sample`
- [ ] Assay operator **BETWEEN** 98.5–101.5% (not NLT 98.5% only)

---

## 5. Product header / batch demo

- [ ] Product name: Glycine / Glycine IP; chemical name 2-aminoethanoic acid; formula C₂H₅NO₂; MW 75.1
- [ ] Regulatory ref: IP
- [ ] Storage: well-closed container, room temperature
- [ ] Shelf life for **finished product** batch expiry confirmed (real batch ≈ **60 months** — questionnaire Q4)
- [ ] Retained sample: 30 gm, retention Expiry + 1 year

---

## 6. Document numbering (after questionnaire)

- [ ] FG code `FG00038` vs GCN batch family — per [client questionnaire](../client-questionnaire.md) Q1 answers
- [ ] Batch demo target: `GCN/010226` (or agreed format)
- [ ] ARN format agreed (Q1e)

---

## 7. End-to-end demo path (COMPLIES)

Reconcile COA results against ground-truth batch `GCN/010226`:

| Test | Result | Limit | Conclusion |
|---|---|---|---|
| Description | White crystalline powder; odorless | A white crystalline powder | Complies |
| pH | 6.02 | 5.9–6.3 | Complies |
| Chlorides | < 100 ppm | NMT 100 ppm | Complies |
| Heavy metals | < 10 ppm | NMT 10 ppm | Complies |
| Sulphated ash | 0.04% | NMT 0.1% | Complies |
| Loss on drying | 0.25% | NMT 0.5% | Complies |
| Assay | 99.72% | 98.5–101.5% | Complies |

- [ ] Seed/demo batch reproduces happy-path **COMPLIES** through SPEC → MOA → AWS → COA → RELEASED
- [ ] `verify:12c` (and related scripts) pass after re-seed

---

## 8. Sign-off

| Step | Owner | Date | Notes |
|---|---|---|---|
| Master import reviewed | | | |
| Checklist complete | | | |
| Client questionnaire Q1–Q4 answered | | | |
| Seed updated | | | |
| Verification scripts green | | | |

---

## Quick commands (after seed update)

```bash
cd server
npm run seed
npm run verify:12c
npm run verify:16
```
