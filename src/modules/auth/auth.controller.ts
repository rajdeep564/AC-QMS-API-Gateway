import { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { ok } from "../../lib/api-response";
import { AppError } from "../../lib/app-error";
import type { AuthenticatedRequest } from "../../types/authenticated-request";
import type { ChangePasswordBody, LoginBody, VerifyPasswordBody } from "./auth.schema";
import {
  getRefreshCookieOptions,
  REFRESH_COOKIE_NAME,
} from "./auth.constants";
import {
  changePasswordForUser,
  loginUser,
  logoutUser,
  signAccessToken,
  toAuthUser,
  validateRefreshSession,
  verifyRefresh,
  verifyUserPassword,
} from "./auth.service";

export const login = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as LoginBody;
  const { accessToken, refreshToken, user } = await loginUser(body.username, body.password, {
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
  });

  res.cookie(REFRESH_COOKIE_NAME, refreshToken, getRefreshCookieOptions());

  res.json(
    ok({
      accessToken,
      user: toAuthUser(user),
    }),
  );
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
  if (!refreshToken) {
    throw AppError.fromCode("TOKEN_INVALID", "Refresh token missing");
  }

  const { user } = await validateRefreshSession(refreshToken);

  const accessToken = signAccessToken({
    userId: user.id,
    role: user.role,
    departmentId: user.departmentId,
  });

  res.json(ok({ accessToken }));
});

export const verifyPasswordHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as VerifyPasswordBody;
  await verifyUserPassword(req.user.userId, body.password);
  res.json(ok({ verified: true }));
});

export const changePassword = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as ChangePasswordBody;
  await changePasswordForUser(
    req.user.userId,
    body.currentPassword,
    body.newPassword,
    req.ip,
  );
  res.json(ok({ success: true }));
});

export const logout = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;

  let sessionId: string | undefined;
  if (refreshToken) {
    try {
      const payload = verifyRefresh(refreshToken);
      sessionId = payload.sessionId;
    } catch {
      // Ignore invalid refresh token during logout
    }
  }

  await logoutUser(req.user.userId, sessionId, req.ip);

  res.clearCookie(REFRESH_COOKIE_NAME, getRefreshCookieOptions());
  res.json(ok({ success: true }));
});

// DEV ONLY — remove when user module ships
export const me = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  res.json(ok(req.user));
});
