// This module's public surface — other modules and app.ts should only
// ever import from here, not reach into payment-links' internal files
// directly. resolveSignupLink is here for the tenant signup flow, when it
// lands: the checkout and the account creation it starts must judge a
// link by the same rules the /join page did.
export { paymentLinksRouter } from "./payment-links.routes";
export { resolveSignupLink } from "./payment-links.service";
