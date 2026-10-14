import { eq } from "drizzle-orm";
import { db, closeDb } from "../../db";
import {
  boRoles,
  boPermissions,
  boRolePermissions,
  boEndpoints,
  boEndpointPermissions,
} from "@service-finder/db/schema";

/**
 * Idempotent — safe to run on every deploy, not just once by hand
 * (same convention as auth.seed.ts). Seeds:
 *   1. The full bo_permissions catalog — one row per tab/functionality
 *      the back office recognizes. This is the fixed vocabulary
 *      requirePermission checks against and the Roles & Permissions
 *      screen builds its matrix from.
 *   2. bo_endpoints + bo_endpoint_permissions — a *descriptive* map of
 *      which API routes each permission unlocks, for that same screen
 *      to show "this permission also covers: POST /users".
 *      This catalog does not drive runtime enforcement — each route
 *      declares its own requirePermission("...") call directly (see
 *      src/shared/middlewares/require-permission.middleware.ts for why) —
 *      so if a route's permission changes, update both its
 *      requirePermission() call *and* the matching entry below, or the
 *      catalog will describe something that's no longer true.
 *   3. Every permission granted to the "superadmin" role, so the
 *      existing seeded super admin (auth.seed.ts) has full access
 *      immediately — nothing else grants superadmin its permissions.
 */

/**
 * One permission per back-office tab or capability. The back office's
 * sidebar (AppShell.tsx's NAV_ITEMS) hides a tab whose `.view` key the
 * role lacks, and every API route checks its key server-side — so a new
 * area adds its keys here, its routes' requirePermission() calls, and its
 * nav entry, in the same change.
 */
const PERMISSIONS = [
  { key: "overview.view", name: "View Overview", description: "View the Overview tab." },
  {
    key: "users.view",
    name: "View back-office users",
    description: "View the User Management tab.",
  },
  {
    key: "users.manage",
    name: "Manage back-office users",
    description: "Invite users, reassign their role, and activate/deactivate accounts.",
  },
  {
    key: "roles.view",
    name: "View roles & permissions",
    description: "View the Roles & Permissions tab.",
  },
  {
    key: "roles.manage",
    name: "Manage roles & permissions",
    description: "Create/delete roles and edit which permissions each role has.",
  },
] as const;

const ENDPOINTS: Array<{
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  name: string;
  permissionKey: string;
}> = [
  { method: "GET", path: "/users", name: "List back-office users", permissionKey: "users.view" },
  {
    method: "POST",
    path: "/users",
    name: "Invite back-office user",
    permissionKey: "users.manage",
  },
  {
    method: "PATCH",
    path: "/users/:userId/role",
    name: "Reassign user role",
    permissionKey: "users.manage",
  },
  {
    method: "PATCH",
    path: "/users/:userId/active",
    name: "Activate/deactivate user",
    permissionKey: "users.manage",
  },
  { method: "GET", path: "/roles", name: "List roles", permissionKey: "roles.view" },
  {
    method: "GET",
    path: "/roles/permissions",
    name: "List permission catalog",
    permissionKey: "roles.view",
  },
  { method: "POST", path: "/roles", name: "Create role", permissionKey: "roles.manage" },
  {
    method: "PATCH",
    path: "/roles/:roleId/permissions",
    name: "Replace role permissions",
    permissionKey: "roles.manage",
  },
  { method: "DELETE", path: "/roles/:roleId", name: "Delete role", permissionKey: "roles.manage" },
];

/** `"METHOD path"` — cheap composite key since (method, path) has no single-column unique index to select on. */
function endpointKey(method: string, path: string): string {
  return `${method} ${path}`;
}

async function main() {
  // Permissions -------------------------------------------------------
  // One bulk select + one bulk insert instead of a select-then-insert
  // per item: same idempotency guarantee (still single-threaded, so no
  // insert can race another insert like a naive Promise.all() would
  // risk), just far fewer round trips, and no await left inside a loop.
  const existingPermissions = await db.select().from(boPermissions);
  const permissionIdByKey = new Map(existingPermissions.map((p) => [p.key, p.id]));

  const missingPermissions = PERMISSIONS.filter((p) => !permissionIdByKey.has(p.key));
  if (missingPermissions.length > 0) {
    const created = await db.insert(boPermissions).values(missingPermissions).returning();
    for (const permission of created) {
      permissionIdByKey.set(permission.key, permission.id);
      console.log(`Created permission "${permission.key}"`);
    }
  }

  // Endpoints -----------------------------------------------------------
  const existingEndpoints = await db.select().from(boEndpoints);
  const endpointRowByKey = new Map(
    existingEndpoints.map((e) => [endpointKey(e.method, e.path), e]),
  );

  const missingEndpoints = ENDPOINTS.filter(
    (e) => !endpointRowByKey.has(endpointKey(e.method, e.path)),
  );
  if (missingEndpoints.length > 0) {
    const created = await db
      .insert(boEndpoints)
      .values(missingEndpoints.map((e) => ({ method: e.method, path: e.path, name: e.name })))
      .returning();
    for (const endpointRow of created) {
      endpointRowByKey.set(endpointKey(endpointRow.method, endpointRow.path), endpointRow);
      console.log(`Created endpoint "${endpointRow.method} ${endpointRow.path}"`);
    }
  }

  // Endpoint <-> permission links -----------------------------------------
  const existingLinks = await db.select().from(boEndpointPermissions);
  const linkedKeys = new Set(existingLinks.map((l) => `${l.endpointId}:${l.permissionId}`));

  const missingLinks: Array<{ endpointId: string; permissionId: string }> = [];
  for (const endpoint of ENDPOINTS) {
    const permissionId = permissionIdByKey.get(endpoint.permissionKey);
    if (!permissionId) {
      throw new Error(
        `Endpoint ${endpoint.method} ${endpoint.path} references unknown permission key "${endpoint.permissionKey}"`,
      );
    }
    const endpointRow = endpointRowByKey.get(endpointKey(endpoint.method, endpoint.path));
    if (!endpointRow) {
      throw new Error(`Endpoint ${endpoint.method} ${endpoint.path} was not created`);
    }
    const linkKey = `${endpointRow.id}:${permissionId}`;
    if (!linkedKeys.has(linkKey)) {
      missingLinks.push({ endpointId: endpointRow.id, permissionId });
      linkedKeys.add(linkKey); // guards against a duplicate ENDPOINTS entry adding the same link twice
    }
  }
  if (missingLinks.length > 0) {
    await db.insert(boEndpointPermissions).values(missingLinks);
  }

  const [superadminRole] = await db.select().from(boRoles).where(eq(boRoles.name, "superadmin"));
  if (!superadminRole) {
    console.log('No "superadmin" role found yet — run `pnpm db:seed` first. Skipping role grants.');
  } else {
    const existingGrants = await db
      .select({ permissionId: boRolePermissions.permissionId })
      .from(boRolePermissions)
      .where(eq(boRolePermissions.roleId, superadminRole.id));
    const grantedIds = new Set(existingGrants.map((g) => g.permissionId));

    const missing = [...permissionIdByKey.values()].filter((id) => !grantedIds.has(id));
    if (missing.length > 0) {
      await db
        .insert(boRolePermissions)
        .values(missing.map((permissionId) => ({ roleId: superadminRole.id, permissionId })));
      console.log(`Granted ${missing.length} permission(s) to "superadmin"`);
    } else {
      console.log('"superadmin" already has every permission — no changes made.');
    }
  }

  await closeDb();
}

main().catch((err) => {
  console.error("Permissions seed failed:", err);
  process.exit(1);
});
