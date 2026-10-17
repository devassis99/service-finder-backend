import { tenantTokens } from "@service-finder/auth";
import { env } from "../../config/env";

/**
 * The business app's tokens — staff sessions and the mid-login two-factor
 * challenge — bound to this app's JWT_SECRET. What each one is for is in
 * @service-finder/auth (packages/auth/src/tenant.ts).
 */
export const {
  signAccountAccessToken,
  verifyAccountAccessToken,
  signMfaChallengeToken,
  verifyMfaChallengeToken,
} = tenantTokens(env.JWT_SECRET);
