import { describe, it, expect, vi } from "vitest";
import { chain } from "../../test/mocks/drizzle";

// --- db mock -----------------------------------------------------------
// Self-contained on purpose (can't reference the shared ../../test/mocks
// import from inside vi.mock's factory — Vitest hoists vi.mock above the
// rest of the file). Every method defaults to resolving [] via a local
// chain; tests override specific calls with mockReturnValueOnce(chain(rows))
// in the order accounts.service.ts issues them.
const { mockDb, mockTx } = vi.hoisted(() => {
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
  const tx = makeClient();
  const primary = {
    ...makeClient(),
    transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
  };
  const db = { ...makeClient(), $primary: primary };
  return { mockDb: db, mockTx: tx };
});
vi.mock("../../db", () => ({ db: mockDb }));

// Role seeding is a collaborator, not the subject: it walks the whole
// permission catalog through the same tx, which would swallow the insert
// queue meant for the business and its owner.
vi.mock("../staff-roles/staff-roles.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../staff-roles/staff-roles.service")>()),
  seedDefaultRolesForAccount: vi.fn(async () => "role_owner"),
  getStaffRolePermissionKeys: vi.fn(async () => ["staff.view"]),
}));

const { mockVerifyGoogleIdToken } = vi.hoisted(() => ({ mockVerifyGoogleIdToken: vi.fn() }));
vi.mock("../auth/google", () => ({ verifyGoogleIdToken: mockVerifyGoogleIdToken }));

import { verifyAccountAccessToken, verifyMfaChallengeToken } from "./jwt";
import { hashPassword } from "./password";
import {
  AuthError,
  ConflictError,
  getMeDetails,
  login,
  loginWithGoogle,
  refreshSession,
  signup,
} from "./accounts.service";

const now = new Date("2026-10-01T10:00:00Z");

async function staffUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "staff_1",
    accountId: "acct_1",
    name: "Amara Okafor",
    email: "amara@brightfix.com",
    passwordHash: await hashPassword("correct-password"),
    googleSub: null as string | null,
    roleId: "role_owner",
    isActive: true,
    lastLoginAt: null,
    mfaEnabled: false,
    mfaSecret: null,
    mfaVerifiedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const googleIdentity = {
  googleSub: "google_1",
  email: "Amara@BrightFix.com",
  emailVerified: true,
  name: "Amara Okafor",
};

describe("login", () => {
  it("signs someone in and hands back a business-app session", async () => {
    mockDb.$primary.select.mockReturnValueOnce(chain([await staffUser()]));

    const outcome = await login("amara@brightfix.com", "correct-password");

    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(verifyAccountAccessToken(outcome.accessToken)).toMatchObject({
      sub: "staff_1",
      accountId: "acct_1",
    });
    expect(mockDb.insert).toHaveBeenCalledOnce(); // the refresh token row
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    mockDb.$primary.select.mockReturnValueOnce(chain([await staffUser()]));
    await expect(login("amara@brightfix.com", "wrong-password")).rejects.toThrow(
      new AuthError("Invalid email or password"),
    );

    mockDb.$primary.select.mockReturnValueOnce(chain([]));
    await expect(login("nobody@brightfix.com", "anything")).rejects.toThrow(
      new AuthError("Invalid email or password"),
    );
  });

  it("refuses someone with no password at all (Google-only, or not set up yet)", async () => {
    mockDb.$primary.select.mockReturnValueOnce(chain([await staffUser({ passwordHash: null })]));
    await expect(login("amara@brightfix.com", "")).rejects.toBeInstanceOf(AuthError);
  });

  it("refuses a deactivated member even with the right password", async () => {
    mockDb.$primary.select.mockReturnValueOnce(chain([await staffUser({ isActive: false })]));
    await expect(login("amara@brightfix.com", "correct-password")).rejects.toThrow("deactivated");
  });

  it("stops at a two-factor challenge, with no session yet, when 2FA is on", async () => {
    mockDb.$primary.select.mockReturnValueOnce(chain([await staffUser({ mfaEnabled: true })]));

    const outcome = await login("amara@brightfix.com", "correct-password");

    expect(outcome.status).toBe("mfa_challenge_required");
    if (outcome.status !== "mfa_challenge_required") return;
    expect(verifyMfaChallengeToken(outcome.challengeToken).sub).toBe("staff_1");
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled(); // lastLoginAt waits for the code
  });
});

describe("loginWithGoogle", () => {
  it('answers "no_account" for a Google identity nobody has — sign-up carries on from there', async () => {
    mockVerifyGoogleIdToken.mockResolvedValueOnce(googleIdentity);
    mockDb.$primary.select.mockReturnValueOnce(chain([])).mockReturnValueOnce(chain([]));

    expect(await loginWithGoogle("id-token")).toEqual({
      status: "no_account",
      email: "amara@brightfix.com",
      name: "Amara Okafor",
    });
  });

  it("links Google to a member found by email, then signs them in", async () => {
    mockVerifyGoogleIdToken.mockResolvedValueOnce(googleIdentity);
    const pending = await staffUser();
    mockDb.$primary.select.mockReturnValueOnce(chain([])).mockReturnValueOnce(chain([pending]));
    mockDb.update
      .mockReturnValueOnce(chain([{ ...pending, googleSub: "google_1" }]))
      .mockReturnValueOnce(chain([]));

    const outcome = await loginWithGoogle("id-token");
    expect(outcome.status).toBe("ok");
  });

  it("refuses to re-bind a member already linked to a different Google account", async () => {
    mockVerifyGoogleIdToken.mockResolvedValueOnce(googleIdentity);
    mockDb.$primary.select
      .mockReturnValueOnce(chain([]))
      .mockReturnValueOnce(chain([await staffUser({ googleSub: "google_other" })]));

    await expect(loginWithGoogle("id-token")).rejects.toThrow("different Google sign-in");
  });

  it("turns a token Google rejects into a 401, not a 500", async () => {
    mockVerifyGoogleIdToken.mockRejectedValueOnce(new Error("Token used too late"));
    await expect(loginWithGoogle("id-token")).rejects.toBeInstanceOf(AuthError);
  });

  it("refuses an unverified Google email", async () => {
    mockVerifyGoogleIdToken.mockResolvedValueOnce({ ...googleIdentity, emailVerified: false });
    await expect(loginWithGoogle("id-token")).rejects.toThrow("not verified");
  });
});

