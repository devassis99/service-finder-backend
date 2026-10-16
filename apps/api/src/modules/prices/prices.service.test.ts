import { describe, it, expect, vi } from "vitest";
import { chain } from "../../test/mocks/drizzle";

const { mockDb } = vi.hoisted(() => {
  function localChain(rows: unknown) {
    const p = Promise.resolve(rows) as unknown as Record<string, (...a: unknown[]) => unknown>;
    for (const m of ["from", "where", "orderBy", "values", "set", "returning"]) {
      p[m] = vi.fn(() => p);
    }
    return p;
  }
  const db = {
    select: vi.fn(() => localChain([])),
    insert: vi.fn(() => localChain([])),
    update: vi.fn(() => localChain([])),
    delete: vi.fn(() => localChain([])),
    // The callback gets this same mock as its `tx`, so a test queues a
    // transaction's update/insert results exactly like top-level ones.
    transaction: vi.fn(),
  };
  db.transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db));
  return { mockDb: db };
});
vi.mock("../../db", () => ({ db: mockDb }));

const { mockStripe } = vi.hoisted(() => ({
  mockStripe: { prices: { create: vi.fn(), update: vi.fn() } },
}));
vi.mock("../../shared/stripe", () => ({ stripe: mockStripe }));

import { ConflictError } from "../auth";
import { NotFoundError } from "../products";
import { createPrice, archivePrice, setShowOnSignup } from "./prices.service";

const product = { id: "prod_1", stripeProductId: "stripe_prod_1", isActive: true };

