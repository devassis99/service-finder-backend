import { and, count, eq, inArray } from "drizzle-orm";
import { db, type Database, type DbTx } from "../../db";
import {
  staffRoles,
  staffPermissions,
  staffRolePermissions,
  staffUsers,
  type StaffRole as StaffRoleRow,
} from "@service-finder/db/schema";
import { NotFoundError, ConflictError, ForbiddenError } from "../staff-users/staff.errors";

// Re-exported so route/controller files can import every team error
// class from one place regardless of which service file threw it.
export { NotFoundError, ConflictError, ForbiddenError };

/**
 * The fixed, global vocabulary of permission keys a business role can be
 * granted — see packages/db/src/schema/staff-permissions.ts.
 *
 * Only what the business app has today: its team, its roles, and its
 * own profile. Every new area adds its keys here (a "view" and a
 * "manage" is the usual pair) before gating anything on them. Existing
 * businesses need no reseed when this grows: ensurePermissionCatalog,
 * run at every boot, grants each brand-new key to every Owner role the
 * first time it lands.
 */
export const DEFAULT_PERMISSIONS = [
  {
    key: "staff.view",
    name: "View team",
    description: "See everyone on the team, their role and whether they've joined.",
  },
  {
    key: "staff.manage",
    name: "Manage team",
    description: "Invite people, change their name or role, and deactivate or reactivate them.",
  },
  {
    key: "roles.view",
    name: "View roles & permissions",
    description: "See the business's roles and what each one can do.",
  },
  {
    key: "roles.manage",
    name: "Manage roles & permissions",
    description: "Create, rename and delete roles, and change which permissions each one grants.",
  },
  {
    key: "business.manage",
    name: "Manage business profile",
    description: "Change the business's name and contact details.",
  },
] as const;

export type PermissionKey = (typeof DEFAULT_PERMISSIONS)[number]["key"];

/**
 * Every business is created with these three roles (see
 * seedDefaultRolesForAccount). After that they're ordinary rows an
 * owner can rename, re-permission or delete — except Owner itself, which
 * is protected (isSystem): it always has every permission and always
 * keeps its name.
 */
const DEFAULT_ROLE_DEFS: Array<{
  name: string;
  description: string;
  isSystem: boolean;
  permissionKeys: PermissionKey[];
}> = [
  {
    name: "Owner",
    description: "Full access to everything, including the business profile.",
    isSystem: true,
    permissionKeys: DEFAULT_PERMISSIONS.map((p) => p.key),
  },
  {
    name: "Manager",
    description: "Runs the team day to day: invites people and assigns their roles.",
    isSystem: false,
    permissionKeys: ["staff.view", "staff.manage", "roles.view"],
  },
  {
    name: "Member",
    description: "Can see who's on the team.",
    isSystem: false,
    permissionKeys: ["staff.view"],
  },
];

type DbLike = Database | DbTx;

/**
 * Idempotent upsert of the global permission catalog: inserts only the
 * keys that are missing, and returns every key's id. Run at every boot
 * (src/index.ts) and inside every sign-up.
 *
 * A key inserted for the first time is also granted to every business's
 * Owner role at once — seedDefaultRolesForAccount only grants while
 * *creating* a role, so without this a business that existed before the
 * key shipped would never get it, and "Owner always has every
 * permission" would quietly stop being true.
 *
 * Concurrent first boots (two instances deploying together) can both see
 * a key as missing; onConflictDoNothing lets the second one through
 * rather than failing its start, and it then reads the winner's ids.
 */
