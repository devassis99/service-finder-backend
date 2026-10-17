import cors from "cors";
import express from "express";
import swaggerUi from "swagger-ui-express";
import { env } from "./config/env";
import { authRouter } from "./modules/auth";
import { usersRouter } from "./modules/users";
import { rolesRouter } from "./modules/roles";
import { productsRouter } from "./modules/products";
import { pricesRouter } from "./modules/prices";
import { paymentLinksRouter } from "./modules/payment-links";
import { accountsRouter } from "./modules/accounts";
import { staffRouter } from "./modules/staff-users";
import { errorHandler } from "./shared/middlewares/error-handler";
import { generateOpenApiDocument } from "./shared/openapi/document";

/**
 * The Express app itself, separate from src/index.ts (which just starts
 * it listening). Keeping them apart means this can be imported directly
 * in tests (e.g. with supertest) without opening a real port.
 */
export const app = express();

// req.ip is the caller's address only if Express knows how many proxies
// to look through — see TRUST_PROXY_HOPS in config/env.ts.
//
// Refused at start in production when it was never set, rather than left
// at 0: behind the load balancer every caller would then share the
// balancer's address, and every per-device limit in shared/rate-limit.ts
// would count the whole world as one device. Too high is as bad the
// other way — a value above the real number of proxies lets a caller
// pick their own address — so it has to be said, not guessed.
if (env.NODE_ENV === "production" && process.env.TRUST_PROXY_HOPS === undefined) {
  throw new Error(
    "TRUST_PROXY_HOPS is not set. Set it to the number of proxies in front of this server — 1 behind the AWS load balancer alone, 2 with CloudFront in front of that.",
  );
}
if (env.TRUST_PROXY_HOPS > 0) app.set("trust proxy", env.TRUST_PROXY_HOPS);

// The back office and the business app (and, later, the customer app)
// are separate SPAs calling this API cross-origin. Auth is bearer-token
// based, not cookie based, so `credentials: true` isn't needed — but the
// allow-list still comes from CORS_ORIGINS (env.ts) so it's explicit and
// configurable per environment rather than wildcarded.
app.use(
  cors({
    origin: env.CORS_ORIGINS,
  }),
);

// A route that needs the raw request bytes — a payment provider's signed
// webhook, say — goes here, *before* express.json(), with its own
// express.raw() body parser. Once express.json() has run, the body has
// been parsed and the signature over the original bytes can no longer be
// checked.

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// --- Back office ---------------------------------------------------------
// Service Finder's own operators: Google sign-in + mandatory TOTP MFA
// (auth), the people who can sign in (users), and what each of them may
// do (roles). Every route below /users and /roles is gated by
// requireAuth + a bo_permissions key.
app.use("/auth", authRouter);
app.use("/users", usersRouter);
app.use("/roles", rolesRouter);

// --- Billing --------------------------------------------------------------
// Subscription plans, mirrored in Stripe: products (the tiers), their
// prices (one active per cadence) and the links the Plans page hands out.
// Three modules on one "/billing" prefix — the URL contract is unchanged
// from iGroom's, so the back office's billing-api.ts reads the same.
// Most routes are plans.view/plans.manage; GET /billing/products (the
// pricing page's catalog) and GET /billing/signup-links/:token (the
// tenant app's /join page) are public.
app.use("/billing", productsRouter);
app.use("/billing", pricesRouter);
app.use("/billing", paymentLinksRouter);

// --- Business app ---------------------------------------------------------
// service-finder-frontend-tenant: the businesses on Service Finder and the
// people who run them. Its own identity system, apart from the back
// office's — its own tokens ("tenant_access", see @service-finder/auth),
// refresh tokens and tables — so neither audience's token is ever
// accepted by the other's routes. /accounts is the business and the
// caller's own sign-in and security; /staff is the team and its roles
// (requireAccountAuth + a staff_permissions key on every route).
app.use("/accounts", accountsRouter);
app.use("/staff", staffRouter);

// --- Service Finder's own domain goes here -------------------------------
// One module per area under src/modules/<name>/ (routes, controller,
// service, validators, openapi, index), mounted with its own prefix. A
// business-side area sits behind requireAccountAuth and gates on its own
// keys, added to staff-roles.service.ts's DEFAULT_PERMISSIONS. The
// customer app, when it arrives, gets its own identity module and URL
// family (iGroom's /app is the pattern), not /accounts.

// Interactive API docs at /docs, generated from the same Zod schemas
// that validate requests (each module's *.validators.ts) — the two
// can't drift apart. Raw spec at /docs.json, e.g. for importing into Postman.
const openApiDocument = generateOpenApiDocument();
app.get("/docs.json", (_req, res) => res.json(openApiDocument));
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiDocument));

// Must be registered last — Express only treats a 4-arg function as
// error-handling middleware, and only routes/middleware registered
// before it are covered.
app.use(errorHandler);
