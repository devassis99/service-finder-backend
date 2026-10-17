import { describe, it, expect } from "vitest";
import {
  confirmSetPasswordSchema,
  loginSchema,
  signupSchema,
  updateBusinessSchema,
} from "./accounts.validators";

const signup = {
  fullName: "Amara Okafor",
  workEmail: "amara@brightfix.com",
  password: "a-long-password",
  businessName: "BrightFix Repairs",
};

describe("signupSchema", () => {
  it("accepts a password sign-up", () => {
    expect(signupSchema.safeParse(signup).success).toBe(true);
  });

  it("accepts a Google sign-up with no password", () => {
    const { password: _password, ...rest } = signup;
    expect(signupSchema.safeParse({ ...rest, googleIdToken: "id-token" }).success).toBe(true);
  });

  it("refuses a sign-up with neither a password nor a Google token", () => {
    const { password: _password, ...rest } = signup;
    expect(signupSchema.safeParse(rest).success).toBe(false);
  });

  it("refuses a password under 8 characters", () => {
    expect(signupSchema.safeParse({ ...signup, password: "short" }).success).toBe(false);
  });

  it("refuses a blank business or person name", () => {
    expect(signupSchema.safeParse({ ...signup, businessName: "   " }).success).toBe(false);
    expect(signupSchema.safeParse({ ...signup, fullName: "" }).success).toBe(false);
  });

  it("normalises the email to one spelling", () => {
    const parsed = signupSchema.parse({ ...signup, workEmail: "  Amara@BrightFix.COM " });
    expect(parsed.workEmail).toBe("amara@brightfix.com");
  });
});

describe("loginSchema", () => {
  it("looks a person up by the same spelling sign-up stored", () => {
    expect(loginSchema.parse({ email: "Jo@Example.com", password: "x" }).email).toBe(
      "jo@example.com",
    );
  });

  it("refuses something that isn't an email", () => {
    expect(loginSchema.safeParse({ email: "jo", password: "x" }).success).toBe(false);
  });
});

describe("confirmSetPasswordSchema", () => {
  it("takes the emailed code or the authenticator code", () => {
    expect(
      confirmSetPasswordSchema.safeParse({ newPassword: "new-password", code: "123456" }).success,
    ).toBe(true);
    expect(
      confirmSetPasswordSchema.safeParse({ newPassword: "new-password", totpCode: "123456" })
        .success,
    ).toBe(true);
  });

  it("refuses both, or neither", () => {
    expect(
      confirmSetPasswordSchema.safeParse({
        newPassword: "new-password",
        code: "123456",
        totpCode: "654321",
      }).success,
    ).toBe(false);
    expect(confirmSetPasswordSchema.safeParse({ newPassword: "new-password" }).success).toBe(false);
  });
});

describe("updateBusinessSchema", () => {
  it("lets the phone be cleared, and leaves omitted fields out", () => {
    expect(updateBusinessSchema.parse({ phone: null })).toEqual({ phone: null });
    expect(updateBusinessSchema.parse({})).toEqual({});
  });
});
