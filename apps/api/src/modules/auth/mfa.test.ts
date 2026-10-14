import { describe, it, expect } from "vitest";
import { encryptMfaSecret, decryptMfaSecret } from "./mfa";

// generateTotpSecret/buildOtpAuthUrl/generateQrCodeDataUrl/verifyTotpCode
// are thin pass-throughs to otplib/qrcode with no logic of their own (see
// mfa.ts) — auth.service.test.ts mocks them at the module boundary rather
// than re-testing otplib/qrcode here. encryptMfaSecret/decryptMfaSecret is
// where this file's own logic (AES-256-GCM framing) actually lives, so
// that's what's covered below.
describe("encryptMfaSecret / decryptMfaSecret", () => {
  it("round-trips a TOTP secret", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const encrypted = encryptMfaSecret(secret);
    expect(decryptMfaSecret(encrypted)).toBe(secret);
  });

  it("never stores the secret in plaintext", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const encrypted = encryptMfaSecret(secret);
    expect(encrypted).not.toContain(secret);
  });

  it("uses a fresh IV each time, so the same secret encrypts differently", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const first = encryptMfaSecret(secret);
    const second = encryptMfaSecret(secret);
    expect(first).not.toBe(second);
    expect(decryptMfaSecret(first)).toBe(secret);
    expect(decryptMfaSecret(second)).toBe(secret);
  });

  it("stores as iv:authTag:ciphertext hex", () => {
    const encrypted = encryptMfaSecret("JBSWY3DPEHPK3PXP");
    expect(encrypted.split(":")).toHaveLength(3);
    expect(encrypted).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
  });

  it("throws on a malformed stored value", () => {
    expect(() => decryptMfaSecret("not-a-valid-encrypted-secret")).toThrow(
      "Malformed encrypted MFA secret",
    );
  });

  it("throws when the ciphertext has been tampered with (auth tag mismatch)", () => {
    const encrypted = encryptMfaSecret("JBSWY3DPEHPK3PXP");
    const [iv, authTag, data] = encrypted.split(":");
    const tampered = [
      iv,
      authTag,
      data.slice(0, -2) + (data.slice(-2) === "00" ? "ff" : "00"),
    ].join(":");
    expect(() => decryptMfaSecret(tampered)).toThrow();
  });
});