export async function ensurePermissionCatalog(dbClient: DbLike): Promise<Map<string, string>> {
  const existing = await dbClient.select().from(staffPermissions);
  const idByKey = new Map(existing.map((p) => [p.key, p.id]));

  const missing = DEFAULT_PERMISSIONS.filter((p) => !idByKey.has(p.key));
  if (missing.length === 0) return idByKey;

  const created = await dbClient
    .insert(staffPermissions)
    .values(missing.map((p) => ({ key: p.key, name: p.name, description: p.description })))
    .onConflictDoNothing({ target: staffPermissions.key })
    .returning();
  for (const permission of created) idByKey.set(permission.key, permission.id);

  if (created.length > 0) {
    const ownerRoles = await dbClient
      .select({ id: staffRoles.id })
      .from(staffRoles)
      .where(eq(staffRoles.isSystem, true));
    if (ownerRoles.length > 0) {
      await dbClient
        .insert(staffRolePermissions)
        .values(
          ownerRoles.flatMap((role) =>
            created.map((permission) => ({ roleId: role.id, permissionId: permission.id })),
          ),
        )
        .onConflictDoNothing();
    }
  }

  // Lost the race for some key: read back what the other instance wrote.
  if (idByKey.size < DEFAULT_PERMISSIONS.length) {
    const all = await dbClient.select().from(staffPermissions);
    for (const permission of all) idByKey.set(permission.key, permission.id);
  }
  return idByKey;
}

/**
 * Gives a business its default roles (whichever it's missing, by name)
 * and returns its Owner role's id. Called inside sign-up's transaction,
 * with `tx`, so the business, its roles and its owner land together.
 */
export async function seedDefaultRolesForAccount(
  dbClient: DbLike,
  accountId: string,
): Promise<string> {
  const permissionIdByKey = await ensurePermissionCatalog(dbClient);

  const existingRoles = await dbClient
    .select()
    .from(staffRoles)
    .where(eq(staffRoles.accountId, accountId));
  const existingByName = new Map(existingRoles.map((r) => [r.name, r]));

  // One after another rather than concurrently: inside sign-up's
  // transaction every query shares one connection, and node-postgres
  // queues (and warns about) queries issued on a busy client anyway.
  //
  // createdAt is set rather than defaulted: inside that transaction now()
  // is the same instant for every row, and listRoles orders by it, so
  // without a millisecond apart each the defaults would come back in
  // whatever order their random ids happened to sort.
  const base = Date.now();
  const seeded: Array<{ role: StaffRoleRow; isSystem: boolean }> = [];
  for (const [index, def] of DEFAULT_ROLE_DEFS.entries()) {
    const existingRole = existingByName.get(def.name);
    if (existingRole) {
      seeded.push({ role: existingRole, isSystem: def.isSystem });
      continue;
    }

    // oxlint-disable-next-line no-await-in-loop -- see above: one connection, three rows
    const [created] = await dbClient
      .insert(staffRoles)
      .values({
        accountId,
        name: def.name,
        description: def.description,
        isSystem: def.isSystem,
        createdAt: new Date(base + index),
      })
      .returning();

    const grants = def.permissionKeys
      .map((key) => permissionIdByKey.get(key))
      .filter((id): id is string => id !== undefined)
      .map((permissionId) => ({ roleId: created!.id, permissionId }));
    if (grants.length > 0) {
      // oxlint-disable-next-line no-await-in-loop -- as above
      await dbClient.insert(staffRolePermissions).values(grants);
    }

    seeded.push({ role: created!, isSystem: def.isSystem });
  }

  const ownerRoleId = seeded.find((s) => s.isSystem)?.role.id;
  if (!ownerRoleId) {
    // Can't happen with DEFAULT_ROLE_DEFS above — but fail loudly rather
    // than create a business with no Owner role.
    throw new Error(`Failed to seed the "Owner" role for account ${accountId}`);
  }
  return ownerRoleId;
}

/**
 * Every permission key a role grants — [] for a null or unknown role,
 * and never throws. On the request path (requireAccountPermission), so
 * read from the primary: the cache in front of it is refreshed right
 * after every change, and a lagging replica would put the old answer
 * straight back in for a minute.
 */
export async function getStaffRolePermissionKeys(
  roleId: string | null | undefined,
): Promise<string[]> {
  if (!roleId) return [];
  const rows = await db.$primary
    .select({ key: staffPermissions.key })
    .from(staffRolePermissions)
    .innerJoin(staffPermissions, eq(staffRolePermissions.permissionId, staffPermissions.id))
    .where(eq(staffRolePermissions.roleId, roleId));
  return rows.map((r) => r.key);
}

