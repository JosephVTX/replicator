import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

// Load a .env file if present (local development; in production the container
// provides real environment variables). Looks in cwd and up to the repo root.
for (const candidate of [
  path.join(process.cwd(), ".env"),
  path.join(process.cwd(), "..", "..", ".env"),
]) {
  try {
    if (fs.existsSync(candidate)) {
      process.loadEnvFile(candidate);
      break;
    }
  } catch {
    /* ignore malformed/missing env files */
  }
}

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? def : /^(1|true|yes|on)$/i.test(v)));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("0.0.0.0"),
  DATA_DIR: z.string().default("./.data"),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:3000"),

  SESSION_SECRET: z.string().min(16, "SESSION_SECRET must be at least 16 chars"),
  COOKIE_SECURE: bool(true),

  ADMIN_EMAIL: z.string().email().default("admin@example.com"),
  ADMIN_PASSWORD: z.string().min(8).default("admin1234"),

  OPENCODE_PORT: z.coerce.number().int().positive().default(4096),
  OPENCODE_HOSTNAME: z.string().default("127.0.0.1"),
  OPENCODE_SERVER_USERNAME: z.string().default("opencode"),
  OPENCODE_SERVER_PASSWORD: z.string().default(""),

  /** Pre-installed skill workspace (Playwright scripts + node_modules). */
  SKILL_WS: z.string().optional(),

  MAX_CONCURRENT_JOBS: z.coerce.number().int().positive().default(2),
  JOB_TIMEOUT_MS: z.coerce.number().int().positive().default(3_600_000),
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("Invalid environment configuration:\n", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env: Env = parsed.data;
export const isProd = env.NODE_ENV === "production";
