import jwt from "jsonwebtoken";

/**
 * Three purposes share one signing secret, distinguished by the
 * `purpose` claim and a short expiry on the two flow tokens:
 *  - "access": a real, usable session — issued only after MFA passes.
 *  - "mfa_setup": proves Google sign-in succeeded for an account that
 *    hasn't enabled MFA yet; only good for the MFA-enrollment endpoints.
 *  - "mfa_challenge": proves Google sign-in succeeded for an account
 *    that already has MFA; only good for submitting a TOTP code.
 * Neither flow token is a valid access token — requireAuth rejects
 * anything whose purpose isn't "access".
 */
export type TokenPurpose = "access" | "mfa_setup" | "mfa_challenge";

interface AccessTokenPayload {
  sub: string;
  roleId: string;
  purpose: "access";
}

interface MfaFlowTokenPayload {
  sub: string;
  purpose: "mfa_setup" | "mfa_challenge";
}

export type TokenPayload = AccessTokenPayload | MfaFlowTokenPayload;

const ACCESS_TOKEN_TTL = "15m";
const MFA_FLOW_TOKEN_TTL = "10m";

/** The back office's tokens, signed and checked with `secret` (JWT_SECRET). */
export function backOfficeTokens(secret: string) {
  return {
    signAccessToken(userId: string, roleId: string): string {
      const payload: AccessTokenPayload = { sub: userId, roleId, purpose: "access" };
      return jwt.sign(payload, secret, { expiresIn: ACCESS_TOKEN_TTL });
    },

    signMfaFlowToken(userId: string, purpose: "mfa_setup" | "mfa_challenge"): string {
      const payload: MfaFlowTokenPayload = { sub: userId, purpose };
      return jwt.sign(payload, secret, { expiresIn: MFA_FLOW_TOKEN_TTL });
    },

    /** Throws (jsonwebtoken's own error types) if the token is invalid, malformed, or expired. */
    verifyToken(token: string): TokenPayload {
      return jwt.verify(token, secret) as TokenPayload;
    },
  };
}
