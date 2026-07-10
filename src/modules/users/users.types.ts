import { DeptName, Role, UserStatus } from "@prisma/client";

/** Minimal user projection for assignee pickers — no credentials or extended PII. */
export interface UserListItemDto {
  id: string;
  name: string;
  role: Role;
  department: DeptName | null;
  status: UserStatus;
}
