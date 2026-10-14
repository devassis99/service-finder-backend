import { describe, it, expect, vi } from "vitest";
import { chain } from "../../test/mocks/drizzle";

const { mockDb } = vi.hoisted(() => {
  function localChain(rows: unknown) {
    const p = Promise.resolve(rows) as unknown as Record<string, (...a: unknown[]) => unknown>;
    for (const m of ["from", "where", "orderBy", "values", "innerJoin"]) {
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
import {
  listRoles,
  listPermissionsCatalog,
  createRole,
  updateRolePermissions,
  deleteRole,
} from "./roles.service";

describe("listRoles", () => {
  it("attaches each role's permission keys and user count", async () => {
    const role = { id: "role_1", name: "Admin", description: null };
    mockDb.select
      .mockReturnValueOnce(chain([role]))
      .mockReturnValueOnce(chain([{ roleId: "role_1", key: "roles.manage" }]))
      .mockReturnValueOnce(chain([{ roleId: "role_1" }, { roleId: "role_1" }]));

    const result = await listRoles();

    expect(result).toEqual([
      {
        id: "role_1",
        name: "Admin",
        description: null,
        permissions: ["roles.manage"],
        userCount: 2,
      },
    ]);
  });
});

describe("listPermissionsCatalog", () => {
  it("attaches the endpoints each permission unlocks", async () => {
    const permission = {
      id: "perm_1",
      key: "roles.manage",
      name: "Manage roles",
      description: null,
    };
    mockDb.select.mockReturnValueOnce(chain([permission])).mockReturnValueOnce(
      chain([
        {
          permissionId: "perm_1",
          method: "POST",
          path: "/roles",
          name: "Create role",
        },
      ]),
    );

    const result = await listPermissionsCatalog();

    expect(result).toEqual([
      {
        key: "roles.manage",
        name: "Manage roles",
        description: null,
        endpoints: [{ method: "POST", path: "/roles", name: "Create role" }],
      },
    ]);
  });
});

describe("createRole", () => {
  it("creates a role with the resolved permission set", async () => {
    mockDb.select
      .mockReturnValueOnce(chain([])) // no existing role with this name
      .mockReturnValueOnce(chain([{ id: "perm_1", key: "roles.manage" }])); // resolvePermissionIds
    mockDb.insert.mockReturnValueOnce(
      chain([{ id: "role_new", name: "Manager", description: undefined }]),
    );

    const result = await createRole({ name: "Manager", permissionKeys: ["roles.manage"] });

    expect(result).toEqual({
      id: "role_new",
      name: "Manager",
      description: undefined,
      permissions: ["roles.manage"],
      userCount: 0,
    });
  });

  it("throws ConflictError when a role with this name already exists", async () => {
    mockDb.select.mockReturnValueOnce(chain([{ id: "role_existing" }]));
    await expect(createRole({ name: "Manager", permissionKeys: [] })).rejects.toThrow(
      ConflictError,
    );
  });

  it("throws NotFoundError when a requested permission key doesn't exist", async () => {
    mockDb.select
      .mockReturnValueOnce(chain([])) // no existing role
      .mockReturnValueOnce(chain([{ id: "perm_1", key: "roles.manage" }])); // only 1 of 2 keys resolved

    await expect(
      createRole({ name: "Manager", permissionKeys: ["roles.manage", "ghost.permission"] }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("updateRolePermissions", () => {
  it("replaces the role's entire permission set and reports the current user count", async () => {
    mockDb.select
      .mockReturnValueOnce(chain([{ id: "role_1", name: "Manager", description: null }]))
      .mockReturnValueOnce(chain([{ id: "perm_2", key: "users.manage" }]))
      .mockReturnValueOnce(chain([{ id: "staff_1" }]));

    const result = await updateRolePermissions("role_1", ["users.manage"]);

    expect(result).toEqual({
      id: "role_1",
      name: "Manager",
      description: null,
      permissions: ["users.manage"],
      userCount: 1,
    });
    expect(mockDb.delete).toHaveBeenCalled(); // old permission rows cleared first
  });

  it("throws NotFoundError when the role doesn't exist", async () => {
    mockDb.select.mockReturnValueOnce(chain([]));
    await expect(updateRolePermissions("ghost", [])).rejects.toThrow(NotFoundError);
  });
});

describe("deleteRole", () => {
  it("deletes a role with no assigned users", async () => {
    mockDb.select
      .mockReturnValueOnce(chain([{ id: "role_1", name: "Manager" }]))
      .mockReturnValueOnce(chain([])); // no users on this role

    await deleteRole("role_1");

    expect(mockDb.delete).toHaveBeenCalledTimes(2); // role_permissions, then the role itself
  });

  it("throws ForbiddenError for the superadmin role", async () => {
    mockDb.select.mockReturnValueOnce(chain([{ id: "role_1", name: "superadmin" }]));
    await expect(deleteRole("role_1")).rejects.toThrow(ForbiddenError);
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it("throws ConflictError when users are still assigned to the role", async () => {
    mockDb.select
      .mockReturnValueOnce(chain([{ id: "role_1", name: "Manager" }]))
      .mockReturnValueOnce(chain([{ id: "staff_1" }]));

    await expect(deleteRole("role_1")).rejects.toThrow(ConflictError);
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when the role doesn't exist", async () => {
    mockDb.select.mockReturnValueOnce(chain([]));
    await expect(deleteRole("ghost")).rejects.toThrow(NotFoundError);
  });
});
