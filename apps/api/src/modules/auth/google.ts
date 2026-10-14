import { OAuth2Client } from "google-auth-library";
import { env } from "../../config/env";

const client = new OAuth2Client(env.GOOGLE_CLIENT_ID);

export interface GoogleIdentity {
  googleSub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}

/**
 * Verifies a Google ID token: checks its signature against Google's
 * public keys, confirms it hasn't expired, and confirms it was issued
 * for *this* app (audience check) — never trust an ID token's claims
 * without this. Throws on anything invalid.
 *
 * This assumes the frontend obtained the token via Google's client-side
 * sign-in SDK and sent it here for verification, rather than the
 * backend driving a redirect-based OAuth flow itself.
 */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  const ticket = await client.verifyIdToken({
    idToken,
    audience: env.GOOGLE_CLIENT_ID,
  });

  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email) {
    throw new Error("Google ID token payload is missing required claims");
  }

  return {
    googleSub: payload.sub,
    email: payload.email,
    emailVerified: payload.email_verified ?? false,
    name: payload.name,
  };
}
