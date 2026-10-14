import { describe, it, expect, vi } from "vitest";
import { chain } from "../../test/mocks/drizzle";

// --- db mock (self-contained — see accounts.service.test.ts) -----------
const { mockDb } = vi.hoisted(() => {
  function localChain(rows: unknown) {
    const p = Promise.resolve(rows) as unknown as Record<string, (...a: unknown[]) => unknown>;
    for (const m of ["from", "where", "orderBy", "values", "set", "returning", "innerJoin"]) {
      p[m] = vi.fn(() => p);
    }
    return p;
  }
  function makeClient() {
    return {
      select: vi.fn(() => localChain([])),
      insert: vi.fn(() => localChain([])),
      update: vi.fn(() => localChain([])),
      delete: vi.fn(() => localChain([])),
    };
  }
  const db = makeClient() as ReturnType<typeof makeClient> & {
    $primary: ReturnType<typeof makeClient>;
  };
  db.$primary = makeClient();
  return { mockDb: db };
});
vi.mock("../../db", () => ({ db: mockDb }));

// --- google mock (network-dependent, mocked like every other service) ---
const { mockVerifyGoogleIdToken } = vi.hoisted(() => ({ mockVerifyGoogleIdToken: vi.fn() }));
vi.mock("./google", () => ({ verifyGoogleIdToken: mockVerifyGoogleIdToken }));

// --- mfa mock -------------------------------------------------------------
// mfa.ts has its own dedicated unit tests (mfa.test.ts) covering the real
// crypto/TOTP logic; mocking it here keeps auth.service tests focused on
// this module's own orchestration (call order, error handling) rather than
// re-verifying TOTP math on every login/setup test.
const { mockMfa } = vi.hoisted(() => ({
  mockMfa: {
    encryptMfaSecret: vi.fn((s: string) => `encrypted(${s})`),
    decryptMfaSecret: vi.fn((s: string) => s.replace(/^encrypted\(|\)$/g, "")),
    generateTotpSecret: vi.fn(() => "TOTP_SECRET"),
    buildOtpAuthUrl: vi.fn(async () => "otpauth://totp/test"),
    generateQrCodeDataUrl: vi.fn(async () => "data:image/png;base64,fake"),
    verifyTotpCode: vi.fn(async () => true),
  },
}));
vi.mock("./mfa", () => mockMfa);

// jwt.ts is intentionally left unmocked — it's pure (env.JWT_SECRET is set
// by vitest.config.ts) and tests below need to mint real flow tokens to
// feed into beginMfaSetup/completeMfaSetup/verifyMfaChallenge.
import { signMfaFlowToken, verifyToken } from "./jwt";
import {
  AuthError,
  ForbiddenError,
  loginWithGoogle,
  beginMfaSetup,
  completeMfaSetup,
  verifyMfaChallenge,
  requestMfaReset,
  refreshSession,
  logout,
  getMeDetails,
} from "./auth.service";

const boUser = {
  id: "user_1",
  roleId: "role_1",
  email: "admin@example.com",
  name: "Admin",
  isActive: true,
  mfaEnabled: false,
  mfaSecret: null as string | null,
};

describe("loginWithGoogle", () => {
  it("routes an existing MFA-less user to mfa_setup_required", async () => {
    mockVerifyGoogleIdToken.mockResolvedValueOnce({
      googleSub: "sub_1",
      email: boUser.email,
      emailVerified: true,
    });
    mockDb.$primary.select.mockReturnValueOnce(chain([{ ...boUser, mfaEnabled: false }]));

    const outcome = await loginWithGoogle("id-token");
    expect(outcome).toEqual(
      expect.objectContaining({ status: "mfa_setup_required", setupToken: expect.any(String) }),
    );
  });

  it("routes an existing MFA-enabled user to mfa_challenge_required", async () => {
    mockVerifyGoogleIdToken.mockResolvedValueOnce({
      googleSub: "sub_1",
      email: boUser.email,
      emailVerified: true,
    });
    mockDb.$primary.select.mockReturnValueOnce(chain([{ ...boUser, mfaEnabled: true }]));

    const outcome = await loginWithGoogle("id-token");
    expect(outcome).toEqual(
      expect.objectContaining({
        status: "mfa_challenge_required",
        challengeToken: expect.any(String),
      }),
    );
  });

  it("throws AuthError when no back-office account exists for this Google identity at all", async () => {
    mockVerifyGoogleIdToken.mockResolvedValueOnce({
      googleSub: "sub_new",
      email: "nobody@example.com",
      emailVerified: true,
    });
    mockDb.$primary.select
      .mockReturnValueOnce(chain([])) // by googleSub
      .mockReturnValueOnce(chain([])); // by email

    await expect(loginWithGoogle("id-token")).rejects.toThrow(AuthError);
  });

  it("throws AuthError when the matching account is already linked to a different Google identity", async () => {
    mockVerifyGoogleIdToken.mockResolvedValueOnce({
      googleSub: "sub_b",
      email: boUser.email,
      emailVerified: true,
    });
    mockDb.$primary.select
      .mockReturnValueOnce(chain([])) // by googleSub
      .mockReturnValueOnce(chain([{ ...boUser, googleSub: "sub_a" }])); // by email, claimed by someone else

    await expect(loginWithGoogle("id-token")).rejects.toThrow(AuthError);
  });

  it("throws AuthError (401), not a bare Error (500), for a token Google refuses", async () => {
    mockVerifyGoogleIdToken.mockRejectedValueOnce(new Error("Token used too late"));
    await expect(loginWithGoogle("expired-token")).rejects.toThrow(AuthError);
    expect(mockDb.$primary.select).not.toHaveBeenCalled();
  });

  it("lets a failure to reach Google's signing keys through as our own error", async () => {
    const outage = new Error("Failed to retrieve verification certificates: ECONNRESET");
    mockVerifyGoogleIdToken.mockRejectedValueOnce(outage);
    await expect(loginWithGoogle("id-token")).rejects.toBe(outage);
  });

  it("throws AuthError when Google reports the email as unverified", async () => {
    mockVerifyGoogleIdToken.mockResolvedValueOnce({
      googleSub: "sub_1",
      email: boUser.email,
      emailVerified: false,
    });
    await expect(loginWithGoogle("id-token")).rejects.toThrow(AuthError);
    expect(mockDb.$primary.select).not.toHaveBeenCalled();
  });
});

