import cors from "cors";
import express from "express";
import swaggerUi from "swagger-ui-express";
import { env } from "./config/env";
import { authRouter } from "./modules/auth";
import { usersRouter } from "./modules/users";
import { rolesRouter } from "./modules/roles";
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

// The back office (and, later, the provider and customer web apps) are
// separate SPAs calling this API cross-origin. Auth is bearer-token
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

// --- Service Finder's own domain goes here -------------------------------
// One module per area under src/modules/<name>/ (routes, controller,
// service, validators, openapi, index), mounted with its own prefix. When
// the provider and customer apps arrive they get their own identity
// modules and their own URL families — iGroom's split of /accounts for
// the business side and /app for the consumer side is the pattern to
// copy — rather than sharing the back office's /auth.

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
