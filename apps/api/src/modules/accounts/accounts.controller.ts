import type { Request, Response } from "express";
import * as accountsService from "./accounts.service";
import * as securityService from "./security.service";
import {
  signupSchema,
  loginSchema,
  googleLoginSchema,
  refreshSchema,
  confirmSetPasswordSchema,
  mfaCodeSchema,
  mfaChallengeConfirmSchema,
  revokeOtherSessionsSchema,
  sessionIdParamsSchema,
  redeemInviteSchema,
  updateOwnProfileSchema,
  updateBusinessSchema,
  setInitialPasswordSchema,
} from "./accounts.validators";
import {
  businessSignupLimits,
  deviceMessage,
  emailCodeLimits,
  passwordSignInLimits,
  signInMessage,
  takeAttempt,
} from "../../shared/rate-limit";

/**
 * Routes behind requireAccountAuth can rely on req.staffUser being set;
 * the rest (sign-up, sign-in, refresh, the MFA challenge, invite
 * redemption) are public, and the body is the credential.
 */

/** Express can hand back string | string[] for a repeated header — a session only ever wants the plain string, or none. */
function userAgentOf(req: Request): string | undefined {
  const value = req.headers["user-agent"];
  return typeof value === "string" ? value.slice(0, 512) : undefined;
}

/** The caller's own refresh token, when the app sends it — marks "this device" and keeps it alive across a password change. */
function currentRefreshTokenOf(req: Request): string | undefined {
  const value = req.headers["x-refresh-token"];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export async function signup(req: Request, res: Response) {
  const input = signupSchema.parse(req.body);
  await takeAttempt(businessSignupLimits(req.ip), deviceMessage);
  const tokens = await accountsService.signup(input, userAgentOf(req));
  res.status(201).json(tokens);
}

export async function login(req: Request, res: Response) {
  const { email, password } = loginSchema.parse(req.body);
  // Counted before the password is checked — see shared/rate-limit.ts.
  const attempt = await takeAttempt(passwordSignInLimits("staff", email, req.ip), signInMessage);
  const outcome = await accountsService.login(email, password, userAgentOf(req));
  await attempt.succeeded();
  res.json(outcome);
}

export async function googleLogin(req: Request, res: Response) {
  const { idToken } = googleLoginSchema.parse(req.body);
  const outcome = await accountsService.loginWithGoogle(idToken, userAgentOf(req));
  res.json(outcome);
}

/** Public on purpose: the token in the body *is* the credential. See accounts.service.ts's redeemInvite. */
export async function redeemInvite(req: Request, res: Response) {
  const { token } = redeemInviteSchema.parse(req.body);
  const outcome = await accountsService.redeemInvite(token, userAgentOf(req));
  res.json(outcome);
}

export async function refresh(req: Request, res: Response) {
  const { refreshToken } = refreshSchema.parse(req.body);
  const tokens = await accountsService.refreshSession(refreshToken, userAgentOf(req));
  res.json(tokens);
}

export async function logout(req: Request, res: Response) {
  const { refreshToken } = refreshSchema.parse(req.body);
  await accountsService.logout(refreshToken);
  res.status(204).send();
}

/** Second step of signing in with two-factor on. Not behind requireAccountAuth: the challenge token is the credential. */
export async function mfaLoginChallenge(req: Request, res: Response) {
  const { challengeToken, code } = mfaChallengeConfirmSchema.parse(req.body);
  const tokens = await securityService.confirmMfaLoginChallenge(
    challengeToken,
    code,
    userAgentOf(req),
  );
  res.json(tokens);
}

export async function me(req: Request, res: Response) {
  const details = await accountsService.getMeDetails(req.staffUser!.id);
  if (!details) {
    throw new accountsService.AuthError("Account not found", "TOKEN_INVALID");
  }
  res.json(details);
}

export async function updateOwnProfile(req: Request, res: Response) {
  const patch = updateOwnProfileSchema.parse(req.body);
  res.json(await accountsService.updateOwnProfile(req.staffUser!.id, patch));
}

export async function updateBusiness(req: Request, res: Response) {
  const patch = updateBusinessSchema.parse(req.body);
  const account = await accountsService.updateBusiness(req.staffUser!.accountId, patch);
  res.json({ account });
}

export async function setInitialPassword(req: Request, res: Response) {
  const { newPassword } = setInitialPasswordSchema.parse(req.body);
  await securityService.setInitialPassword(req.staffUser!.id, newPassword);
  res.status(204).send();
}

/** Set/Change password, step 1 — the emailed code, for someone without two-factor. */
export async function requestPasswordResetCode(req: Request, res: Response) {
  await takeAttempt(emailCodeLimits(req.ip), deviceMessage);
  await securityService.requestPasswordResetCode(req.staffUser!.id);
  res.status(204).send();
}

/** Set/Change password, final step — checks the code (or authenticator code) and writes the new password. */
export async function confirmSetPassword(req: Request, res: Response) {
  const input = confirmSetPasswordSchema.parse(req.body);
  await securityService.confirmSetPassword(req.staffUser!.id, input, currentRefreshTokenOf(req));
  res.status(204).send();
}

export async function beginMfaSetup(req: Request, res: Response) {
  res.json(await securityService.beginMfaSetup(req.staffUser!.id));
}

export async function confirmMfaSetup(req: Request, res: Response) {
  const { code } = mfaCodeSchema.parse(req.body);
  await securityService.confirmMfaSetup(req.staffUser!.id, code);
  res.status(204).send();
}

export async function disableMfa(req: Request, res: Response) {
  const { code } = mfaCodeSchema.parse(req.body);
  await securityService.disableMfa(req.staffUser!.id, code);
  res.status(204).send();
}

export async function listSessions(req: Request, res: Response) {
  const sessions = await securityService.listSessions(
    req.staffUser!.id,
    currentRefreshTokenOf(req),
  );
  res.json({ sessions });
}

export async function revokeSession(req: Request, res: Response) {
  const { sessionId } = sessionIdParamsSchema.parse(req.params);
  await securityService.revokeSession(req.staffUser!.id, sessionId);
  res.status(204).send();
}

export async function revokeOtherSessions(req: Request, res: Response) {
  const { currentRefreshToken } = revokeOtherSessionsSchema.parse(req.body);
  await securityService.revokeOtherSessions(req.staffUser!.id, currentRefreshToken);
  res.status(204).send();
}
