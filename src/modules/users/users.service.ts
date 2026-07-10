/**
 * User list service — read-only assignee picker support.
 *
 * Implements: US-24-4 (batch endpoints / assign QC_EXEC), US-9-10 (QC_MGR assigns QC_EXEC).
 */
import type { ListUsersQuery } from "./users.schema";
import * as usersRepo from "./users.repository";
import type { UserListItemDto } from "./users.types";

function toUserListItemDto(row: usersRepo.UserListRow): UserListItemDto {
  return {
    id: row.id,
    name: row.fullName,
    role: row.role,
    department: row.department?.name ?? null,
    status: row.status,
  };
}

export async function listUsers(query: ListUsersQuery): Promise<UserListItemDto[]> {
  const rows = await usersRepo.listUsers(query);
  return rows.map(toUserListItemDto);
}
