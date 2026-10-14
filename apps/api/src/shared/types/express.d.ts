import "express";

declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth once a valid back-office access token has been verified. */
      boUser?: {
        id: string;
        roleId: string;
        email: string;
      };
      // Each future audience (the provider app's staff, the customer app's
      // users) gets its own optional field here, set by its own
      // require-*-auth middleware — never a shared "user" field, so a
      // route can't accidentally accept one audience's token as another's.
    }
  }
}

export {};
