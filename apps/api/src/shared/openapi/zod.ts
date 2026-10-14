import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

/**
 * Adds .openapi() to every Zod schema (a prototype patch — this is
 * still the exact same z from "zod", just extended). Import z from
 * here, not "zod" directly, in any module whose schemas need OpenAPI
 * metadata — the same schemas that validate requests double as the
 * documentation source, so the two can never drift apart.
 */
extendZodWithOpenApi(z);

export { z };
