import { config } from "../../config/env";

export const REFRESH_COOKIE_NAME = "refreshToken";

export const REFRESH_COOKIE_MAX_AGE_MS = parseExpiryToMs(config.jwtRefreshExpiry);

export function getRefreshCookieOptions() {
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "lax" as const,
    path: "/api/v1/auth",
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
  };
}

export function parseExpiryToMs(expiry: string): number {
  const match = expiry.match(/^(\d+)([smhd])$/);
  if (!match) {
    throw new Error(`Invalid expiry format: ${expiry}`);
  }

  const value = Number(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };

  return value * multipliers[unit];
}

export function getRefreshExpiryDate(): Date {
  return new Date(Date.now() + REFRESH_COOKIE_MAX_AGE_MS);
}
