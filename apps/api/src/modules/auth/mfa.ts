import crypto from "node:crypto";
import { generateSecret, generateURI, verify } from "otplib";
import QRCode from "qrcode";
import { env } from "../../config/env";

const ALGORITHM = "aes-256-gcm";

/**
 * AES-256-GCM needs exactly a 32-byte key. MFA_ENCRYPTION_KEY is just an
 * arbitrary long random string from .env, so it's hashed with SHA-256
 * (always 32 bytes out) rather than requiring the operator to produce an
 * exact-length secret by hand.
 */
function getEncryptionKey(): Buffer {
  return crypto.createHash("sha256").update(env.MFA_ENCRYPTION_KEY).digest();
}

/** Encrypts a TOTP secret for storage — it must never be stored in plaintext. */
export function encryptMfaSecret(secret: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("hex"), authTag.toString("hex"), encrypted.toString("hex")].join(":");
}

export function decryptMfaSecret(stored: string): string {
  const [ivHex, authTagHex, dataHex] = stored.split(":");
  if (!ivHex || !authTagHex || !dataHex) {
    throw new Error("Malformed encrypted MFA secret");
  }

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getEncryptionKey(),
    Buffer.from(ivHex, "hex"),
  );
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]);
  return decrypted.toString("utf8");
}

export function generateTotpSecret(): string {
  return generateSecret();
}

/**
 * The otpauth:// URI an authenticator app (Google Authenticator, Authy,
 * etc.) reads via QR code. `issuer` is the label the entry gets in that
 * app. It defaults to the back office's own; a future provider- or
 * customer-facing MFA flow should pass its own ("ServiceFinder") so a
 * business owner's authenticator entry doesn't read "Back Office", which
 * isn't the app they're using.
 */
export async function buildOtpAuthUrl(
  accountEmail: string,
  secret: string,
  issuer = "ServiceFinder Backoffice",
): Promise<string> {
  return generateURI({ issuer, label: accountEmail, secret });
}

export async function generateQrCodeDataUrl(otpAuthUrl: string): Promise<string> {
  return QRCode.toDataURL(otpAuthUrl);
}

/** Verifies a 6-digit TOTP code, allowing for small clock drift (otplib's default tolerance). */
export async function verifyTotpCode(secret: string, code: string): Promise<boolean> {
  const result = await verify({ secret, token: code });
  return result.valid;
}