describe("refreshSession", () => {
  it("refuses a token the conditional update didn't match — used, revoked, expired or unknown", async () => {
    mockDb.update.mockReturnValueOnce(chain([]));
    await expect(refreshSession("stale")).rejects.toThrow("invalid or expired");
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("refuses to renew a deactivated member's session", async () => {
    mockDb.update.mockReturnValueOnce(chain([{ id: "rt_1", staffUserId: "staff_1" }]));
    mockDb.$primary.select.mockReturnValueOnce(chain([await staffUser({ isActive: false })]));
    await expect(refreshSession("live")).rejects.toBeInstanceOf(AuthError);
  });

  it("issues a new pair once the old token is retired", async () => {
    mockDb.update.mockReturnValueOnce(chain([{ id: "rt_1", staffUserId: "staff_1" }]));
    mockDb.$primary.select.mockReturnValueOnce(chain([await staffUser()]));

    const tokens = await refreshSession("live");
    expect(tokens.refreshToken).toMatch(/^[0-9a-f]{64}$/);
    expect(mockDb.insert).toHaveBeenCalledOnce();
  });
});

describe("signup", () => {
  const input = {
    fullName: "Amara Okafor",
    workEmail: "amara@brightfix.com",
    password: "a-long-password",
    businessName: "BrightFix Repairs",
  };

  it("creates the business, its roles and its owner together, and signs the owner in", async () => {
    mockTx.insert
      .mockReturnValueOnce(chain([{ id: "acct_1" }]))
      .mockReturnValueOnce(chain([await staffUser()]));

    const tokens = await signup(input);

    expect(mockDb.$primary.transaction).toHaveBeenCalledOnce();
    const accountValues = mockTx.insert.mock.results[0]!.value.values.mock.calls[0][0];
    expect(accountValues).toMatchObject({ name: "BrightFix Repairs", slug: "brightfix-repairs" });
    const ownerValues = mockTx.insert.mock.results[1]!.value.values.mock.calls[0][0];
    expect(ownerValues).toMatchObject({ accountId: "acct_1", roleId: "role_owner" });
    expect(ownerValues.passwordHash).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    expect(verifyAccountAccessToken(tokens.accessToken).accountId).toBe("acct_1");
  });

  it("refuses an email that already signs in somewhere", async () => {
    mockDb.$primary.select.mockReturnValueOnce(chain([{ id: "staff_9" }]));
    await expect(signup(input)).rejects.toBeInstanceOf(ConflictError);
    expect(mockDb.$primary.transaction).not.toHaveBeenCalled();
  });

  it("refuses a Google token whose email isn't the work email given", async () => {
    mockVerifyGoogleIdToken.mockResolvedValueOnce({ ...googleIdentity, email: "someone@else.com" });
    await expect(
      signup({ ...input, password: undefined, googleIdToken: "id-token" }),
    ).rejects.toThrow("does not match");
  });

  it("binds the Google identity when the emails match, whatever their case", async () => {
    mockVerifyGoogleIdToken.mockResolvedValueOnce(googleIdentity);
    mockTx.insert
      .mockReturnValueOnce(chain([{ id: "acct_1" }]))
      .mockReturnValueOnce(chain([await staffUser({ googleSub: "google_1", passwordHash: null })]));

    await signup({ ...input, password: undefined, googleIdToken: "id-token" });

    const ownerValues = mockTx.insert.mock.results[1]!.value.values.mock.calls[0][0];
    expect(ownerValues).toMatchObject({ googleSub: "google_1", passwordHash: undefined });
  });
});

describe("getMeDetails", () => {
  it("describes the caller without their password hash, Google id or 2FA secret", async () => {
    mockDb.$primary.select
      .mockReturnValueOnce(chain([await staffUser({ mfaSecret: "secret" })]))
      .mockReturnValueOnce(
        chain([
          {
            id: "acct_1",
            name: "BrightFix Repairs",
            slug: "brightfix-repairs",
            email: "amara@brightfix.com",
            phone: null,
            createdAt: now,
          },
        ]),
      )
      .mockReturnValueOnce(chain([{ name: "Owner", isSystem: true }]));

    const me = await getMeDetails("staff_1");

    expect(me?.staffUser).toMatchObject({ roleName: "Owner", isOwner: true, hasPassword: true });
    expect(me?.permissions).toEqual(["staff.view"]);
    expect(JSON.stringify(me)).not.toMatch(/passwordHash|mfaSecret|googleSub|secret/);
  });
});
