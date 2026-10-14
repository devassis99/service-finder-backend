import { describe, it, expect, vi } from "vitest";

const { mockVerifyIdToken } = vi.hoisted(() => ({ mockVerifyIdToken: vi.fn() }));
vi.mock("google-auth-library", () => ({
  OAuth2Client: vi.fn().mockImplementation(() => ({ verifyIdToken: mockVerifyIdToken })),
}));

import { verifyGoogleIdToken } from "./google";

function ticket(payload: Record<string, unknown> | undefined) {
  return { getPayload: () => payload };
}

describe("verifyGoogleIdToken", () => {
  it("returns the verified identity for a valid token", async () => {
    mockVerifyIdToken.mockResolvedValueOnce(
      ticket({
        sub: "google-sub-1",
        email: "person@example.com",
        email_verified: true,
        name: "Person",
      }),
    );

    const identity = await verifyGoogleIdToken("valid-id-token");

    expect(identity).toEqual({
      googleSub: "google-sub-1",
      email: "person@example.com",
      emailVerified: true,
      name: "Person",
    });
  });

  it("defaults emailVerified to false when Google omits the claim", async () => {
    mockVerifyIdToken.mockResolvedValueOnce(
      ticket({ sub: "google-sub-1", email: "person@example.com" }),
    );

    const identity = await verifyGoogleIdToken("valid-id-token");
    expect(identity.emailVerified).toBe(false);
  });

  it("throws when the token payload is missing required claims", async () => {
    mockVerifyIdToken.mockResolvedValueOnce(ticket({ email: "person@example.com" })); // no sub
    await expect(verifyGoogleIdToken("bad-token")).rejects.toThrow(
      "Google ID token payload is missing required claims",
    );
  });

  it("propagates errors from an invalid/expired/forged token", async () => {
    mockVerifyIdToken.mockRejectedValueOnce(new Error("Token used too late"));
    await expect(verifyGoogleIdToken("expired-token")).rejects.toThrow("Token used too late");
  });
});
