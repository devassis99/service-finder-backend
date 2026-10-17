import { describe, it, expect, vi } from "vitest";

vi.mock("../../db", () => ({ db: {} }));

import {
  DEFAULT_PERMISSIONS,
  ForbiddenError,
  assertCovers,
  type Authority,
} from "./staff-roles.service";

const owner: Authority = { isOwner: true, permissions: new Set() };
const manager: Authority = {
  isOwner: false,
  permissions: new Set(["staff.view", "staff.manage", "roles.view"]),
};

describe("assertCovers — what a caller may hand out or reach", () => {
  it("lets an owner do anything, the Owner role included", () => {
    expect(() =>
      assertCovers(owner, { isSystem: true, permissions: ["business.manage"] }, "no"),
    ).not.toThrow();
  });

  it("lets anyone else reach a role that grants only what they hold", () => {
    expect(() =>
      assertCovers(manager, { isSystem: false, permissions: ["staff.view"] }, "no"),
    ).not.toThrow();
    expect(() =>
      assertCovers(manager, { isSystem: false, permissions: [...manager.permissions] }, "no"),
    ).not.toThrow();
    expect(() => assertCovers(manager, { isSystem: false, permissions: [] }, "no")).not.toThrow();
  });

  it("refuses a role that grants anything they don't hold, and names it", () => {
    expect(() =>
      assertCovers(
        manager,
        { isSystem: false, permissions: ["staff.view", "roles.manage"] },
        "You can't",
      ),
    ).toThrow(new ForbiddenError("You can't (roles.manage)"));
  });

  it("keeps the Owner role an owner's alone, even for someone holding every permission", () => {
    const everything: Authority = {
      isOwner: false,
      permissions: new Set(DEFAULT_PERMISSIONS.map((p) => p.key)),
    };
    expect(() =>
      assertCovers(
        everything,
        { isSystem: true, permissions: DEFAULT_PERMISSIONS.map((p) => p.key) },
        "no",
      ),
    ).toThrow(ForbiddenError);
  });
});

describe("DEFAULT_PERMISSIONS", () => {
  it("has unique keys, each an area and a verb", () => {
    const keys = DEFAULT_PERMISSIONS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^[a-z]+\.(view|manage)$/);
  });
});
