import { backOfficeTokens } from "@service-finder/auth";
import { env } from "../../config/env";

/**
 * The back office's tokens, bound to this app's JWT_SECRET. What the
 * tokens are, and why there are three purposes, is in @service-finder/auth
 * (packages/auth/src/back-office.ts).
 */
export const { signAccessToken, signMfaFlowToken, verifyToken } = backOfficeTokens(env.JWT_SECRET);