describe("beginMfaSetup", () => {
  it("generates a TOTP secret and QR code for a user who hasn't enrolled yet", async () => {
    const setupToken = signMfaFlowToken("user_1", "mfa_setup");
    mockDb.$primary.select.mockReturnValueOnce(chain([{ ...boUser, mfaEnabled: false }]));

    const result = await beginMfaSetup(setupToken);

    expect(result).toEqual({
      otpAuthUrl: "otpauth://totp/test",
      qrCodeDataUrl: "data:image/png;base64,fake",
    });
    expect(mockMfa.generateTotpSecret).toHaveBeenCalled();
  });

  it("throws AuthError when MFA is already enabled", async () => {
    const setupToken = signMfaFlowToken("user_1", "mfa_setup");
    mockDb.$primary.select.mockReturnValueOnce(chain([{ ...boUser, mfaEnabled: true }]));

    await expect(beginMfaSetup(setupToken)).rejects.toThrow(AuthError);
  });

  it("throws AuthError when the account no longer exists", async () => {
    const setupToken = signMfaFlowToken("user_1", "mfa_setup");
    mockDb.$primary.select.mockReturnValueOnce(chain([]));

    await expect(beginMfaSetup(setupToken)).rejects.toThrow(AuthError);
  });

  it("throws AuthError for a token with the wrong purpose", async () => {
    const challengeToken = signMfaFlowToken("user_1", "mfa_challenge");
    await expect(beginMfaSetup(challengeToken)).rejects.toThrow(AuthError);
  });
});

describe("completeMfaSetup", () => {
  it("enables MFA and issues a session when the code is correct", async () => {
    const setupToken = signMfaFlowToken("user_1", "mfa_setup");
    mockDb.$primary.select.mockReturnValueOnce(
      chain([{ ...boUser, mfaSecret: "encrypted(TOTP_SECRET)" }]),
    );
    mockDb.update.mockReturnValueOnce(
      chain([{ ...boUser, mfaEnabled: true, mfaSecret: "encrypted(TOTP_SECRET)" }]),
    );
    mockMfa.verifyTotpCode.mockResolvedValueOnce(true);

    const result = await completeMfaSetup(setupToken, "123456");

    expect(result).toHaveProperty("accessToken");
    expect(result).toHaveProperty("refreshToken");
  });

  it("throws AuthError for an incorrect code", async () => {
    const setupToken = signMfaFlowToken("user_1", "mfa_setup");
    mockDb.$primary.select.mockReturnValueOnce(
      chain([{ ...boUser, mfaSecret: "encrypted(TOTP_SECRET)" }]),
    );
    mockMfa.verifyTotpCode.mockResolvedValueOnce(false);

    await expect(completeMfaSetup(setupToken, "000000")).rejects.toThrow(AuthError);
  });

  it("throws AuthError when setup was never started", async () => {
    const setupToken = signMfaFlowToken("user_1", "mfa_setup");
    mockDb.$primary.select.mockReturnValueOnce(chain([{ ...boUser, mfaSecret: null }]));

    await expect(completeMfaSetup(setupToken, "123456")).rejects.toThrow(AuthError);
  });
});

