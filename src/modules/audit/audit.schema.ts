import { z } from "zod";
import { AuditAction, AuditEntityType } from "../../services/audit.service";

export const listAuditLogsQuerySchema = z.object({
  entityType: z.nativeEnum(AuditEntityType).optional(),
  action: z.nativeEnum(AuditAction).optional(),
  userId: z.string().uuid().optional(),
  entityId: z.string().uuid().optional(),
  docNo: z.string().min(1).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  /** Expensive at scale — ILIKE on comment and docNo; use sparingly. */
  search: z.string().min(1).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;
