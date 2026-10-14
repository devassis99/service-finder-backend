import type { Request, Response } from "express";
import * as authService from "./auth.service";
import {
  googleLoginSchema,
  mfaCodeSchema,
  mfaResetRequestSchema,
  refreshSchema,
} from "./auth.validators";

function bearerToken(req: Request): string {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new authService.AuthError("Missing bearer token");
  }
  return header.slice("Bearer ".length);
}

export async function googleLogin(req: Request, res: Response) {
  const { idToken } = googleLoginSchema.parse(req.body);
  const outcome = await authService.loginWithGoogle(idToken);
  res.json(outcome);
}

export async function beginMfaSetup(req: Request, res: Response) {
  const setupToken = bearerToken(req);
  const result = await authService.beginMfaSetup(setupToken);
  res.json(result);
}

export async function completeMfaSetup(req: Request, res: Response) {
  const setupToken = bearerToken(req);
  const { code } = mfaCodeSchema.parse(req.body);
  const tokens = await authService.completeMfaSetup(setupToken, code);
  res.json(tokens);
}

export async function mfaChallenge(req: Request, res: Response) {
  const challengeToken = bearerToken(req);
  const { code } = mfaCodeSchema.parse(req.body);
  const tokens = await authService.verifyMfaChallenge(challengeToken, code);
  res.json(tokens);
}

/**
 * For an already-logged-in user (regular access token via requireAuth,
 * not a flow token) who wants to reconfigure their own MFA — e.g. lost
 * their phone. Requires their current TOTP code unless a previous reset
 * was already abandoned mid-flow (see auth.service.ts's
 * requestMfaReset). Returns a fresh mfa_setup flow token for the
 * frontend to hand straight to the existing MfaSetupPage flow.
 */
export async function requestMfaReset(req: Request, res: Response) {
  if (!req.boUser) {
    throw new authService.AuthError("Missing bearer token");
  }
  const { code } = mfaResetRequestSchema.parse(req.body);
  const result = await authService.requestMfaReset(req.boUser.id, code);
  res.json(result);
}

export async function refresh(req: Request, res: Response) {
  const { refreshToken } = refreshSchema.parse(req.body);
  const tokens = await authService.refreshSession(refreshToken);
  res.json(tokens);
}

export async function logout(req: Request, res: Response) {
  const { refreshToken } = refreshSchema.parse(req.body);
  await authService.logout(refreshToken);
  res.status(204).send();
}

/**
 * The frontend's source of truth for what to show: the current user,
 * their role, and the permission keys that role grants — AppShell uses
 * `permissions` to filter the nav and gate direct URL navigation into a
 * permission-gated route.
 */
export async function me(req: Request, res: Response) {
  if (!req.boUser) {
    throw new authService.AuthError("Missing bearer token");
  }
  const details = await authService.getMeDetails(req.boUser.id);
  if (!details) {
    throw new authService.AuthError("Account not found");
  }
  res.json(details);
}
