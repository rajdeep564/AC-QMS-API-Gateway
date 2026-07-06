import { Role } from "@prisma/client";

export interface JwtAccessPayload {
  userId: string;
  role: Role;
  departmentId: string | null;
}

export interface JwtRefreshPayload {
  userId: string;
  sessionId: string;
}
