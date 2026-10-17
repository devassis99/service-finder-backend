import { describe, expect, it } from "vitest";
import { backOfficeTokens, tenantTokens } from "./index";

/**
 * The property everything else rests on: one secret, two audiences, and
 * a token from one audience is refused by the other. The back office's
 * requireAuth also checks `purpose === "access"` itself (its verifyToken
 * only checks the signature), so a business token reaching it is
 * refused there — the last block below states that contract.
 */
const SECRET = "test-jwt-secret-value-1234567890-abcdef";
const backOffice = backOfficeTokens(SECRET);
const tenant = tenantTokens(SECRET);

const tokens = {
  backOffice: backOffice.signAccessToken("user_1", "role_1"),
  backOfficeMfaSetup: backOffice.signMfaFlowToken("user_1", "mfa_setup"),
  backOfficeMfaChallenge: backOffice.signMfaFlowToken("user_1", "mfa_challenge"),
  tenant: tenant.signAccountAccessToken("staff_1", "account_1"),
  tenantMfa: tenant.signMfaChallengeToken("staff_1"),
};

describe("verifyAccountAccessToken", () => {
  it("accepts a business access token", () => {
    expect(tenant.verifyAccountAccessToken(tokens.tenant).sub).toBe("staff_1");
  });

  it.each(["backOffice", "backOfficeMfaSetup", "backOfficeMfaChallenge", "tenantMfa"] as const)(
    "refuses a %s token",
    (kind) => {
      expect(() => tenant.verifyAccountAccessToken(tokens[kind])).toThrow();
    },
  );
});

describe("verifyMfaChallengeToken", () => {
  it.each(["backOffice", "backOfficeMfaSetup", "backOfficeMfaChallenge", "tenant"] as const)(
    "refuses a %s token",
    (kind) => {
      expect(() => tenant.verifyMfaChallengeToken(tokens[kind])).toThrow();
    },
  );
});

describe("the back office's purposes", () => {
  it("never reads a business token as one of its own", () => {
    for (const kind of ["tenant", "tenantMfa"] as const) {
      const payload = backOffice.verifyToken(tokens[kind]) as { purpose: string };
      expect(["access", "mfa_setup", "mfa_challenge"]).not.toContain(payload.purpose);
    }
  });
});

describe("a different secret", () => {
  it("is refused by both audiences", () => {
    const other = "another-secret-value-entirely-0987654321";
    expect(() => tenantTokens(other).verifyAccountAccessToken(tokens.tenant)).toThrow();
    expect(() => backOfficeTokens(other).verifyToken(tokens.backOffice)).toThrow();
  });
});
