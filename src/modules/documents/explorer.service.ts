import { DocType } from "@prisma/client";
import type { JwtAccessPayload } from "../../types/auth.types";
import { buildDocumentAccessFilter } from "./document-access";
import {
  loadExplorerTree,
  type ExplorerQueryFilters,
  type RawExplorerProduct,
} from "./explorer.repository";

export type ExplorerDocNode = {
  id: string;
  docType: "SPEC" | "MOA" | "AWS" | "COA";
  docNo: string;
  status: string;
  updatedAt: string;
  hasFile: boolean;
  fileId?: string;
  attachmentId?: string;
};

export type ExplorerBatchNode = {
  id: string;
  batchNo: string;
  status: string;
  assignedQcExecId: string | null;
  aws: ExplorerDocNode | null;
  coa: ExplorerDocNode | null;
};

export type ExplorerProductNode = {
  id: string;
  name: string;
  spec: ExplorerDocNode | null;
  moa: ExplorerDocNode | null;
  batches: ExplorerBatchNode[];
};

export type ExplorerTreeResponse = {
  products: ExplorerProductNode[];
};

function toIso(d: Date): string {
  return d.toISOString();
}

function withFile(
  base: Omit<ExplorerDocNode, "hasFile" | "fileId" | "attachmentId">,
  attachmentId: string | undefined,
): ExplorerDocNode {
  if (!attachmentId) {
    return { ...base, hasFile: false };
  }
  return {
    ...base,
    hasFile: true,
    fileId: attachmentId,
    attachmentId,
  };
}

function pickLatestSpec(product: RawExplorerProduct) {
  return product.specs[0] ?? null;
}

function pickStandingDocxAttachment(
  attachments: Array<{ id: string; filePath: string }>,
  label: "SPEC" | "MOA",
): string | undefined {
  const needle = label === "SPEC" ? "/SPEC_" : "/MOA_";
  return attachments.find((a) => a.filePath.includes(needle))?.id;
}

function mapProduct(
  product: RawExplorerProduct,
  docTypeFilter?: ExplorerQueryFilters["docType"],
): ExplorerProductNode {
  const latest = pickLatestSpec(product);
  let spec: ExplorerDocNode | null = null;
  let moa: ExplorerDocNode | null = null;

  const wantSpec = !docTypeFilter || docTypeFilter === "SPEC";
  const wantMoa = !docTypeFilter || docTypeFilter === "MOA";
  const wantAws = !docTypeFilter || docTypeFilter === "AWS";
  const wantCoa = !docTypeFilter || docTypeFilter === "COA";
  const wantBatches = wantAws || wantCoa;

  if (latest && wantSpec) {
    const attId = pickStandingDocxAttachment(latest.attachments, "SPEC");
    spec = withFile(
      {
        id: latest.id,
        docType: "SPEC",
        docNo: latest.specNo,
        status: latest.status,
        updatedAt: toIso(latest.approvedAt ?? latest.createdAt),
      },
      attId,
    );
  }

  if (latest?.moaDoc && wantMoa) {
    const attId = pickStandingDocxAttachment(latest.attachments, "MOA");
    moa = withFile(
      {
        id: latest.moaDoc.id,
        docType: "MOA",
        docNo: latest.moaDoc.moaNo,
        status: latest.moaDoc.status,
        updatedAt: toIso(latest.moaDoc.createdAt),
      },
      attId,
    );
  }

  const batches: ExplorerBatchNode[] = wantBatches
    ? product.batches.map((batch) => {
        const awsDoc = batch.batchDocuments.find((d) => d.docType === DocType.AWS);
        const coaDoc = batch.batchDocuments.find((d) => d.docType === DocType.COA);

        let aws: ExplorerDocNode | null = null;
        let coa: ExplorerDocNode | null = null;

        if (awsDoc && wantAws) {
          aws = withFile(
            {
              id: awsDoc.id,
              docType: "AWS",
              docNo: awsDoc.docNo,
              status: awsDoc.status,
              updatedAt: toIso(awsDoc.createdAt),
            },
            awsDoc.attachments[0]?.id,
          );
        }

        if (coaDoc && wantCoa) {
          coa = withFile(
            {
              id: coaDoc.id,
              docType: "COA",
              docNo: coaDoc.docNo,
              status: coaDoc.status,
              updatedAt: toIso(coaDoc.createdAt),
            },
            coaDoc.attachments[0]?.id,
          );
        }

        return {
          id: batch.id,
          batchNo: batch.batchNo,
          status: batch.status,
          assignedQcExecId: batch.assignedQcExecId,
          aws,
          coa,
        };
      })
    : [];

  // Standing-only filters: omit batch list. Batch-only filters: clear opposite standing nodes.
  if (docTypeFilter === "SPEC") {
    return { id: product.id, name: product.name, spec, moa: null, batches: [] };
  }
  if (docTypeFilter === "MOA") {
    return { id: product.id, name: product.name, spec: null, moa, batches: [] };
  }
  if (docTypeFilter === "AWS" || docTypeFilter === "COA") {
    return { id: product.id, name: product.name, spec: null, moa: null, batches };
  }

  return { id: product.id, name: product.name, spec, moa, batches };
}

export async function getDocumentExplorerTree(
  actor: JwtAccessPayload,
  filters: ExplorerQueryFilters = {},
): Promise<ExplorerTreeResponse> {
  const scope = buildDocumentAccessFilter(actor);
  const raw = await loadExplorerTree(scope, filters);
  const products = raw.map((p) => mapProduct(p, filters.docType));
  return { products };
}
