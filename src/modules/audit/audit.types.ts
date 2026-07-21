export type AuditLogDto = {
  id: string;
  timestamp: string;
  userId: string | null;
  userName: string | null;
  role: string | null;
  department: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  docNo: string | null;
  fieldChanged: string | null;
  oldValue: string | null;
  newValue: string | null;
  comment: string | null;
  ipAddress: string | null;
};
