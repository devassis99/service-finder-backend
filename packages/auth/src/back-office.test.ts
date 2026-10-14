import { describe, it, expect } from "vitest";
import jwt from "jsonwebtoken";
import { backOfficeTokens } from "./back-office";
import { tokenExpiresAt } from "./expiry";

const SECRET = "test-jwt-secret-value-1234567890-abcdef";
const { signAccessToken, signMfaFlowToken, verifyToken } = backOfficeTokens(SECRET);

describe("signAccessToken / verifyToken", () => {
  it("round-trips userId and roleId with purpose access", () => {
    const token = signAccessToken("user_1", "role_1");
    const payload = verifyToken(token);
    expect(payload).toMatchObject({ sub: "user_1", roleId: "role_1", purpose: "access" });
  });
});

describe("signMfaFlowToken / verifyToken", () => {
  it("round-trips a mfa_setup flow token", () => {
    const token = signMfaFlowToken("user_1", "mfa_setup");
    expect(verifyToken(token)).toMatchObject({ sub: "user_1", purpose: "mfa_setup" });
  });

  it("round-trips a mfa_challenge flow token", () => {
    const token = signMfaFlowToken("user_1", "mfa_challenge");
    expect(verifyToken(token)).toMatchObject({ sub: "user_1", purpose: "mfa_challenge" });
  });

  it("rejects an expired token", () => {
    const expired = jwt.sign({ sub: "user_1", purpose: "mfa_setup" }, SECRET, {
      expiresIn: -10,
    });
    expect(() => verifyToken(expired)).toThrow();
  });

  it("rejects a token signed with a different secret", () => {
    const forged = jwt.sign(
      { sub: "user_1", roleId: "role_1", purpose: "access" },
      "a-completely-different-secret-value",
      { expiresIn: "15m" },
    );
    expect(() => verifyToken(forged)).toThrow();
  });
});

describe("tokenExpiresAt", () => {
  it("reads when a verified access token runs out", () => {
    const expiresAt = tokenExpiresAt(signAccessToken("user_1", "role_1"));
    expect(expiresAt).not.toBeNull();
    // Back-office access tokens last 15 minutes.
    expect(expiresAt! - Date.now()).toBeGreaterThan(14 * 60_000);
    expect(expiresAt! - Date.now()).toBeLessThanOrEqual(15 * 60_000);
  });

  it("answers null for something that isn't a token", () => {
    expect(tokenExpiresAt("not-a-token")).toBeNull();
  });
});
