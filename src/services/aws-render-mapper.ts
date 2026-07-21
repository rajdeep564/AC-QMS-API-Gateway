/**
 * AWS mapper — re-export sop-mapper surface for verifiers (mirrors coa-render-mapper.ts).
 */
export { mapAwsToRenderInput as mapToAwsRenderInput } from "./sop-mapper/aws-mapper";
export type { AwsRenderInputDto } from "./sop-client/types";
