/**
 * COA mapper — re-exports existing coa-render-mapper as sop-mapper surface.
 * Keeps verify-b22 imports working via coa-render-mapper.ts.
 */
export { mapToCoaRenderInput as mapCoaToRenderInput } from "../coa-render-mapper";
export type { CoaRenderInputDto } from "../coa-render-mapper";
