# Design: Cross-Section Formula References (GAP 6)

**Status:** Proposed — implement after Product Master import  
**Audit source:** [Glycine Downstream Audit](audits/glycine-downstream-audit.md)  
**Problem:** Assay on dried basis requires `%LOD` from a **completed** Loss on Drying AWS section. Current [formula-engine.ts](../../src/services/formula-engine.ts) only reads variables from the **same section's** `observations`.

---

## Real requirement (Glycine IP MOA)

```
% Assay (on dried basis) = ((Vs − Vb) × M × F × 100 × 100) / (0.1 × W × (100 − %LOD))
```

| Symbol | Source |
|---|---|
| Vs, Vb, W | Assay section observations |
| M | 0.1 M (constant or parameter) |
| F | 0.00751 g C₂H₅NO₂ per mL 0.1 M perchloric acid |
| **%LOD** | **Calculated result from Loss on Drying section** |

Worked example in real AWS: **99.72%** (COA shows 99.75% — rounding).

**Within-section formulas** (no cross-ref needed): LOD `% = loss × 100 / weight`, Sulphated ash `% = residue × 100 / weight`.

---

## Current engine behavior

```typescript
// formula-engine.ts — variables scoped to current section only
buildVariableMapFromObservations(requiredNames, observations)
evaluateFormula(calculationFormula, formulaVariables, variableValues)
```

- Multi-step `steps[]` works **inside** one test.
- No `dependsOn`, no lookup of another section's `calculatedResult`.

**Workaround today:** Analyst re-enters LOD into Assay observations manually — **breaks traceability** and allows stale/wrong LOD if LOD section is updated.

---

## Recommended approach: Option A — `externalRefs` in formula config

Extend `test_parameters.formula_variables` without breaking legacy shape.

### JSON shape

```json
{
  "variables": [
    { "name": "Vs", "label": "Sample titrant volume (mL)" },
    { "name": "Vb", "label": "Blank titrant volume (mL)" },
    { "name": "W", "label": "Sample weight (g)" }
  ],
  "constants": {
    "M": 0.1,
    "F": 0.00751
  },
  "externalRefs": [
    {
      "name": "LOD",
      "sourceTestName": "Loss on drying",
      "field": "calculatedResult",
      "required": true
    }
  ],
  "steps": [
    {
      "name": "assay_pct",
      "formula": "((Vs - Vb) * M * F * 100 * 100) / (0.1 * W * (100 - LOD))"
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `externalRefs[].name` | Variable name injected into formula scope |
| `sourceTestName` | Match `test_parameters.test_name` on same batch AWS (or use `sourceTestParameterId` UUID for stability) |
| `field` | `calculatedResult` \| `resultDisplay` (parsed number) |
| `required` | If true, preview/complete fails when source section incomplete or missing |

**Prefer `sourceTestParameterId`** once Master is stable — test names can change; UUID is frozen on `aws_sections.test_parameter_id`.

### Resolution algorithm (in `aws.service.ts` recompute path)

```
1. Load current section + batch AWS document id
2. normalizeFormulaVariables(config)
3. variableMap = buildVariableMapFromObservations(local variables, observations)
4. For each externalRef:
     a. Find aws_section on same batch_document where testParameterId matches (or testName)
     b. Guard: source section status must be COMPLETED (or at least have calculatedResult)
     c. variableMap[ref.name] = Number(source.calculatedResult)
5. Merge constants into scope
6. evaluateFormula(...)
```

### Error codes

| Code | When |
|---|---|
| `FORMULA_MISSING_EXTERNAL_REF` | Required source section not found |
| `FORMULA_SOURCE_INCOMPLETE` | Source section not COMPLETED / no calculatedResult |
| `FORMULA_CIRCULAR_REF` | A depends on B depends on A (validate at Master save) |

---

## Alternative: Option B — explicit `dependsOnTestParameterId`

Add column on `test_parameters`:

```prisma
dependsOnTestParameterId String? @map("depends_on_test_parameter_id") @db.Uuid
```

Engine auto-injects `dependsOn.calculatedResult` as `lod` (or configured alias). Simpler for one known pattern; less flexible than `externalRefs` for elemental / multi-dependency formulas.

**Recommendation:** Option A — generalizes to any cross-test reference without schema migration per dependency.

---

## Ordering and UX

| Rule | Rationale |
|---|---|
| Assay section `/preview` and `/complete` require LOD section **COMPLETED** with `calculatedResult` | Prevents dried-basis calc with missing LOD |
| UI shows linked LOD value read-only on Assay section | Transparency |
| PATCH Assay observations does **not** copy LOD into JSON | Single source of truth |
| If LOD section re-opened/rejected after Assay complete | Re-validate Assay on next PATCH (recompute may fail or flag stale) |

**Sort order:** Master already defines `sort_order`. Enforce Assay `sort_order` > LOD `sort_order` at Master validation.

---

## Master validation (on save/import)

When `externalRefs` present:

1. Referenced `testParameterId` exists on same Master.
2. Referenced test appears **earlier** in `sort_order`.
3. No circular dependency graph.

---

## Glycine seed target (post-Master)

Replace placeholder Assay in [seed.ts](../../prisma/seed.ts):

| Field | Current (wrong) | Target |
|---|---|---|
| `operator` | NLT 98.5% | BETWEEN 98.5–101.5% |
| `calculationFormula` | titration ratio placeholder | Multi-step with `externalRefs` LOD |
| `minValue` / `maxValue` | 98.5 / null | 98.5 / 101.5 |

---

## Implementation phases

| Phase | Scope |
|---|---|
| **1** | Extend `normalizeFormulaVariables`, `getRequiredVariableNames` to include external ref names |
| **2** | `resolveExternalRefs(awsDocId, sectionId, refs, tx)` in aws repository/service |
| **3** | Wire into `recomputeSection` + `previewAwsSection` |
| **4** | Master import validation + Glycine Assay config |
| **5** | Tests: happy path GCN/010326 values; missing LOD blocks Assay complete |

---

## Out of scope

- Changing formula engine math library (mathjs is sufficient).
- Cross-batch references (never).
- Pulling qualitative text across sections.

---

## References

- Engine: `src/services/formula-engine.ts`
- Recompute: `src/modules/aws/aws.service.ts` → `recomputeSection`
- Ground truth formula: `docs/glycine_ip_groundtruth_reference.doc` §3
