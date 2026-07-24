import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32).default("supersecret_acqms_jwt_key_2026_change_in_prod"),
  JWT_ACCESS_EXPIRY: z.string().min(1).default("15m"),
  JWT_REFRESH_EXPIRY: z.string().min(1).default("10h"),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
  PORT: z.coerce.number().int().positive().default(4000),
  /** Comma-separated allowed browser origins, e.g. http://localhost:3000,http://localhost:5173 */
  CORS_ORIGIN: z
    .string()
    .min(1)
    .default("http://localhost:3000,http://localhost:5173,https://ac-qms-frontend-next.onrender.com")
    .transform((value) => {
      const origins = value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (origins.length === 0) {
        return ["http://localhost:3000"];
      }
      for (const origin of origins) {
        try {
          z.string().url().parse(origin);
        } catch {
          // fallback if invalid URL format passed
        }
      }
      return origins;
    }),
  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
  DOC_MODULE_URL: z.string().url().default("https://ac-qms-doc-module.onrender.com"),
  DOC_MODULE_API_KEY: z.string().min(1).default("doc_module_secret_key_2026"),
  DOC_MODULE_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  DOC_MODULE_PDF_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  /** When true, DOCX-only is accepted if LibreOffice PDF convert is unavailable. */
  DOC_MODULE_PDF_OPTIONAL: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  DOCUMENT_STORAGE_ROOT: z.string().min(1).default("./storage/documents"),
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
  docModuleTimeoutMs: env.DOC_MODULE_TIMEOUT_MS,
  docModulePdfTimeoutMs: env.DOC_MODULE_PDF_TIMEOUT_MS,
  docModulePdfOptional: env.DOC_MODULE_PDF_OPTIONAL,
  documentStorageRoot: env.DOCUMENT_STORAGE_ROOT,
} as const;
