import jwt from "jsonwebtoken";

/**
 * The business (tenant) app's tokens — a business's own staff signing in
 * to run their account.
 *
 * Deliberately distinct purpose values ("tenant_access",
 * "tenant_mfa_challenge") from the back office's "access" and
 * "mfa_challenge". They are signed with the same JWT_SECRET, so the
 * purpose claim is the only thing that stops a back-office token being
 * replayed against a business endpoint, or the other way round — which
 * is why every verify function below checks it, and why audiences.test.ts
 * proves each audience refuses the other's tokens.
 */
export interface AccountAccessTokenPayload {
  /** staff_users.id */
  sub: string;
  accountId: string;
  purpose: "tenant_access";
}

const ACCESS_TOKEN_TTL = "15m";

/**
 * Issued mid-login when a correct password or Google identity belongs to
 * someone with two-factor turned on. It proves the first factor and
 * nothing else: it can't pass verifyAccountAccessToken's purpose check,
 * so even leaked it opens no endpoint. Its one use is being exchanged at
 * POST /accounts/mfa/challenge, together with a live authenticator code,
 * for a real session.
 */
export interface MfaChallengeTokenPayload {
  sub: string;
  purpose: "tenant_mfa_challenge";
}

const MFA_CHALLENGE_TOKEN_TTL = "5m";

/** A business's tokens, signed and checked with `secret` (JWT_SECRET). */
export function tenantTokens(secret: string) {
  return {
    signAccountAccessToken(staffUserId: string, accountId: string): string {
      const payload: AccountAccessTokenPayload = {
        sub: staffUserId,
        accountId,
        purpose: "tenant_access",
      };
      return jwt.sign(payload, secret, { expiresIn: ACCESS_TOKEN_TTL });
    },

    /** Throws if the token is invalid, malformed, expired, or not a business access token. */
    verifyAccountAccessToken(token: string): AccountAccessTokenPayload {
      const payload = jwt.verify(token, secret) as AccountAccessTokenPayload;
      if (payload.purpose !== "tenant_access") {
        throw new Error("Not a business access token");
      }
      return payload;
    },

    signMfaChallengeToken(staffUserId: string): string {
      const payload: MfaChallengeTokenPayload = {
        sub: staffUserId,
        purpose: "tenant_mfa_challenge",
      };
      return jwt.sign(payload, secret, { expiresIn: MFA_CHALLENGE_TOKEN_TTL });
    },

    /** Throws if the token is invalid, malformed, expired, or not a business MFA challenge token. */
    verifyMfaChallengeToken(token: string): MfaChallengeTokenPayload {
      const payload = jwt.verify(token, secret) as MfaChallengeTokenPayload;
      if (payload.purpose !== "tenant_mfa_challenge") {
        throw new Error("Not a business MFA challenge token");
      }
      return payload;
    },
  };
}