// --- What the caller may hand out ------------------------------------------

/** Who is asking — what every write in staff-roles and staff-users is checked against. */
export interface Caller {
  id: string;
  accountId: string;
  roleId: string | null;
}

export interface Authority {
  /** Holds the business's Owner (system) role. */
  isOwner: boolean;
  permissions: ReadonlySet<string>;
}

/**
 * What the caller's own role amounts to. Read fresh (not from the
 * request cache) because it decides a write.
 */
export async function authorityOf(caller: Caller): Promise<Authority> {
  if (!caller.roleId) return { isOwner: false, permissions: new Set() };
  const [[role], keys] = await Promise.all([
    db.$primary
      .select({ isSystem: staffRoles.isSystem, accountId: staffRoles.accountId })
      .from(staffRoles)
      .where(eq(staffRoles.id, caller.roleId)),
    getStaffRolePermissionKeys(caller.roleId),
  ]);
  if (!role || role.accountId !== caller.accountId) {
    return { isOwner: false, permissions: new Set() };
  }
  return { isOwner: role.isSystem, permissions: new Set(keys) };
}

/**
 * The anti-escalation rule, in one place. Holding staff.manage or
 * roles.manage lets someone hand out roles and change them — but on its
 * own that would let a Manager create a role with every permission and
 * give it to themselves by proxy, or promote a friend to Owner.
 *
 * So, for anyone but an Owner:
 *  - a role they create, edit or assign may only grant permissions they
 *    hold themselves;
 *  - a role (or a member holding one) that grants something they don't
 *    hold is out of their reach altogether;
 *  - the Owner role, and the people who hold it, are an Owner's alone.
 *
 * An Owner is unrestricted: their role always has every permission.
 */
export function assertCovers(
  authority: Authority,
  target: { isSystem: boolean; permissions: readonly string[] },
  message: string,
) {
  if (authority.isOwner) return;
  if (target.isSystem) {
    throw new ForbiddenError("Only an owner can assign the Owner role or change an owner.");
  }
  const beyond = target.permissions.filter((key) => !authority.permissions.has(key));
  if (beyond.length > 0) {
    throw new ForbiddenError(`${message} (${beyond.join(", ")})`);
  }
}

// --- Roles -----------------------------------------------------------------

async function requireOwnRole(accountId: string, roleId: string): Promise<StaffRoleRow> {
  const [row] = await db.$primary
    .select()
    .from(staffRoles)
    .where(and(eq(staffRoles.id, roleId), eq(staffRoles.accountId, accountId)));
  if (!row) throw new NotFoundError("Role not found");
  return row;
}

/** A role of this business with the keys it grants — what assertCovers takes. */
export async function requireOwnRoleWithPermissions(accountId: string, roleId: string) {
  const row = await requireOwnRole(accountId, roleId);
  return { row, permissions: await getStaffRolePermissionKeys(roleId) };
}

/** What a member's role amounts to, in the shape assertCovers takes. A member with no role holds nothing. */
export async function roleReach(accountId: string, roleId: string | null) {
  if (!roleId) return { isSystem: false, permissions: [] as string[] };
  const { row, permissions } = await requireOwnRoleWithPermissions(accountId, roleId);
  return { isSystem: row.isSystem, permissions };
}

async function memberCountsByRole(accountId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ roleId: staffUsers.roleId, memberCount: count() })
    .from(staffUsers)
    .where(eq(staffUsers.accountId, accountId))
    .groupBy(staffUsers.roleId);
  return new Map(
    rows.filter((r) => r.roleId !== null).map((r) => [r.roleId as string, r.memberCount]),
  );
}

