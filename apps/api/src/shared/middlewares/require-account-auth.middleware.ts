import type { NextFunction, Request, Response } from "express";
import { verifyAccountAccessToken } from "../../modules/accounts/jwt";
import { AuthError, getStaffUserById } from "../../modules/accounts/accounts.service";
import { bumpAccountData, cachedForAccount } from "../account-cache";

const READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** How long a member's own record and their role's permissions are reused. Any change the business makes clears them sooner. */
export const AUTH_CACHE_MS = 60_000;

/**
 * Once a change succeeds, everything cached for the business is out of
 * date — see shared/account-cache.ts. Done by holding the response back
 * for the one Valkey round trip it takes, rather than after it's sent: a
 * client that saves and immediately re-reads must never get the old copy.
 */
function bumpAfterSuccess(res: Response, accountId: string) {
  const end = res.end.bind(res) as (...args: unknown[]) => Response;
  res.end = ((...args: unknown[]) => {
    if (res.statusCode >= 400) return end(...args);
    void bumpAccountData(accountId).finally(() => end(...args));
    return res;
  }) as typeof res.end;
}

/**
 * The business app's equivalent of require-auth.middleware.ts: verifies
 * the bearer token is a business-app access token ("tenant_access" — a
 * back-office token is refused, and vice versa), that its member still
 * exists and is active, and attaches req.staffUser.
 *
 * Every failure here is marked TOKEN_INVALID, the one 401 the app's
 * http.ts answers with a silent refresh — see accounts.service.ts's
 * AuthError.
 *
 * The member's row is cached for a minute and thrown away with every
 * change the business makes (bumpAfterSuccess), so deactivating
 * somebody, or changing their role, takes effect on their very next
 * request. Only the fields this needs go to Valkey — never a password
 * hash or 2FA secret.
 */
export async function requireAccountAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new AuthError("Missing bearer token", "TOKEN_INVALID");
  }
  const token = header.slice("Bearer ".length);

  let payload;
  try {
    payload = verifyAccountAccessToken(token);
  } catch {
    throw new AuthError("Invalid or expired access token", "TOKEN_INVALID");
  }

  const staffUser = await cachedForAccount(
    payload.accountId,
    `staff:${payload.sub}`,
    AUTH_CACHE_MS,
    async () => {
      const row = await getStaffUserById(payload.sub);
      return row
        ? {
            id: row.id,
            accountId: row.accountId,
            roleId: row.roleId,
            email: row.email,
            isActive: row.isActive,
          }
        : null;
    },
  );
  // accountId is checked as well as isActive: a token names the business
  // it was issued for, and a member is never moved between businesses, so
  // a mismatch means the token isn't what it claims to be.
  if (!staffUser?.isActive || staffUser.accountId !== payload.accountId) {
    throw new AuthError("Invalid or expired access token", "TOKEN_INVALID");
  }

  req.staffUser = {
    id: staffUser.id,
    accountId: staffUser.accountId,
    roleId: staffUser.roleId,
    email: staffUser.email,
  };

  if (!READ_ONLY_METHODS.has(req.method)) bumpAfterSuccess(res, staffUser.accountId);
  next();
}
