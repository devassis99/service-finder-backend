import type { NextFunction, Request, Response } from "express";
import { verifyToken } from "../../modules/auth/jwt";
import { AuthError, getUserById } from "../../modules/auth/auth.service";

/**
 * Verifies the bearer access token and attaches req.boUser. Throws
 * AuthError on anything wrong — Express 5 forwards a thrown/rejected
 * error from an async middleware to errorHandler automatically, so
 * there's no manual try/catch-and-next(err) needed here.
 *
 * Lives here (not inside modules/auth/) because it's app-wide request
 * middleware, same as error-handler.ts and require-permission.middleware.ts
 * — every module's routes reach it via the auth module's public surface
 * (modules/auth/index.ts re-exports it), not by importing this file
 * directly.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new AuthError("Missing bearer token");
  }
  const token = header.slice("Bearer ".length);

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    throw new AuthError("Invalid or expired access token");
  }

  if (payload.purpose !== "access") {
    throw new AuthError("Token is not a valid access token");
  }

  const user = await getUserById(payload.sub);
  if (!user?.isActive) {
    throw new AuthError("Invalid or expired access token");
  }

  req.boUser = { id: user.id, roleId: user.roleId, email: user.email };
  next();
}
