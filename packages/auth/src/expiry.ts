import jwt from "jsonwebtoken";

/**
 * When a token stops being valid, in epoch milliseconds — or null if it
 * carries no expiry.
 *
 * Reads the claim without checking the signature, so call it only on a
 * token one of the verify functions has already accepted. It exists for
 * long-lived connections (a realtime server's sockets, when there is
 * one), which have to know when the token they were opened with runs out.
 */
export function tokenExpiresAt(token: string): number | null {
  const payload = jwt.decode(token);
  if (!payload || typeof payload === "string" || typeof payload.exp !== "number") return null;
  return payload.exp * 1000;
}
