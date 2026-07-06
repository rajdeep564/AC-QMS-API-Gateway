import { BatchStatus, CoaComplianceVerdict, DocStatus, DocType } from "@prisma/client";
import { WorkflowAction } from "../../services/workflow.config";

export type DocumentAllowedAction = WorkflowAction | "SIGN_ISSUE";

export type CoaResultDto = {
  testName: string;
  result: string;
  acceptanceLimits: string | null;
  conclusion: string | null;
  sortOrder: number;
};

export type DocumentDetailDto = {
  id: string;
  batchId: string;
  docType: DocType;
  docNo: string;
  status: DocStatus;
  complianceVerdict: CoaComplianceVerdict | null;
  createdById: string | null;
  submittedById: string | null;
  qcApprovedById: string | null;
  qaSignedById: string | null;
  batch: {
    id: string;
    batchNo: string;
    arnNo: string | null;
    status: BatchStatus;
    assignedQcExecId: string | null;
  };
  coaResults: CoaResultDto[];
  allowedActions: DocumentAllowedAction[];
};
