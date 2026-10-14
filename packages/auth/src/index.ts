/**
 * @service-finder/auth — what every Service Finder access token looks
 * like, in one place.
 *
 * Today one audience signs in: back-office operators. The provider and
 * customer apps will be the next two, and the rule they will follow is
 * already the one iGroom runs on: every audience signs with the same
 * JWT_SECRET and is told apart by the `purpose` claim, so a token minted
 * for one can never be replayed against another. That only holds while
 * every service that checks tokens agrees on those purposes — which is
 * why the formats live here, in a package, rather than inside the API. A
 * second service that checks tokens (a realtime server, say) imports the
 * same file.
 *
 * Adding an audience: a new file beside back-office.ts with its own
 * distinct purpose value(s) and a `xxxTokens(secret)` factory, exported
 * below, plus a test that a token from every other audience is refused
 * by it.
 *
 * Nothing here reads the environment. Each app passes its own secret in,
 * once, from its own validated config:
 *
 *   export const { signAccessToken, verifyToken } = backOfficeTokens(env.JWT_SECRET);
 */
export { backOfficeTokens, type TokenPayload, type TokenPurpose } from "./back-office";
export { tokenExpiresAt } from "./expiry";
