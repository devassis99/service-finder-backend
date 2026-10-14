import { eq } from "drizzle-orm";
import { db, closeDb } from "../../db";
import { boRoles, boUsers } from "@service-finder/db/schema";

/**
 * Idempotent — safe to run on every deploy, not just once by hand.
 * Creates the "superadmin" role and one pre-provisioned bo_users row
 * for SEED_SUPERADMIN_EMAIL, with no Google account linked yet
 * (googleSub stays null) and MFA not yet enabled. Whoever signs in with
 * that exact Google account first claims this row and is immediately
 * routed into MFA setup — see loginWithGoogle() in auth.service.ts.
 *
 * SEED_SUPERADMIN_EMAIL is intentionally read directly from
 * process.env here, not through src/config/env.ts — it's only relevant
 * to this one-off script, not to the running app, so it shouldn't be a
 * required var for `pnpm dev`/`pnpm start`.
 */
async function main() {
  const email = process.env.SEED_SUPERADMIN_EMAIL;
  if (!email) {
    throw new Error("SEED_SUPERADMIN_EMAIL must be set to run the seed script");
  }

  let [role] = await db.select().from(boRoles).where(eq(boRoles.name, "superadmin"));
  if (!role) {
    [role] = await db
      .insert(boRoles)
      .values({ name: "superadmin", description: "Full, unrestricted access to the back office." })
      .returning();
    console.log(`Created "superadmin" role (${role.id})`);
  } else {
    console.log(`"superadmin" role already exists (${role.id})`);
  }

  const [existingUser] = await db.select().from(boUsers).where(eq(boUsers.email, email));
  if (existingUser) {
    console.log(`Super admin already seeded for ${email} (${existingUser.id}) — no changes made.`);
  } else {
    const [user] = await db
      .insert(boUsers)
      .values({ roleId: role.id, name: "Super Admin", email })
      .returning();
    console.log(
      `Seeded super admin for ${email} (${user.id}) — unclaimed until first Google sign-in.`,
    );
  }

  await closeDb();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
