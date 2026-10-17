/**
 * @service-finder/auth — what every Service Finder access token looks
 * like, in one place.
 *
 * Two audiences sign in today: back-office operators, and a business's
 * own staff (the tenant app). The customer app will be the third, and the
 * rule they all follow is the one iGroom runs on: every audience signs
 * with the same JWT_SECRET and is told apart by the `purpose` claim, so a
 * token minted for one can never be replayed against another. That only holds while
 * every service that checks tokens agrees on those purposes — which is
 * why the formats live here, in a package, rather than inside the API. A
 * second service that checks tokens (a realtime server, say) imports the
 * same file.
 *
 * Adding an audience: a new file beside back-office.ts and tenant.ts with its own
 * distinct purpose value(s) and a `xxxTokens(secret)` factory, exported
 * below, plus a case in audiences.test.ts proving a token from every
 * other audience is refused by it.
 *
 * Nothing here reads the environment. Each app passes its own secret in,
 * once, from its own validated config:
 *
 *   export const { signAccessToken, verifyToken } = backOfficeTokens(env.JWT_SECRET);
 */
export { backOfficeTokens, type TokenPayload, type TokenPurpose } from "./back-office";
export {
  tenantTokens,
  type AccountAccessTokenPayload,
  type MfaChallengeTokenPayload,
} from "./tenant";
export { tokenExpiresAt } from "./expiry";
