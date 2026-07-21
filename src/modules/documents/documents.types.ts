import { BatchStatus, CoaComplianceVerdict, DocStatus, DocType } from "@prisma/client";
import { WorkflowAction } from "../../services/workflow.config";
import type { SignatureLineageDto } from "../../utils/signature-lineage.mapper";

export type DocumentAllowedAction = WorkflowAction;

export type CoaResultDto = {
  testName: string;
  result: string;
  acceptanceLimits: string | null;
  conclusion: string | null;
  sortOrder: number;
};

export type AwsApprovalQueueItemDto = {
  id: string;
  docNo: string;
  batchId: string;
  batchNo: string;
  productId: string;
  productName: string;
  assignedQcExecName: string | null;
  submittedBy: { username: string; fullName: string } | null;
  submittedAt: Date;
  status: DocStatus;
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
  signatureLineage: SignatureLineageDto;
};
