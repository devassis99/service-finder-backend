import { describe, it, expect, vi } from "vitest";
import { chain } from "../../test/mocks/drizzle";

const { mockDb } = vi.hoisted(() => {
  function localChain(rows: unknown) {
    const p = Promise.resolve(rows) as unknown as Record<string, (...a: unknown[]) => unknown>;
    for (const m of ["from", "where", "orderBy", "values", "set", "returning", "innerJoin"]) {
      p[m] = vi.fn(() => p);
    }
    return p;
  }
  const db = {
    select: vi.fn(() => localChain([])),
    insert: vi.fn(() => localChain([])),
    update: vi.fn(() => localChain([])),
    delete: vi.fn(() => localChain([])),
  };
  return { mockDb: db };
});
vi.mock("../../db", () => ({ db: mockDb }));

import { ConflictError, ForbiddenError, NotFoundError } from "../auth";
import { listUsers, inviteUser, updateUserRole, setUserActive } from "./users.service";

function boUserRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "user_1",
    name: "Admin",
    email: "admin@example.com",
    roleId: "role_1",
    isActive: true,
    mfaEnabled: false,
    googleSub: null,
    lastLoginAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("listUsers", () => {
  it("resolves each user's role name and claimed status", async () => {
    mockDb.select.mockReturnValueOnce(
      chain([{ user: boUserRow({ googleSub: "sub_1" }), roleName: "Admin" }]),
    );

    const result = await listUsers();

    expect(result).toEqual([
      expect.objectContaining({ id: "user_1", roleName: "Admin", claimed: true }),
    ]);
  });
});

describe("inviteUser", () => {
  it("pre-provisions an unclaimed user row for the given role", async () => {
    mockDb.select
      .mockReturnValueOnce(chain([{ id: "role_1", name: "Admin" }])) // role lookup
      .mockReturnValueOnce(chain([])); // no existing user with this email
    mockDb.insert.mockReturnValueOnce(chain([boUserRow({ name: "New Admin" })]));

    const result = await inviteUser({
      email: "admin@example.com",
      name: "New Admin",
      roleId: "role_1",
    });

    expect(result).toEqual(
      expect.objectContaining({ name: "New Admin", roleName: "Admin", claimed: false }),
    );
  });

  it("throws NotFoundError when the role doesn't exist", async () => {
    mockDb.select.mockReturnValueOnce(chain([]));
    await expect(
      inviteUser({ email: "admin@example.com", name: "New Admin", roleId: "ghost" }),
    ).rejects.toThrow(NotFoundError);
  });

  it("throws ConflictError when a user with this email already exists", async () => {
    mockDb.select
      .mockReturnValueOnce(chain([{ id: "role_1", name: "Admin" }]))
      .mockReturnValueOnce(chain([boUserRow()]));

    await expect(
      inviteUser({ email: "admin@example.com", name: "Dup", roleId: "role_1" }),
    ).rejects.toThrow(ConflictError);
  });
});

describe("updateUserRole", () => {
  it("reassigns another user's role", async () => {
    mockDb.select
      .mockReturnValueOnce(chain([{ id: "role_2", name: "Manager" }])) // role lookup
      .mockReturnValueOnce(chain([boUserRow()])); // getUserOrThrow
    mockDb.update.mockReturnValueOnce(chain([boUserRow({ roleId: "role_2" })]));

    const result = await updateUserRole("user_1", "role_2", "user_admin");

    expect(result).toEqual(expect.objectContaining({ roleId: "role_2", roleName: "Manager" }));
  });

  it("throws ForbiddenError when a user tries to change their own role", async () => {
    await expect(updateUserRole("user_1", "role_2", "user_1")).rejects.toThrow(ForbiddenError);
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when the target role doesn't exist", async () => {
    mockDb.select.mockReturnValueOnce(chain([]));
    await expect(updateUserRole("user_1", "ghost", "user_admin")).rejects.toThrow(NotFoundError);
  });

  it("throws NotFoundError when the target user doesn't exist", async () => {
    mockDb.select
      .mockReturnValueOnce(chain([{ id: "role_2", name: "Manager" }]))
      .mockReturnValueOnce(chain([])); // getUserOrThrow: not found

    await expect(updateUserRole("ghost-user", "role_2", "user_admin")).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe("setUserActive", () => {
  it("deactivates another user", async () => {
    mockDb.select
      .mockReturnValueOnce(chain([boUserRow()])) // getUserOrThrow
      .mockReturnValueOnce(chain([{ id: "role_1", name: "Admin" }])); // role lookup
    mockDb.update.mockReturnValueOnce(chain([boUserRow({ isActive: false })]));

    const result = await setUserActive("user_1", false, "user_admin");

    expect(result.isActive).toBe(false);
  });

  it("throws ForbiddenError when a user tries to deactivate themselves", async () => {
    await expect(setUserActive("user_1", false, "user_1")).rejects.toThrow(ForbiddenError);
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("allows a user to reactivate their own account (only self-deactivation is blocked)", async () => {
    mockDb.select
      .mockReturnValueOnce(chain([boUserRow({ isActive: false })]))
      .mockReturnValueOnce(chain([{ id: "role_1", name: "Admin" }]));
    mockDb.update.mockReturnValueOnce(chain([boUserRow({ isActive: true })]));

    const result = await setUserActive("user_1", true, "user_1");
    expect(result.isActive).toBe(true);
  });
});
