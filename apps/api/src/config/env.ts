import "dotenv/config";
import { z } from "zod";

/**
 * Single source of truth for environment variables.
 * Fails fast at startup if anything required is missing or malformed,
 * instead of surfacing confusing errors deep inside the app later.
 *
 * Adding a required variable here means adding a fake value for it to
 * vitest.config.ts's `env` block in the same change — see that file.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // 4000 rather than iGroom's 3000, so both APIs can run on one laptop.
  PORT: z.coerce.number().int().positive().default(4000),
  // App runtime connection. Once PgBouncer is in front of Postgres, this
  // should point at PgBouncer (e.g. port 6432), not at Postgres directly.
  DATABASE_URL: z
    .string()
    .url({ message: "DATABASE_URL must be a valid postgres connection string" }),
  // Direct (non-pooled) connection to Postgres, bypassing PgBouncer.
  // drizzle-kit and migrations need this: DDL, CREATE INDEX CONCURRENTLY,
  // and drizzle-kit's advisory-lock migration locking don't work reliably
  // through PgBouncer's transaction pooling mode. Optional — if unset,
  // falls back to DATABASE_URL (fine as long as PgBouncer isn't in the
  // picture yet).
  DIRECT_DATABASE_URL: z.string().url().optional(),
  // Path, inside the container, to the PEM bundle used to verify the
  // database server's certificate. Set means "connect with TLS and
  // verify"; unset means plaintext, which is what a local docker-compose
  // Postgres serves. Aurora requires TLS (rds.force_ssl defaults to 1 on
  // engine 16+), so every deployed task definition sets this — see
  // packages/db/src/ssl.ts.
  DATABASE_CA_BUNDLE_PATH: z.string().optional(),
  // Comma-separated list of read-replica connection strings, e.g.
  // "postgres://.../replica1,postgres://.../replica2". Optional —
  // leave unset in local/dev and reads will just use the primary.
  DATABASE_REPLICA_URLS: z
    .string()
    .optional()
    .default("")
    .transform((val) =>
      val
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  // Google Cloud Console OAuth 2.0 Client ID. The back office uses this
  // same ID to obtain a Google ID token; the backend verifies the token
  // was issued for this exact client before trusting any of its claims.
  GOOGLE_CLIENT_ID: z.string().min(1, "GOOGLE_CLIENT_ID is required for Google sign-in"),
  // The Valkey/Redis server that holds short-lived shared state — today
  // the sign-in attempt limits (src/shared/rate-limit.ts). redis:// or
  // rediss:// (TLS; ElastiCache Serverless accepts nothing else).
  // Optional on purpose: unset, the server still boots and the limits
  // fail open, which is right for local dev and wrong for production (a
  // warning says so at boot).
  REDIS_URL: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined)
    .refine((value) => !value || /^rediss?:\/\//.test(value), {
      message: "REDIS_URL must start with redis:// or rediss://",
    }),
  // "true" for ElastiCache Serverless, which only speaks cluster mode; the
  // client then discovers the shards itself. Left false for a single
  // local server (docker compose's Valkey).
  REDIS_CLUSTER: z
    .enum(["true", "false", ""])
    .optional()
    .transform((value) => value === "true"),
  // How many proxies stand between the internet and this process — 1
  // behind the AWS load balancer. Express reads the caller's address from
  // X-Forwarded-For only this many hops deep, which is what makes req.ip
  // the caller's address rather than the load balancer's (per-device
  // rate limits key on it). 0, the default, trusts no header — right for
  // local dev, where nothing sits in front and any X-Forwarded-For was
  // typed by the caller. Must be set explicitly in production; app.ts
  // refuses to start without it.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  // Signs/verifies access tokens and short-lived MFA-flow tokens.
  // Generate with: openssl rand -hex 32
  JWT_SECRET: z.string().min(32, "JWT_SECRET should be at least 32 characters"),
  // Encrypts TOTP MFA secrets at rest. Generate with: openssl rand -hex 32
  MFA_ENCRYPTION_KEY: z.string().min(16, "MFA_ENCRYPTION_KEY should be a long random string"),
  // Resend API key for transactional email — shared/email.ts's sendEmail.
  // Optional: when unset, emails are logged to the server console instead
  // of sent, which is fine outside production (and refused inside it).
  // Get a key from https://resend.com/api-keys.
  RESEND_API_KEY: z.string().optional(),
  // Must be on a domain verified in Resend before real sends will work.
  // The default is Resend's shared testing sender, which needs no domain
  // but only delivers to the address the Resend account was created
  // with — replace it once Service Finder's domain is verified.
  RESEND_FROM_EMAIL: z.string().default("Service Finder <onboarding@resend.dev>"),
  // With no RESEND_API_KEY, emails are logged instead of sent. Set this to
  // "1" to include the full HTML body in that log — useful when you're
  // actually working on a template, and a wall of table markup the rest of
  // the time.
  EMAIL_DEBUG_HTML: z.string().optional(),
  // Comma-separated list of origins allowed to call this API from a
  // browser, e.g. "http://localhost:5273,https://admin.example.com".
  // Defaults to the back office's local Vite dev server so `pnpm dev`
  // works out of the box — override in every non-local environment.
  CORS_ORIGINS: z
    .string()
    .optional()
    .default("http://localhost:5273")
    .transform((val) =>
      val
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment variables — check your .env file against .env.example");
}

export const env = {
  ...parsed.data,
  // Resolve once so every consumer (drizzle.config.ts, migrate.ts) just
  // reads env.DIRECT_DATABASE_URL without re-deriving the fallback.
  DIRECT_DATABASE_URL: parsed.data.DIRECT_DATABASE_URL ?? parsed.data.DATABASE_URL,
};
export type Env = typeof env;
