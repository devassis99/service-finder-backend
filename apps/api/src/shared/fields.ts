import { z } from "./openapi/zod";

/**
 * Every email the business app takes in, normalised the same way:
 * trimmed and lowercased before it is validated or looked up. Sign-in is
 * by email and staff_users.email is unique, so "Jo@Example.com " and
 * "jo@example.com" have to be one person — see
 * packages/db/src/schema/staff-users.ts. Shared by modules/accounts and
 * modules/staff-users, which both take one.
 */
export const emailField = z.string().trim().toLowerCase().email().max(255);
