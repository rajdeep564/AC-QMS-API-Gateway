import { Role } from "@prisma/client";

export interface AuthUserDto {
  id: string;
  fullName: string;
  username: string;
  role: Role;
  departmentId: string | null;
}

export interface LoginResult {
  accessToken: string;
  user: AuthUserDto;
}
