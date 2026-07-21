import { Role } from "@prisma/client";
import { AppError } from "../../lib/app-error";
import { prisma } from "../../lib/prisma-types";

/**
 * Shared document access scope for explorer + download.
 * One source of truth — do not duplicate role rules elsewhere.
 *
 * QA_EXEC: same as QC_EXEC (assignment-scoped). There is no assignedQaExecId;
 * QA_EXEC cannot be a batch assignee, so seed QA_EXEC typically sees an empty tree.
 */
export type DocumentAccessScope =
  | { mode: "all" }
  | { mode: "assigned"; userId: string };

const FULL_ACCESS_ROLES: ReadonlySet<Role> = new Set([
  Role.SADMIN,
  Role.QC_MGR,
  Role.QA_MGR,
  Role.MKT_EXEC,
]);

const ASSIGNED_SCOPE_ROLES: ReadonlySet<Role> = new Set([
  Role.QC_EXEC,
  Role.QA_EXEC,
]);

export function buildDocumentAccessFilter(user: {
  userId: string;
  role: Role;
}): DocumentAccessScope {
  if (FULL_ACCESS_ROLES.has(user.role)) {
    return { mode: "all" };
  }
  if (ASSIGNED_SCOPE_ROLES.has(user.role)) {
    return { mode: "assigned", userId: user.userId };
  }
  throw AppError.forbidden();
}

/** Product IDs where the user has at least one batch assignment. */
export async function listAssignedProductIds(userId: string): Promise<string[]> {
  const rows = await prisma.batch.findMany({
    where: { assignedQcExecId: userId },
    select: { productId: true },
    distinct: ["productId"],
  });
  return rows.map((r) => r.productId);
}

export type DocumentAccessTarget = {
  productId: string;
  /** Set for batch-level docs (AWS/COA); omit/null for standing SPEC/MOA. */
  kind: "standing" | "batch";
  assignedQcExecId?: string | null;
};

/**
 * Re-authorize independently of the explorer tree.
 * Out of scope → 403 (never 404-for-auth).
 */
export async function assertCanAccessDocument(
  scope: DocumentAccessScope,
  target: DocumentAccessTarget,
): Promise<void> {
  if (scope.mode === "all") return;

  if (target.kind === "batch") {
    if (target.assignedQcExecId !== scope.userId) {
      throw AppError.forbidden("Document is outside your assignments");
    }
    return;
  }

  const assignment = await prisma.batch.findFirst({
    where: {
      productId: target.productId,
      assignedQcExecId: scope.userId,
    },
    select: { id: true },
  });
  if (!assignment) {
    throw AppError.forbidden("Document is outside your assignments");
  }
}