describe("createPrice", () => {
  it("replaces the cadence's active price — in the table and in Stripe", async () => {
    mockDb.select.mockReturnValueOnce(chain([product]));
    mockStripe.prices.create.mockResolvedValueOnce({ id: "stripe_price_new" });
    mockStripe.prices.update.mockResolvedValueOnce({});
    mockDb.update.mockReturnValueOnce(
      chain([{ stripePriceId: "stripe_price_old", showOnSignup: false }]),
    );
    const insertChain = chain([
      { id: "price_new", productId: "prod_1", billingInterval: "month", unitAmount: 4900 },
    ]);
    mockDb.insert.mockReturnValueOnce(insertChain);

    const result = await createPrice("prod_1", { billingInterval: "month", unitAmount: 4900 });

    expect(result).toMatchObject({ id: "price_new", unitAmount: 4900 });
    expect(mockStripe.prices.create).toHaveBeenCalledWith(
      expect.objectContaining({ product: "stripe_prod_1", unit_amount: 4900, currency: "usd" }),
    );
    expect(mockDb.transaction).toHaveBeenCalledOnce();
    // A hidden cadence stays hidden after re-pricing.
    expect((insertChain.values as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatchObject({
      stripePriceId: "stripe_price_new",
      showOnSignup: false,
    });
    expect(mockStripe.prices.update).toHaveBeenCalledWith("stripe_price_old", { active: false });
  });

  it("shows a cadence's first price on self-signup and maps the cycle for Stripe", async () => {
    mockDb.select.mockReturnValueOnce(chain([product]));
    mockStripe.prices.create.mockResolvedValueOnce({ id: "stripe_price_new" });
    mockDb.update.mockReturnValueOnce(chain([])); // nothing to replace
    const insertChain = chain([{ id: "price_new" }]);
    mockDb.insert.mockReturnValueOnce(insertChain);

    await createPrice("prod_1", { billingInterval: "half_year", unitAmount: 24900 });

    expect(mockStripe.prices.create).toHaveBeenCalledWith(
      expect.objectContaining({
        currency: "usd",
        recurring: { interval: "month", interval_count: 6 },
      }),
    );
    expect((insertChain.values as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatchObject({
      showOnSignup: true,
    });
    expect(mockStripe.prices.update).not.toHaveBeenCalled();
  });

  it("lowercases the currency Stripe and the table get", async () => {
    mockDb.select.mockReturnValueOnce(chain([product]));
    mockStripe.prices.create.mockResolvedValueOnce({ id: "stripe_price_new" });
    mockDb.insert.mockReturnValueOnce(chain([{ id: "price_new" }]));

    await createPrice("prod_1", { billingInterval: "year", unitAmount: 9900, currency: "EUR" });

    expect(mockStripe.prices.create).toHaveBeenCalledWith(
      expect.objectContaining({
        currency: "eur",
        recurring: { interval: "year", interval_count: 1 },
      }),
    );
  });

  it("leaves the current price alone when Stripe refuses the new one", async () => {
    mockDb.select.mockReturnValueOnce(chain([product]));
    mockStripe.prices.create.mockRejectedValueOnce(new Error("Invalid currency"));

    await expect(
      createPrice("prod_1", { billingInterval: "month", unitAmount: 4900 }),
    ).rejects.toThrow("Invalid currency");
    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("archives the new Stripe price again if the row can't be written", async () => {
    mockDb.select.mockReturnValueOnce(chain([product]));
    mockStripe.prices.create.mockResolvedValueOnce({ id: "stripe_price_orphan" });
    mockStripe.prices.update.mockResolvedValueOnce({});
    mockDb.transaction.mockRejectedValueOnce(new Error("duplicate key value"));

    await expect(
      createPrice("prod_1", { billingInterval: "month", unitAmount: 4900 }),
    ).rejects.toThrow("duplicate key value");
    expect(mockStripe.prices.update).toHaveBeenCalledWith("stripe_price_orphan", {
      active: false,
    });
  });

  it("still succeeds when archiving the replaced Stripe price fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockDb.select.mockReturnValueOnce(chain([product]));
    mockStripe.prices.create.mockResolvedValueOnce({ id: "stripe_price_new" });
    mockStripe.prices.update.mockRejectedValueOnce(new Error("Stripe is down"));
    mockDb.update.mockReturnValueOnce(
      chain([{ stripePriceId: "stripe_price_old", showOnSignup: true }]),
    );
    mockDb.insert.mockReturnValueOnce(chain([{ id: "price_new" }]));

    const result = await createPrice("prod_1", { billingInterval: "month", unitAmount: 4900 });

    expect(result).toMatchObject({ id: "price_new" });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("throws NotFoundError when the product doesn't exist", async () => {
    mockDb.select.mockReturnValueOnce(chain([]));
    await expect(
      createPrice("ghost", { billingInterval: "month", unitAmount: 1000 }),
    ).rejects.toThrow(NotFoundError);
    expect(mockStripe.prices.create).not.toHaveBeenCalled();
  });

  it("refuses an archived product", async () => {
    mockDb.select.mockReturnValueOnce(chain([{ ...product, isActive: false }]));
    await expect(
      createPrice("prod_1", { billingInterval: "month", unitAmount: 1000 }),
    ).rejects.toThrow(ConflictError);
    expect(mockStripe.prices.create).not.toHaveBeenCalled();
  });
});

describe("archivePrice", () => {
  it("archives the price locally and in Stripe", async () => {
    const price = { id: "price_1", stripePriceId: "stripe_price_1", isActive: true };
    mockDb.select.mockReturnValueOnce(chain([price]));
    mockDb.update.mockReturnValueOnce(chain([{ ...price, isActive: false }]));

    const result = await archivePrice("price_1");

    expect(result!.isActive).toBe(false);
    expect(mockStripe.prices.update).toHaveBeenCalledWith("stripe_price_1", { active: false });
  });

  it("throws NotFoundError when the price doesn't exist", async () => {
    mockDb.select.mockReturnValueOnce(chain([]));
    await expect(archivePrice("ghost")).rejects.toThrow(NotFoundError);
    expect(mockStripe.prices.update).not.toHaveBeenCalled();
  });
});

describe("setShowOnSignup", () => {
  it("toggles one price's visibility without touching Stripe", async () => {
    mockDb.update.mockReturnValueOnce(chain([{ id: "price_1", showOnSignup: false }]));

    const result = await setShowOnSignup("price_1", false);

    expect(result.showOnSignup).toBe(false);
    expect(mockStripe.prices.update).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when the price doesn't exist", async () => {
    mockDb.update.mockReturnValueOnce(chain([]));
    await expect(setShowOnSignup("ghost", true)).rejects.toThrow(NotFoundError);
  });
});
