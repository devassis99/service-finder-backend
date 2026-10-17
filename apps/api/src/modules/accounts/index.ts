// This module's public surface — other modules and app.ts should only
// ever import from here, not reach into accounts' internal files
// directly.
export { accountsRouter } from "./accounts.routes";
// requireAccountAuth/requireAccountPermission live in
// src/shared/middlewares/ (app-wide request middleware, same reasoning as
// auth's requireAuth) — re-exported here so a future business-side
// module reaches them through accounts' public surface.
export { requireAccountAuth } from "../../shared/middlewares/require-account-auth.middleware";
export { requireAccountPermission } from "../../shared/middlewares/require-account-permission.middleware";
export { AuthError, ConflictError, NotFoundError } from "./accounts.service";
