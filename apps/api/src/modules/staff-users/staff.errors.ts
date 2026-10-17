/**
 * The team modules' own error classes (staff-users and staff-roles share
 * them), checked by shared/middlewares/error-handler.ts alongside every
 * other module's.
 *
 * They live in a file of their own rather than in staff.service.ts so
 * that the files staff.service.ts itself imports (staff-invites.service.ts,
 * staff-roles.service.ts) can throw them without importing back into it —
 * that round trip is an import cycle, which .oxlintrc.json rejects
 * (import/no-cycle).
 */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

/** Signed in, but this member's role doesn't allow it — or it would let them reach past their own permissions. */
export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}
