import { registry } from "./registry";
import { z } from "./zod";

registry.registerPath({
  method: "get",
  path: "/health",
  tags: ["Health"],
  summary: "Liveness check",
  responses: {
    200: {
      description: "OK",
      content: { "application/json": { schema: z.object({ status: z.literal("ok") }) } },
    },
  },
});
