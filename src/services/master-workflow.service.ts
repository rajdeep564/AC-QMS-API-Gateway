import { MasterStatus, Role } from "@prisma/client";

/** Rev 2.3 master actions — admin-owned; no password re-entry (Bible 5.1). */
export type MasterAction = "APPROVE" | "REJECT" | "ASSIGN" | "EDIT_FIELDS";

export function getMasterAllowedActions(
  status: MasterStatus,
  role: Role,
  actorUserId: string,
  assignedToId: string | null,
): MasterAction[] {
  const actions: MasterAction[] = [];

  if (status === MasterStatus.DRAFT) {
    const isAssignee = assignedToId !== null && actorUserId === assignedToId;
    const isSadmin = role === Role.SADMIN;

    if (isSadmin || isAssignee) {
      actions.push("EDIT_FIELDS");
    }
    if (isSadmin) {
      actions.push("APPROVE", "REJECT", "ASSIGN");
    }
  }

  return actions;
}
