import type { MoaSectionInput } from "./specs.repository";

/** US-6-2 — per-section content fields for moa_doc_sections create/update. */
export function moaSectionContentFields(section: MoaSectionInput) {
  return {
    pharmacopoeia: section.pharmacopoeia ?? null,
    samplePreparation: section.samplePreparation ?? null,
    standardPreparation: section.standardPreparation ?? null,
    blankPreparation: section.blankPreparation ?? null,
    reagentPreparation: section.reagentPreparation ?? null,
    instrumentParameters: section.instrumentParameters ?? null,
    systemSuitability: section.systemSuitability ?? null,
    sequenceTable: section.sequenceTable ?? null,
    procedureText: section.procedureText ?? null,
    formulaReference: section.formulaReference ?? null,
    conclusionTemplate: section.conclusionTemplate ?? null,
    additionalNotes: section.additionalNotes ?? null,
  };
}
