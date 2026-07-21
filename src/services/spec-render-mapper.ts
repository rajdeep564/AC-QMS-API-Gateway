/**
 * Standing SPEC mapper — re-export sop-mapper surface for verifiers (mirrors aws-render-mapper.ts).
 * DOC-Module contract: POST /generate with InlineGenerateRequest (document_type: specification).
 */
export { mapToSpecRenderInput } from "./sop-mapper/standing-mapper";
export type { InlineGenerateRequestDto } from "./sop-client/types";
