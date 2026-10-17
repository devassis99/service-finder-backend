import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextFunction, Request, Response } from "express";

const { getStaffUserById, bumpAccountData } = vi.hoisted(() => ({
  getStaffUserById: vi.fn(),
  bumpAccountData: vi.fn(async () => {}),
}));

// The cache itself is tested in account-cache.test.ts; here it passes
// straight through to the loader, and the bump is watched.
vi.mock("../account-cache", () => ({
  cachedForAccount: (_accountId: string, _name: string, _ttl: number, load: () => unknown) =>
    load(),
  bumpAccountData,
}));
vi.mock("../../db", () => ({ db: {} }));
vi.mock("../../modules/accounts/accounts.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../modules/accounts/accounts.service")>()),
  getStaffUserById,
}));

// jwt is left real: these tests mint genuine tokens of each audience, so
// "a back-office token is refused here" is checked against the real
// purpose claim rather than a mock's say-so.
import { signAccountAccessToken, signMfaChallengeToken } from "../../modules/accounts/jwt";
import { signAccessToken } from "../../modules/auth/jwt";
import { AuthError } from "../../modules/accounts/accounts.service";
import { requireAccountAuth } from "./require-account-auth.middleware";

function makeReq(method: string, token?: string): Request {
  return {
    method,
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  } as unknown as Request;
}

function makeRes(statusCode = 200) {
  const end = vi.fn();
  return { res: { statusCode, end } as unknown as Response, end };
}

const activeStaff = () => ({
  id: "staff_1",
  accountId: "acct_1",
  roleId: "role_1",
  email: "ray@business.test",
  isActive: true,
  passwordHash: "never-leaves-the-database",
});

const sessionToken = () => signAccountAccessToken("staff_1", "acct_1");

async function rejection(req: Request) {
  const next = vi.fn() as unknown as NextFunction;
  const error = await requireAccountAuth(req, makeRes().res, next).then(
    () => null,
    (e: unknown) => e,
  );
  expect(next).not.toHaveBeenCalled();
  return error;
}

beforeEach(() => {
  getStaffUserById.mockResolvedValue(activeStaff());
});

describe("requireAccountAuth", () => {
  it("attaches the member — and only the fields a route needs", async () => {
    const req = makeReq("GET", sessionToken());
    const next = vi.fn() as unknown as NextFunction;
    await requireAccountAuth(req, makeRes().res, next);

    expect(req.staffUser).toEqual({
      id: "staff_1",
      accountId: "acct_1",
      roleId: "role_1",
      email: "ray@business.test",
    });
    expect(next).toHaveBeenCalledOnce();
  });

  it.each([
    ["no Authorization header", () => makeReq("GET")],
    ["a garbage token", () => makeReq("GET", "not-a-jwt")],
    ["a back-office access token", () => makeReq("GET", signAccessToken("staff_1", "role_1"))],
    ["a two-factor challenge token", () => makeReq("GET", signMfaChallengeToken("staff_1"))],
  ])("refuses %s, marked TOKEN_INVALID", async (_label, req) => {
    const error = await rejection(req());
    expect(error).toBeInstanceOf(AuthError);
    expect((error as AuthError).code).toBe("TOKEN_INVALID");
  });

  it("refuses a deactivated member's still-unexpired token", async () => {
    getStaffUserById.mockResolvedValue({ ...activeStaff(), isActive: false });
    const error = await rejection(makeReq("GET", sessionToken()));
    expect((error as AuthError).code).toBe("TOKEN_INVALID");
  });

  it("refuses a token naming a different business than its member's", async () => {
    getStaffUserById.mockResolvedValue({ ...activeStaff(), accountId: "acct_other" });
    expect(await rejection(makeReq("GET", sessionToken()))).toBeInstanceOf(AuthError);
  });

  it("refuses a token for a member who no longer exists", async () => {
    getStaffUserById.mockResolvedValue(undefined);
    expect(await rejection(makeReq("GET", sessionToken()))).toBeInstanceOf(AuthError);
  });

  it("marks the business's cached data out of date before a successful change's response goes out", async () => {
    const { res, end } = makeRes(200);
    await requireAccountAuth(
      makeReq("PATCH", sessionToken()),
      res,
      vi.fn() as unknown as NextFunction,
    );

    res.end("done");
    expect(bumpAccountData).toHaveBeenCalledWith("acct_1");
    expect(end).not.toHaveBeenCalled(); // held until the bump lands
    await vi.waitFor(() => expect(end).toHaveBeenCalledWith("done"));
  });

  it("leaves the cache alone when the change failed, or was only a read", async () => {
    const failed = makeRes(422);
    await requireAccountAuth(
      makeReq("POST", sessionToken()),
      failed.res,
      vi.fn() as unknown as NextFunction,
    );
    failed.res.end();
    expect(failed.end).toHaveBeenCalledOnce();

    const read = makeRes(200);
    await requireAccountAuth(
      makeReq("GET", sessionToken()),
      read.res,
      vi.fn() as unknown as NextFunction,
    );
    read.res.end();
    expect(read.end).toHaveBeenCalledOnce();

    expect(bumpAccountData).not.toHaveBeenCalled();
  });
});
