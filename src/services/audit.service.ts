import { createModuleLogger } from "../lib/logger";
import type { Db } from "../lib/prisma-types";
import { createAuditLog } from "./audit.repository";

const auditLogger = createModuleLogger("audit");

export enum AuditAction {
  CREATE = "CREATE",
  UPDATE = "UPDATE",
  SUBMIT = "SUBMIT",
  APPROVE = "APPROVE",
  SIGN = "SIGN",
  REJECT = "REJECT",
  GENERATE = "GENERATE",
  IMPORT = "IMPORT",
  EXPORT = "EXPORT",
  LOGIN = "LOGIN",
  LOGOUT = "LOGOUT",
  ACKNOWLEDGE_EXPIRED = "ACKNOWLEDGE_EXPIRED",
  ACKNOWLEDGE_OOS = "ACKNOWLEDGE_OOS",
  COMPLETE_SECTION = "COMPLETE_SECTION",
  CHECK_SECTION = "CHECK_SECTION",
  REJECT_CHECK = "REJECT_CHECK",
  SIGN_ISSUE = "SIGN_ISSUE",
  ASSIGN = "ASSIGN",
  SUPERSEDE = "SUPERSEDE",
  REVISE = "REVISE",
  AWS_MANAGER_EDIT = "AWS_MANAGER_EDIT",
  RENDER_FAILED = "RENDER_FAILED",
}

export enum AuditEntityType {
  USER = "USER",
  PRODUCT = "PRODUCT",
  MASTER = "MASTER",
  TEMPLATE = "TEMPLATE",
  BATCH = "BATCH",
  SPEC = "SPEC",
  MOA = "MOA",
  AWS = "AWS",
  COA = "COA",
  CHANGE_CONTROL = "CHANGE_CONTROL",
  INSTRUMENT = "INSTRUMENT",
  REAGENT = "REAGENT",
}

export type AuditInput = {
  userId?: string;
  userName?: string;
  role?: string;
  department?: string;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: string;
  docNo?: string;
  fieldChanged?: string;
  oldValue?: string;
  newValue?: string;
  comment?: string;
  ipAddress?: string;
};

export async function log(input: AuditInput, client?: Db): Promise<void> {
  if (client !== undefined) {
    await createAuditLog(input, client);
    return;
  }
  try {
    await createAuditLog(input);
  } catch (error) {
    auditLogger.error({ err: error, input }, "Failed to write audit log");
  }
}
