import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRY: z.string().min(1),
  JWT_REFRESH_EXPIRY: z.string().min(1),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15),
  PORT: z.coerce.number().int().positive(),
  /** Comma-separated allowed browser origins, e.g. http://localhost:3000,http://localhost:3001 */
  CORS_ORIGIN: z
    .string()
    .min(1)
    .transform((value) => {
      const origins = value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (origins.length === 0) {
        throw new Error("CORS_ORIGIN must list at least one origin");
      }
      for (const origin of origins) {
        z.string().url().parse(origin);
      }
      return origins;
    }),
  NODE_ENV: z.enum(["development", "production", "test"]),
  DOC_MODULE_URL: z.string().url(),
  DOC_MODULE_API_KEY: z.string().min(1),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const formatted = parsed.error.flatten().fieldErrors;
  throw new Error(`Invalid environment variables: ${JSON.stringify(formatted)}`);
}

const env = parsed.data;

export const config = {
  databaseUrl: env.DATABASE_URL,
  jwtSecret: env.JWT_SECRET,
  jwtAccessExpiry: env.JWT_ACCESS_EXPIRY,
  jwtRefreshExpiry: env.JWT_REFRESH_EXPIRY,
  bcryptRounds: env.BCRYPT_ROUNDS,
  port: env.PORT,
  corsOrigins: env.CORS_ORIGIN,
  nodeEnv: env.NODE_ENV,
  isProduction: env.NODE_ENV === "production",
  docModuleUrl: env.DOC_MODULE_URL,
  docModuleApiKey: env.DOC_MODULE_API_KEY,
} as const;
