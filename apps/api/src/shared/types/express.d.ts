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
      /**
       * Set by requireAccountAuth once a valid business-app access token
       * has been verified and its staff member is still active.
       */
      staffUser?: {
        id: string;
        accountId: string;
        /** staff_roles.id — see require-account-permission.middleware.ts for how this gates a route. */
        roleId: string | null;
        email: string;
      };
      // Each audience gets its own optional field here, set by its own
      // require-*-auth middleware — never a shared "user" field, so a
      // route can't accidentally accept one audience's token as another's.
      // The customer app's will be the next.
    }
  }
}

export {};