function toRoleResponse(row: StaffRoleRow, permissionKeys: string[], memberCount: number) {
  return {
    id: row.id,
    accountId: row.accountId,
    name: row.name,
    description: row.description,
    isSystem: row.isSystem,
    permissions: [...permissionKeys].sort(),
    memberCount,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Settings → Users & roles → Roles: every role of the business, Owner first, then oldest first. */
export async function listRoles(accountId: string) {
  const roles = await db
    .select()
    .from(staffRoles)
    .where(eq(staffRoles.accountId, accountId))
    .orderBy(staffRoles.createdAt, staffRoles.id);

  const roleIds = roles.map((r) => r.id);
  const [grants, counts] = await Promise.all([
    roleIds.length > 0
      ? db
          .select({ roleId: staffRolePermissions.roleId, key: staffPermissions.key })
          .from(staffRolePermissions)
          .innerJoin(staffPermissions, eq(staffRolePermissions.permissionId, staffPermissions.id))
          .where(inArray(staffRolePermissions.roleId, roleIds))
      : Promise.resolve([]),
    memberCountsByRole(accountId),
  ]);

  const keysByRole = new Map<string, string[]>();
  for (const grant of grants) {
    const list = keysByRole.get(grant.roleId) ?? [];
    list.push(grant.key);
    keysByRole.set(grant.roleId, list);
  }

  return roles
    .slice()
    .sort((a, b) => Number(b.isSystem) - Number(a.isSystem))
    .map((role) => toRoleResponse(role, keysByRole.get(role.id) ?? [], counts.get(role.id) ?? 0));
}

/**
 * The global permission catalog, in DEFAULT_PERMISSIONS' order — the
 * order the create/edit-role checklist shows them in, which groups each
 * area's view and manage together.
 */
export async function listPermissionsCatalog() {
  const rows = await db.select().from(staffPermissions);
  const order = new Map<string, number>(DEFAULT_PERMISSIONS.map((p, i) => [p.key, i]));
  return rows
    .map((row) => ({ key: row.key, name: row.name, description: row.description }))
    .sort(
      (a, b) => (order.get(a.key) ?? 999) - (order.get(b.key) ?? 999) || a.key.localeCompare(b.key),
    );
}

async function resolvePermissionIds(permissionKeys: string[]): Promise<string[]> {
  const unique = [...new Set(permissionKeys)];
  if (unique.length === 0) return [];
  const rows = await db.$primary
    .select({ id: staffPermissions.id, key: staffPermissions.key })
    .from(staffPermissions)
    .where(inArray(staffPermissions.key, unique));
  const foundKeys = new Set(rows.map((r) => r.key));
  const unknown = unique.filter((k) => !foundKeys.has(k));
  if (unknown.length > 0) {
    throw new NotFoundError(`Unknown permission key(s): ${unknown.join(", ")}`);
  }
  return rows.map((r) => r.id);
}

async function assertNameFree(accountId: string, name: string, exceptRoleId?: string) {
  const [clash] = await db.$primary
    .select({ id: staffRoles.id })
    .from(staffRoles)
    .where(and(eq(staffRoles.accountId, accountId), eq(staffRoles.name, name)));
  if (clash && clash.id !== exceptRoleId) {
    throw new ConflictError(`A role named "${name}" already exists`);
  }
}

export interface CreateRoleInput {
  name: string;
  description?: string;
  permissionKeys: string[];
}

/** A new custom role — never isSystem; only sign-up creates an Owner role. */
export async function createRole(caller: Caller, input: CreateRoleInput) {
  const name = input.name.trim();
  const permissionKeys = [...new Set(input.permissionKeys)];
  assertCovers(
    await authorityOf(caller),
    { isSystem: false, permissions: permissionKeys },
    "You can't create a role with permissions you don't have yourself",
  );
  await assertNameFree(caller.accountId, name);
  const permissionIds = await resolvePermissionIds(permissionKeys);

  const role = await db.$primary.transaction(async (tx) => {
    const [created] = await tx
      .insert(staffRoles)
      .values({
        accountId: caller.accountId,
        name,
        description: input.description?.trim() || null,
        isSystem: false,
      })
      .returning();
    if (permissionIds.length > 0) {
      await tx
        .insert(staffRolePermissions)
        .values(permissionIds.map((permissionId) => ({ roleId: created!.id, permissionId })));
    }
    return created!;
  });

  return toRoleResponse(role, permissionKeys, 0);
}

export interface UpdateRoleInput {
  name?: string;
  description?: string | null;
}

/** Renames or re-describes a role. The Owner role keeps its name — the app and these checks both rely on it reading "Owner". */
export async function updateRole(caller: Caller, roleId: string, patch: UpdateRoleInput) {
  const { row: existing, permissions } = await requireOwnRoleWithPermissions(
    caller.accountId,
    roleId,
  );
  assertCovers(
    await authorityOf(caller),
    { isSystem: existing.isSystem, permissions },
    "This role grants permissions you don't have, so you can't change it",
  );

  const name = patch.name?.trim();
  if (existing.isSystem && name !== undefined && name !== existing.name) {
    throw new ForbiddenError("The Owner role can't be renamed");
  }
  if (name !== undefined && name !== existing.name) {
    await assertNameFree(caller.accountId, name, roleId);
  }

  const [row] = await db
    .update(staffRoles)
    .set({
      name: name ?? existing.name,
      description:
        patch.description !== undefined ? patch.description?.trim() || null : existing.description,
      updatedAt: new Date(),
    })
    .where(eq(staffRoles.id, roleId))
    .returning();

  const counts = await memberCountsByRole(caller.accountId);
  return toRoleResponse(row!, permissions, counts.get(roleId) ?? 0);
}

/**
 * Replaces a role's whole permission set. The Owner role always has
 * every permission, so editing it is refused outright rather than
 * silently ignored — the app can say why.
 *
 * Both sides of the change are checked: the role as it stands (or a
 * Manager could strip a role that outranks them) and as it will be (or
 * they could raise one past themselves).
 */
export async function updateRolePermissions(
  caller: Caller,
  roleId: string,
  permissionKeys: string[],
) {
  const { row: existing, permissions: current } = await requireOwnRoleWithPermissions(
    caller.accountId,
    roleId,
  );
  if (existing.isSystem) {
    throw new ForbiddenError("The Owner role always has every permission");
  }
  const next = [...new Set(permissionKeys)];
  const authority = await authorityOf(caller);
  assertCovers(
    authority,
    { isSystem: false, permissions: current },
    "This role grants permissions you don't have, so you can't change it",
  );
  assertCovers(
    authority,
    { isSystem: false, permissions: next },
    "You can't grant permissions you don't have yourself",
  );

  const permissionIds = await resolvePermissionIds(next);
  await db.$primary.transaction(async (tx) => {
    await tx.delete(staffRolePermissions).where(eq(staffRolePermissions.roleId, roleId));
    if (permissionIds.length > 0) {
      await tx
        .insert(staffRolePermissions)
        .values(permissionIds.map((permissionId) => ({ roleId, permissionId })));
    }
    await tx.update(staffRoles).set({ updatedAt: new Date() }).where(eq(staffRoles.id, roleId));
  });

  const counts = await memberCountsByRole(caller.accountId);
  return toRoleResponse(existing, next, counts.get(roleId) ?? 0);
}

/**
 * Deletes a custom role. Refused for the Owner role, and for any role
 * someone still holds — move them to another role first, the same
 * "can't remove what's still load-bearing" rule as the last-owner guard
 * in staff.service.ts. (The database agrees: staff_users.role_id has no
 * ON DELETE, so it would refuse too.)
 */
export async function deleteRole(caller: Caller, roleId: string) {
  const { row: existing, permissions } = await requireOwnRoleWithPermissions(
    caller.accountId,
    roleId,
  );
  if (existing.isSystem) {
    throw new ForbiddenError("The Owner role can't be deleted");
  }
  assertCovers(
    await authorityOf(caller),
    { isSystem: false, permissions },
    "This role grants permissions you don't have, so you can't delete it",
  );

  const counts = await memberCountsByRole(caller.accountId);
  const memberCount = counts.get(roleId) ?? 0;
  if (memberCount > 0) {
    throw new ConflictError(
      `${memberCount} ${memberCount === 1 ? "person still has" : "people still have"} this role — move them to another role first`,
    );
  }

  await db
    .delete(staffRoles)
    .where(and(eq(staffRoles.id, roleId), eq(staffRoles.accountId, caller.accountId)));
}
