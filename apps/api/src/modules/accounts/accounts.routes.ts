import { Router } from "express";
import * as accountsController from "./accounts.controller";
import { requireAccountAuth } from "../../shared/middlewares/require-account-auth.middleware";
import { requireAccountPermission } from "../../shared/middlewares/require-account-permission.middleware";

export const accountsRouter = Router();

// --- Public: the body is the credential ----------------------------------
accountsRouter.post("/signup", accountsController.signup);
accountsRouter.post("/login", accountsController.login);
accountsRouter.post("/google", accountsController.googleLogin);
accountsRouter.post("/refresh", accountsController.refresh);
accountsRouter.post("/logout", accountsController.logout);
// The second step of signing in with two-factor on — no session exists
// yet, so it's gated by the short-lived challenge token instead.
accountsRouter.post("/mfa/challenge", accountsController.mfaLoginChallenge);
// The emailed invite token in the body *is* the credential, same as
// /login's password. See accounts.service.ts's redeemInvite.
accountsRouter.post("/invite/redeem", accountsController.redeemInvite);

// --- Signed in: the caller's own things ---------------------------------
// Open to every member — none of these reach anyone else.
accountsRouter.get("/me", requireAccountAuth, accountsController.me);
accountsRouter.patch("/me/profile", requireAccountAuth, accountsController.updateOwnProfile);
// Only while the caller has no password at all — see setInitialPassword.
// Changing an existing one goes through the coded request/confirm pair.
accountsRouter.post(
  "/me/password/initial",
  requireAccountAuth,
  accountsController.setInitialPassword,
);
accountsRouter.post(
  "/security/password/request-code",
  requireAccountAuth,
  accountsController.requestPasswordResetCode,
);
accountsRouter.post(
  "/security/password/confirm",
  requireAccountAuth,
  accountsController.confirmSetPassword,
);
accountsRouter.post("/security/mfa/setup", requireAccountAuth, accountsController.beginMfaSetup);
accountsRouter.post(
  "/security/mfa/confirm",
  requireAccountAuth,
  accountsController.confirmMfaSetup,
);
accountsRouter.post("/security/mfa/disable", requireAccountAuth, accountsController.disableMfa);
accountsRouter.get("/security/sessions", requireAccountAuth, accountsController.listSessions);
// Registered before "/:sessionId/revoke" so the literal segment wins.
accountsRouter.post(
  "/security/sessions/revoke-others",
  requireAccountAuth,
  accountsController.revokeOtherSessions,
);
accountsRouter.post(
  "/security/sessions/:sessionId/revoke",
  requireAccountAuth,
  accountsController.revokeSession,
);

// --- Signed in: the business's own things -------------------------------
accountsRouter.patch(
  "/settings/business",
  requireAccountAuth,
  requireAccountPermission("business.manage"),
  accountsController.updateBusiness,
);
