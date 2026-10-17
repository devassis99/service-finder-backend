import { OpenAPIGenerator } from "@asteasolutions/zod-to-openapi";
import { registry } from "./registry";
// Side-effect imports — each registers its paths against the shared
// registry above. Order doesn't matter; every path ends up in the same
// document regardless of which module it was registered from. A new
// module adds its own *.openapi.ts here, or its routes are invisible in
// /docs (and app.routes.test.ts should say so).
import "./health.openapi";
import "../../modules/auth/auth.openapi";
import "../../modules/users/users.openapi";
import "../../modules/roles/roles.openapi";
import "../../modules/products/products.openapi";
import "../../modules/prices/prices.openapi";
import "../../modules/payment-links/payment-links.openapi";
import "../../modules/accounts/accounts.openapi";
import "../../modules/staff-users/staff.openapi";
import "../../modules/staff-roles/staff-roles.openapi";

/** Builds the OpenAPI document fresh from whatever's currently registered — call once at startup, not per-request. */
export function generateOpenApiDocument() {
  const generator = new OpenAPIGenerator(registry.definitions, "3.0.0");

  return generator.generateDocument({
    info: {
      title: "Service Finder API",
      version: "1.0.0",
      description:
        "Back-office identity — Google OAuth + mandatory TOTP MFA and RBAC — subscription billing (plans and prices mirrored in Stripe), and the business app's identity: businesses, their teams, and custom roles & permissions. Service Finder's own domain follows.",
    },
    servers: [{ url: "/", description: "Current server" }],
    tags: [
      { name: "Health", description: "Liveness check" },
      { name: "Auth", description: "Google OAuth + mandatory TOTP MFA for back-office users" },
      { name: "Users", description: "Invite and manage back-office users" },
      { name: "Roles", description: "Role & permission management (RBAC)" },
      {
        name: "Billing",
        description: "Subscription plans, prices and payment links, mirrored in Stripe",
      },
      {
        name: "Business Accounts",
        description:
          "The business app: sign-up, sign-in (password or Google, optional TOTP 2FA), invites, and the caller's own profile and security",
      },
      { name: "Business Team", description: "Invite and manage the people on a business" },
      {
        name: "Business Roles",
        description: "A business's custom roles and what each one may do",
      },
    ],
  });
}
