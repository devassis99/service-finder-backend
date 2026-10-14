import { Router } from "express";
import * as authController from "./auth.controller";
import { requireAuth } from "../../shared/middlewares/require-auth.middleware";

export const authRouter = Router();

authRouter.post("/google", authController.googleLogin);
authRouter.post("/mfa/setup", authController.beginMfaSetup);
authRouter.post("/mfa/verify-setup", authController.completeMfaSetup);
authRouter.post("/mfa/challenge", authController.mfaChallenge);
authRouter.post("/mfa/reset", requireAuth, authController.requestMfaReset);
authRouter.post("/refresh", authController.refresh);
authRouter.post("/logout", authController.logout);
authRouter.get("/me", requireAuth, authController.me);
