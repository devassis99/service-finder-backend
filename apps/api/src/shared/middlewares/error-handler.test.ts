import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import Stripe from "stripe";
import { errorHandler } from "./error-handler";
import { NotFoundError as BillingNotFoundError } from "../../modules/products/products.service";

vi.mock("../../db", () => ({ db: {} }));
vi.mock("../stripe", () => ({ stripe: {} }));

function run(err: unknown) {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    setHeader: vi.fn(),
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  errorHandler(err, { method: "POST" } as Request, res as unknown as Response, vi.fn());
  return res;
}

describe("errorHandler", () => {
  it("answers a billing NotFoundError with 404", () => {
    const res = run(new BillingNotFoundError("Price not found"));
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: "Price not found" });
  });

  describe("Stripe errors", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    it("passes Stripe's own message on for a request it judged invalid", () => {
      const res = run(
        new Stripe.errors.StripeInvalidRequestError({
          message: "Amount must be at least $0.50 usd",
          type: "invalid_request_error",
        }),
      );
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({
        error: "Stripe: Amount must be at least $0.50 usd",
        code: "STRIPE_REJECTED",
      });
    });

    it("says only that Stripe failed when the fault isn't the request's", () => {
      const res = run(
        new Stripe.errors.StripeAuthenticationError({
          message: "Invalid API Key provided: sk_test_****",
          type: "authentication_error",
        }),
      );
      expect(res.statusCode).toBe(502);
      expect(res.body).toMatchObject({ code: "STRIPE_UNAVAILABLE" });
      expect(JSON.stringify(res.body)).not.toContain("API Key");
      expect(consoleError).toHaveBeenCalled();
    });
  });
});
