import { describe, expect, it } from "vitest";
import { generateOpenApiDocument } from "./shared/openapi/document";

/**
 * A boot smoke test for the API's documented surface.
 *
 * Two failure modes this catches that nothing else does, and both take
 * the whole API down at startup rather than failing one request:
 *
 *  - `generateOpenApiDocument()` runs at module evaluation in app.ts, and
 *    it throws if two modules ever register the same component name. That
 *    is a mistake it is very easy to make when a new module copies a
 *    validators file — and it turns into a crash loop on deploy, not a
 *    test failure.
 *  - A route that exists but was never registered in the document is a
 *    route nobody outside this repo can discover. The list below is the
 *    contract the back office and the business app are written against; a rename on either
 *    side should break here first. Add a module's paths here when it
 *    lands.
 */
const EXPECTED_PATHS = [
  "/health",
  // Back-office identity
  "/auth/google",
  "/auth/mfa/setup",
  "/auth/mfa/verify-setup",
  "/auth/mfa/challenge",
  "/auth/mfa/reset",
  "/auth/refresh",
  "/auth/logout",
  "/auth/me",
  // Who can sign in, and what they may do
  "/users",
  "/users/{userId}/role",
  "/users/{userId}/active",
  "/roles",
  "/roles/permissions",
  "/roles/{roleId}/permissions",
  "/roles/{roleId}",
  // Billing — plans and prices in Stripe, and the links that sell them
  "/billing/products",
  "/billing/products/admin",
  "/billing/products/{productId}/archive",
  "/billing/products/{productId}/prices",
  "/billing/prices/{priceId}/archive",
  "/billing/prices/{priceId}/visibility",
  "/billing/payment-links",
  "/billing/prices/{priceId}/payment-link",
  "/billing/signup-links/{token}",
  // Business app — the business, signing in, and the caller's own security
  "/accounts/signup",
  "/accounts/login",
  "/accounts/google",
  "/accounts/mfa/challenge",
  "/accounts/refresh",
  "/accounts/logout",
  "/accounts/invite/redeem",
  "/accounts/me",
  "/accounts/me/profile",
  "/accounts/me/password/initial",
  "/accounts/settings/business",
  "/accounts/security/password/request-code",
  "/accounts/security/password/confirm",
  "/accounts/security/mfa/setup",
  "/accounts/security/mfa/confirm",
  "/accounts/security/mfa/disable",
  "/accounts/security/sessions",
  "/accounts/security/sessions/{sessionId}/revoke",
  "/accounts/security/sessions/revoke-others",
  // Business app — the team and its roles
  "/staff",
  "/staff/{staffId}",
  "/staff/{staffId}/active",
  "/staff/{staffId}/invite/resend",
  "/staff/{staffId}/invite/link",
  "/staff/roles",
  "/staff/roles/permissions",
  "/staff/roles/{roleId}",
  "/staff/roles/{roleId}/permissions",
];

describe("the OpenAPI surface", () => {
  const document = generateOpenApiDocument();

  it("generates without a duplicate component name", () => {
    expect(document.openapi).toBe("3.0.0");
    expect(Object.keys(document.paths ?? {}).length).toBeGreaterThan(0);
  });

  it.each(EXPECTED_PATHS)("documents %s", (path) => {
    expect(document.paths).toHaveProperty([path]);
  });

  it("documents nothing the list above doesn't know about", () => {
    // The other direction: a path in the document but not in the list is
    // usually a rename that only happened on one side.
    expect(Object.keys(document.paths ?? {}).sort()).toEqual([...EXPECTED_PATHS].sort());
  });
});
