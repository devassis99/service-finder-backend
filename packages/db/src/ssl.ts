import { readFileSync } from "node:fs";

/**
 * TLS for every Postgres connection this process opens.
 *
 * Aurora PostgreSQL sets rds.force_ssl = 1 by default from engine 16
 * onwards, and rejects a plaintext client at authentication time with
 *
 *   FATAL 28000: no pg_hba.conf entry for host "10.x.x.x", user "service_finder",
 *   database "service_finder", no encryption
 *
 * — a message that names the host, the user and the database, which is
 * exactly why it reads like a permissions problem rather than a missing
 * `ssl` option. It is the last three words that matter.
 *
 * Verification is on. `rejectUnauthorized: false` would satisfy the
 * server just as well, and is what most answers to that error suggest,
 * but it encrypts against an eavesdropper without authenticating the
 * endpoint — the connection would still succeed against anything that
 * answered on that address. Amazon's root CAs are not in Node's trust
 * store, so the bundle has to be supplied; the Dockerfile puts it in the
 * image and the task definitions point DATABASE_CA_BUNDLE_PATH at it.
 *
 * Unset means no TLS, which is what a local docker-compose Postgres
 * wants — so `pnpm dev` and the test suite are untouched.
 */
export type DatabaseSsl = { ca: string; rejectUnauthorized: true } | false;

/**
 * The `ssl` option for a pg Pool, from DATABASE_CA_BUNDLE_PATH. Read the
 * file once at startup and hand the result to every pool: it does not
 * change under a running container.
 */
export function databaseSsl(path: string | undefined): DatabaseSsl {
  if (!path) return false;

  try {
    return { ca: readFileSync(path, "utf8"), rejectUnauthorized: true };
  } catch (cause) {
    // Refusing here is the point. Falling back to a plaintext or
    // unverified connection would turn a missing file into a security
    // property nobody chose, discovered — if ever — much later.
    throw new Error(
      `DATABASE_CA_BUNDLE_PATH is set to ${path}, which could not be read. ` +
        `The image should contain the Amazon RDS bundle at that path.`,
      { cause },
    );
  }
}
