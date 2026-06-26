# Epic 21 — PDF & Document Display

SOP-on-SOP PDF generation and printed document fidelity. **Core workflow logic is complete** (Epic 12c); this epic covers rendering, wording, and layout gaps identified in the [Glycine Downstream Audit](audits/glycine-downstream-audit.md).

**Stub today:** `generateCoaPdf()` in `server/src/services/coa-generator.ts` is a no-op.

---

## Tracked display items (from Glycine audit)

### COA — verdict wording (GAP 2)

| Source | Wording |
|---|---|
| Code enum | `COMPLIES` / `DOES_NOT_COMPLY` |
| Short COA (`Glycine IP 010326.docx`) | *"Complies with the IP specification"* |
| Full AWS summary (`GLYCINE IP.docx`) | *"complies / does not comply as per IP specification"* |

**Implementation note:** Map enum → exact client phrase at PDF render time. Do not change DB enum.

```typescript
// Suggested renderer helper (Epic 21)
function formatComplianceRemark(verdict: CoaComplianceVerdict): string {
  return verdict === "COMPLIES"
    ? "Complies with the IP specification"
    : "does not comply as per IP specification";
}
```

---

### COA — acceptance limit phrasing (GAP 3)

| Operator | Code today | Real documents |
|---|---|---|
| BETWEEN | `Between 5.9 and 6.3` | `5.9 to 6.3` |
| BETWEEN + % | `Between 98.5 and 101.5 %` | `98.5% to 101.5%` |
| NMT | `NMT 100 ppm` | ✓ matches |
| NLT | `NLT 98.5` | ✓ matches |

**Implementation note:** Update `formatAcceptanceLimits()` in `coa-generator.ts` **or** apply display transform only in PDF layer if API should keep current strings. Confirm UOM spacing (`98.5%` tight vs `98.5 %`).

---

### COA — per-row conclusion label (additional finding)

| Context | Label |
|---|---|
| AWS sections | Satisfactory / Not satisfactory |
| Short customer COA | Complies (implicit per row) |
| Code COA rows | `Satisfactory`, `Pass`, etc. from `formatConclusionLabel()` |

**Decision for Epic 21:** Customer-facing COA PDF may use "Complies" per row vs internal "Satisfactory" — confirm with client during PDF template review.

---

### AWS — Balance ID layout (GAP 5b)

Real AWS prints labeled blanks:

```
Balance ID: _________________  Date of Calibration: ___  Use Before: ___
FTIR ID: ____________________  Date of Calibration: ___  Use Before: ___
```

**Implementation note:** UI/PDF should show instrument master `instrumentCode` + calibration/use-before when linked via `instrumentId`. Secondary balance line can use remarks or future multi-instrument support (see [client questionnaire](client-questionnaire.md) Q2).

---

### AWS — document header metadata (GAP 5c)

Fields on real AWS header not fully modeled on `BatchDocument`:

| Field | Real example | AC-QMS today |
|---|---|---|
| Test Request Sheet No. | (blank on sample) | Not stored |
| A.R. No. | ties to ARN | `batches.arn` (format differs — see questionnaire Q1e) |
| Batch size | 3000 Kgs | `batches.batchSize` (if populated) |
| Quantity sampled | | Not stored |
| Received date | | Not stored |
| Testing date | | Not stored |
| Completion date | | Not stored |
| Ref SPEC/MOA | `SPEC/FG00038/01 (IP)` | Via batch document lineage / `docNo` |

**Implementation note:** Epic 21 PDF template composes header from `Batch` + `BatchDocument` + related SPEC/MOA `docNo`. Add optional header fields to schema only if client requires them in-system (not just on PDF).

---

### AWS — MOA procedure text on worksheet pages (GAP 5d)

Real AWS embeds full MOA procedures above observation blanks. AC-QMS stores procedures on Master/MOA sections; AWS holds observations + results.

**Implementation note:** PDF/UI merges MOA section `procedureText` (or equivalent) with AWS section observations for print layout. No workflow change.

---

## Document types in scope

| Doc | Generator entry point | Status |
|---|---|---|
| COA / Analytical Report | `generateCoaPdf(coaDocId)` | Stub |
| AWS (filled protocol) | TBD | Not started |
| SPEC / MOA (batch copies) | TBD | Not started |

---

## Acceptance criteria (Epic 21 — Glycine fixture)

When implementing PDF for batch `GCN/010326` happy path:

- [ ] Overall remark uses exact IP specification wording (GAP 2)
- [ ] pH limit shows `5.9 to 6.3` not `Between …` (GAP 3)
- [ ] Assay limit shows `98.5% to 101.5%` with tight `%`
- [ ] AWS header shows batch `GCN/010326`, ref SPEC/MOA numbers, A.R. No. per client numbering decision
- [ ] IR section shows instrument IDs and calibration dates where linked
- [ ] MOA procedure text appears on AWS pages per section

---

## References

- Audit: [glycine-downstream-audit.md](audits/glycine-downstream-audit.md)
- Client decisions: [client-questionnaire.md](client-questionnaire.md)
- COA data model: `coa_results`, `compliance_verdict` — Epic 12c complete
