// This module's public surface — other modules and app.ts should only
// ever import from here, not reach into products' internal files
// directly. Exception: error-handler.ts imports NotFoundError straight
// from products.service.ts, same as it already does for auth's error
// classes — see that file's comment.
export { productsRouter } from "./products.routes";
export { NotFoundError } from "./products.service";
