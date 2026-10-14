// Every table lives directly in this folder (not scattered across each
// module's own schema/ subfolder) so any module — in any app — can import
// any other module's tables without reaching into that module's
// internals: the API's service files all import from
// "@service-finder/db/schema".
//
// This is also drizzle-kit's (apps/api/drizzle.config.ts) and the db
// client's (../client.ts) single entry point. A new table is a new file
// here plus one export line below, then `pnpm db:generate`.
export * from "./_schema";

// --- Back office (modules/auth, modules/users, modules/roles) ---
export * from "./bo-roles";
export * from "./bo-permissions";
export * from "./bo-role-permissions";
export * from "./bo-endpoints";
export * from "./bo-endpoint-permissions";
export * from "./bo-users";
export * from "./bo-refresh-tokens";

// --- Service Finder's own domain goes below ---
