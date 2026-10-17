import { describe, it, expect } from "vitest";
import jwt from "jsonwebtoken";
import { tenantTokens } from "./tenant";

const SECRET = "test-jwt-secret-value-1234567890-abcdef";
const {
  signAccountAccessToken,
  verifyAccountAccessToken,
  signMfaChallengeToken,
  verifyMfaChallengeToken,
} = tenantTokens(SECRET);

describe("signAccountAccessToken / verifyAccountAccessToken", () => {
  it("round-trips staffUserId and accountId", () => {
    const token = signAccountAccessToken("staff_1", "account_1");
    expect(verifyAccountAccessToken(token)).toMatchObject({
      sub: "staff_1",
      accountId: "account_1",
      purpose: "tenant_access",
    });
  });

  it("rejects an expired token", () => {
    const expired = jwt.sign(
      { sub: "staff_1", accountId: "account_1", purpose: "tenant_access" },
      SECRET,
      { expiresIn: -10 },
    );
    expect(() => verifyAccountAccessToken(expired)).toThrow();
  });

  it("rejects a token signed with a different secret", () => {
    const forged = jwt.sign(
      { sub: "staff_1", accountId: "account_1", purpose: "tenant_access" },
      "a-completely-different-secret-value",
      { expiresIn: "15m" },
    );
    expect(() => verifyAccountAccessToken(forged)).toThrow();
  });

  it("rejects the MFA challenge token — it proves a password, not a session", () => {
    expect(() => verifyAccountAccessToken(signMfaChallengeToken("staff_1"))).toThrow();
  });
});

describe("signMfaChallengeToken / verifyMfaChallengeToken", () => {
  it("round-trips the staff user", () => {
    expect(verifyMfaChallengeToken(signMfaChallengeToken("staff_1"))).toMatchObject({
      sub: "staff_1",
      purpose: "tenant_mfa_challenge",
    });
  });

  it("rejects an access token", () => {
    expect(() => verifyMfaChallengeToken(signAccountAccessToken("staff_1", "account_1"))).toThrow();
  });
});