describe("verifyMfaChallenge", () => {
  it("issues a session for a correct TOTP code", async () => {
    const challengeToken = signMfaFlowToken("user_1", "mfa_challenge");
    mockDb.$primary.select.mockReturnValueOnce(
      chain([{ ...boUser, mfaEnabled: true, mfaSecret: "encrypted(TOTP_SECRET)" }]),
    );
    mockMfa.verifyTotpCode.mockResolvedValueOnce(true);

    const result = await verifyMfaChallenge(challengeToken, "123456");
    expect(result).toHaveProperty("accessToken");
  });

  it("throws AuthError for an incorrect TOTP code", async () => {
    const challengeToken = signMfaFlowToken("user_1", "mfa_challenge");
    mockDb.$primary.select.mockReturnValueOnce(
      chain([{ ...boUser, mfaEnabled: true, mfaSecret: "encrypted(TOTP_SECRET)" }]),
    );
    mockMfa.verifyTotpCode.mockResolvedValueOnce(false);

    await expect(verifyMfaChallenge(challengeToken, "000000")).rejects.toThrow(AuthError);
  });

  it("throws AuthError when MFA was never set up for this account", async () => {
    const challengeToken = signMfaFlowToken("user_1", "mfa_challenge");
    mockDb.$primary.select.mockReturnValueOnce(chain([{ ...boUser, mfaSecret: null }]));

    await expect(verifyMfaChallenge(challengeToken, "123456")).rejects.toThrow(AuthError);
  });
});

describe("requestMfaReset", () => {
  it("requires the current code when an MFA secret is already set", async () => {
    mockDb.$primary.select.mockReturnValueOnce(
      chain([{ ...boUser, mfaSecret: "encrypted(TOTP_SECRET)" }]),
    );
    await expect(requestMfaReset("user_1")).rejects.toThrow(AuthError);
  });

  it("clears MFA and returns a fresh setup token given a valid current code", async () => {
    mockDb.$primary.select.mockReturnValueOnce(
      chain([{ ...boUser, mfaSecret: "encrypted(TOTP_SECRET)" }]),
    );
    mockMfa.verifyTotpCode.mockResolvedValueOnce(true);

    const result = await requestMfaReset("user_1", "123456");

    expect(verifyToken(result.setupToken)).toEqual(
      expect.objectContaining({ sub: "user_1", purpose: "mfa_setup" }),
    );
    expect(mockDb.update).toHaveBeenCalled();
  });

  it("skips the code check when a reset is already mid-flight (no secret left to check)", async () => {
    mockDb.$primary.select.mockReturnValueOnce(chain([{ ...boUser, mfaSecret: null }]));

    const result = await requestMfaReset("user_1");
    expect(result).toHaveProperty("setupToken");
  });

  it("throws AuthError when the account no longer exists", async () => {
    mockDb.$primary.select.mockReturnValueOnce(chain([]));
    await expect(requestMfaReset("ghost")).rejects.toThrow(AuthError);
  });
});

describe("refreshSession", () => {
  it("rotates a valid refresh token", async () => {
    const stored = {
      id: "rt_1",
      userId: "user_1",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    };
    mockDb.$primary.select
      .mockReturnValueOnce(chain([stored]))
      .mockReturnValueOnce(chain([boUser]));

    const result = await refreshSession("token");
    expect(result).toHaveProperty("accessToken");
  });

  it("throws AuthError for an expired refresh token", async () => {
    const stored = {
      id: "rt_1",
      userId: "user_1",
      revokedAt: null,
      expiresAt: new Date(Date.now() - 60_000),
    };
    mockDb.$primary.select.mockReturnValueOnce(chain([stored]));
    await expect(refreshSession("expired")).rejects.toThrow(AuthError);
  });
});

describe("logout", () => {
  it("revokes the refresh token", async () => {
    await logout("token");
    expect(mockDb.update).toHaveBeenCalled();
  });
});

describe("getMeDetails", () => {
  it("returns null once the user no longer exists", async () => {
    mockDb.select.mockReturnValueOnce(chain([]));
    expect(await getMeDetails("ghost")).toBeNull();
  });

  it("returns the trimmed user, role, and permission keys", async () => {
    const role = { id: "role_1", name: "Admin" };
    mockDb.select
      .mockReturnValueOnce(chain([boUser])) // getUserById
      .mockReturnValueOnce(chain([role])) // role lookup
      .mockReturnValueOnce(chain([{ key: "plans.manage" }, { key: "users.manage" }])); // permission keys

    const result = await getMeDetails("user_1");

    expect(result).toEqual({
      user: { id: "user_1", roleId: "role_1", email: boUser.email, mfaEnabled: false },
      role: { id: "role_1", name: "Admin" },
      permissions: ["plans.manage", "users.manage"],
    });
  });
});

// ForbiddenError is exported for other modules (users/roles) to throw and
// for error-handler.ts to map to 403 — nothing in this file throws it
// directly, so just guard the export exists and behaves like a normal Error.
describe("ForbiddenError", () => {
  it("carries its message and name", () => {
    const err = new ForbiddenError("nope");
    expect(err.message).toBe("nope");
    expect(err.name).toBe("ForbiddenError");
  });
});
