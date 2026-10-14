import crypto from "node:crypto";
import { env } from "../config/env";

/** A salted hash of the caller's address: enough to count requests from it, never enough to recover it. */
export function clientHashFor(ip: string | undefined): string | null {
  if (!ip) return null;
  return crypto
    .createHash("sha256")
    .update(`${env.JWT_SECRET}:${deviceKey(ip)}`)
    .digest("hex");
}

/**
 * The part of an address that names one device or household. IPv4 as it
 * is. IPv6 by its /64: one connection is handed a whole /64, so keying on
 * the full address would let a single device rotate through billions of
 * them.
 */
export function deviceKey(ip: string): string {
  const v4 = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4) return v4[1]!;
  if (!ip.includes(":")) return ip;
  const [head = "", tail = ""] = ip.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = ip.includes("::")
    ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right]
    : left;
  return `${groups
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, "") || "0")
    .join(":")}::/64`;
}
