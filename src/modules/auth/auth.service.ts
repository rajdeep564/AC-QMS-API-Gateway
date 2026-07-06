import bcrypt from "bcrypt";
import crypto from "crypto";
import jwt, { SignOptions } from "jsonwebtoken";
import { User, UserStatus } from "@prisma/client";
import { LOCKOUT_MINUTES, LOCKOUT_THRESHOLD } from "../../config/constants";
import { config } from "../../config/env";
import { AppError } from "../../lib/app-error";
import { JwtAccessPayload, JwtRefreshPayload } from "../../types/auth.types";
import { AuthUserDto } from "./auth.types";
import { getRefreshExpiryDate } from "./auth.constants";
import * as authRepo from "./auth.repository";

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, config.bcryptRounds);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signAccessToken(payload: JwtAccessPayload): string {
  const options: SignOptions = { expiresIn: config.jwtAccessExpiry as SignOptions["expiresIn"] };
  return jwt.sign(payload, config.jwtSecret, options);
}

export function signRefreshToken(payload: JwtRefreshPayload): string {
  const options: SignOptions = { expiresIn: config.jwtRefreshExpiry as SignOptions["expiresIn"] };
  return jwt.sign(payload, config.jwtSecret, options);
}

export function verifyAccess(token: string): JwtAccessPayload {
  try {
    return jwt.verify(token, config.jwtSecret) as JwtAccessPayload;
  } catch {
    throw AppError.fromCode("TOKEN_INVALID", "Invalid or expired access token");
  }
}

export function verifyRefresh(token: string): JwtRefreshPayload {
  try {
    return jwt.verify(token, config.jwtSecret) as JwtRefreshPayload;
  } catch {
    throw AppError.fromCode("TOKEN_INVALID", "Invalid or expired refresh token");
  }
}

export async function findUserForLogin(username: string) {
  return authRepo.findUserForLogin(username);
}

export async function assertUserCanLogin(user: User): Promise<void> {
  if (user.deletedAt) {
    throw AppError.fromCode("INVALID_CREDENTIALS");
  }

  if (user.status === UserStatus.INACTIVE) {
    throw AppError.fromCode("ACCOUNT_INACTIVE");
  }

  const now = new Date();

  if (user.status === UserStatus.LOCKED) {
    if (user.lockedUntil && user.lockedUntil > now) {
      throw AppError.fromCode("ACCOUNT_LOCKED");
    }

    await authRepo.updateUser(user.id, {
      status: UserStatus.ACTIVE,
      failedAttempts: 0,
      lockedUntil: null,
    });
  }
}

export async function handleLoginAttempt(userId: string, success: boolean): Promise<void> {
  if (success) {
    await authRepo.updateUser(userId, {
      failedAttempts: 0,
      status: UserStatus.ACTIVE,
      lockedUntil: null,
      lastLoginAt: new Date(),
    });
    return;
  }

  const user = await authRepo.updateUser(userId, {
    failedAttempts: { increment: 1 },
  });

  if (user.failedAttempts >= LOCKOUT_THRESHOLD) {
    await authRepo.updateUser(userId, {
      status: UserStatus.LOCKED,
      lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000),
    });
  }
}

export async function createSession(
  userId: string,
  _meta?: { ipAddress?: string; userAgent?: string | null },
): Promise<{ sessionId: string; refreshToken: string }> {
  const tempHash = await bcrypt.hash(crypto.randomUUID(), config.bcryptRounds);
  const session = await authRepo.createSessionRecord({
    user: { connect: { id: userId } },
    tokenHash: tempHash,
    expiresAt: getRefreshExpiryDate(),
  });

  const refreshToken = signRefreshToken({
    userId,
    sessionId: session.id,
  });
  const tokenHash = await bcrypt.hash(refreshToken, config.bcryptRounds);

  await authRepo.updateSession(session.id, { tokenHash });

  return { sessionId: session.id, refreshToken };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await authRepo.deleteSessions({ id: sessionId });
}

export async function validateRefreshSession(refreshToken: string) {
  const payload = verifyRefresh(refreshToken);

  const session = await authRepo.findSessionById(payload.sessionId);

  if (!session || session.userId !== payload.userId) {
    throw AppError.fromCode("TOKEN_INVALID", "Session not found");
  }

  if (session.expiresAt <= new Date()) {
    throw AppError.fromCode("TOKEN_EXPIRED");
  }

  const tokenMatches = await bcrypt.compare(refreshToken, session.tokenHash);
  if (!tokenMatches) {
    throw AppError.fromCode("TOKEN_INVALID", "Session not found");
  }

  return { session, user: session.user };
}

export function toAuthUser(user: User): AuthUserDto {
  return {
    id: user.id,
    fullName: user.fullName,
    username: user.username,
    role: user.role,
    departmentId: user.departmentId,
  };
}

export async function getUserById(userId: string) {
  return authRepo.findUserById(userId);
}

export async function changeUserPassword(userId: string, newPassword: string): Promise<void> {
  const passwordHash = await hashPassword(newPassword);
  await authRepo.updateUser(userId, {
    passwordHash,
    forcePwdChange: false,
  });
}

export async function loginUser(
  username: string,
  password: string,
  meta: { ipAddress?: string; userAgent?: string | null },
): Promise<{ accessToken: string; refreshToken: string; user: User & { department: { name: string } | null } }> {
  const user = await findUserForLogin(username);

  if (!user) {
    throw AppError.fromCode("INVALID_CREDENTIALS");
  }

  await assertUserCanLogin(user);

  const passwordValid = await verifyPassword(password, user.passwordHash);
  if (!passwordValid) {
    await handleLoginAttempt(user.id, false);
    throw AppError.fromCode("INVALID_CREDENTIALS");
  }

  const accessToken = signAccessToken({
    userId: user.id,
    role: user.role,
    departmentId: user.departmentId,
  });

  const { refreshToken } = await createSession(user.id, meta);
  await handleLoginAttempt(user.id, true);

  return { accessToken, refreshToken, user };
}

export async function verifyUserPassword(userId: string, password: string): Promise<void> {
  const user = await getUserById(userId);

  if (!user) {
    throw AppError.fromCode("PASSWORD_MISMATCH");
  }

  const passwordValid = await verifyPassword(password, user.passwordHash);
  if (!passwordValid) {
    throw AppError.fromCode("PASSWORD_MISMATCH");
  }
}

export async function changePasswordForUser(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await getUserById(userId);

  if (!user) {
    throw AppError.fromCode("PASSWORD_MISMATCH", "Invalid current password");
  }

  const passwordValid = await verifyPassword(currentPassword, user.passwordHash);
  if (!passwordValid) {
    throw AppError.fromCode("PASSWORD_MISMATCH", "Invalid current password");
  }

  await changeUserPassword(userId, newPassword);
}

export function getDepartmentName(user: { department?: { name: string } | null }): string | undefined {
  return user.department?.name;
}
