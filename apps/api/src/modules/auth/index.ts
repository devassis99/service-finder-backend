// This module's public surface — other modules and app.ts should only
// ever import from here, not reach into auth's internal files directly.
export { authRouter } from "./auth.routes";
// requireAuth/requirePermission live in src/shared/middlewares/ (shared,
// app-wide request middleware, alongside error-handler.ts) — re-exported
// here since every other module reaches them through auth's public
// surface rather than importing shared/middlewares directly.
export { requireAuth } from "../../shared/middlewares/require-auth.middleware";
export { requirePermission } from "../../shared/middlewares/require-permission.middleware";
// Error classes are part of the public surface too — the users and
// roles modules throw these directly (e.g. NotFoundError for a missing
// role, ForbiddenError for a self-role-change attempt) so the shared
// error-handler middleware can map them to the right HTTP status.
export { AuthError, ForbiddenError, ConflictError, NotFoundError } from "./auth.service";
