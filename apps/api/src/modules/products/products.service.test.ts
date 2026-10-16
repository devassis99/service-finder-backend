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
  const db: Record<string, unknown> = {
    select: vi.fn(() => localChain([])),
    insert: vi.fn(() => localChain([])),
    update: vi.fn(() => localChain([])),
    delete: vi.fn(() => localChain([])),
  };
  // Reads that must see the latest write go to db.$primary — the same
  // mock here, so a test configures one queue whichever a call uses.
  db.$primary = db;
  return {
    mockDb: db as Record<"select" | "insert" | "update" | "delete", ReturnType<typeof vi.fn>>,
  };
});
vi.mock("../../db", () => ({ db: mockDb }));

const { mockStripe } = vi.hoisted(() => ({
  mockStripe: { products: { create: vi.fn(), update: vi.fn() } },
}));
vi.mock("../../shared/stripe", () => ({ stripe: mockStripe }));

import { ConflictError } from "../auth";
import {
  NotFoundError,
  createProduct,
  archiveProduct,
  listCatalog,
  listAdminCatalog,
} from "./products.service";

describe("createProduct", () => {
  it("creates a Stripe product and stores the local row with sane defaults", async () => {
    mockDb.select.mockReturnValueOnce(chain([])); // no product with this key yet
    mockStripe.products.create.mockResolvedValueOnce({ id: "stripe_prod_1" });
    const insertChain = chain([
      { id: "prod_1", key: "pro", features: [], limits: {}, trialDays: 0 },
    ]);
    mockDb.insert.mockReturnValueOnce(insertChain);

    const result = await createProduct({ key: "pro", name: "Pro" });

    expect(result).toMatchObject({ id: "prod_1", key: "pro" });
    expect(mockStripe.products.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Pro", metadata: { key: "pro" } }),
    );
    expect((insertChain.values as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatchObject({
      stripeProductId: "stripe_prod_1",
      features: [],
      limits: {},
      trialDays: 0,
      sortOrder: 0,
    });
  });

  it("refuses a key that's already taken before anything reaches Stripe", async () => {
    mockDb.select.mockReturnValueOnce(chain([{ id: "prod_existing" }]));

    await expect(createProduct({ key: "pro", name: "pro" })).rejects.toThrow(ConflictError);
    expect(mockStripe.products.create).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });
});

describe("archiveProduct", () => {
  it("archives the product locally and in Stripe", async () => {
    const product = { id: "prod_1", stripeProductId: "stripe_prod_1" };
    mockDb.select.mockReturnValueOnce(chain([product]));
    mockDb.update.mockReturnValueOnce(chain([{ ...product, isActive: false }]));

    const result = await archiveProduct("prod_1");

    expect(result!.isActive).toBe(false);
    expect(mockStripe.products.update).toHaveBeenCalledWith("stripe_prod_1", { active: false });
  });

  it("throws NotFoundError when the product doesn't exist", async () => {
    mockDb.select.mockReturnValueOnce(chain([]));
    await expect(archiveProduct("ghost")).rejects.toThrow(NotFoundError);
    expect(mockStripe.products.update).not.toHaveBeenCalled();
  });
});

describe("listCatalog", () => {
  it("nests each product's active prices and excludes archived/hidden products", async () => {
    const product = { id: "prod_1", sortOrder: 0 };
    const price = { id: "price_1", productId: "prod_1", isActive: true };
    mockDb.select.mockReturnValueOnce(chain([product])).mockReturnValueOnce(chain([price]));

    const result = await listCatalog();

    expect(result).toEqual([{ ...product, prices: [price] }]);
  });

  it("drops a product whose prices are all hidden from self-signup", async () => {
    const visible = { id: "prod_1", sortOrder: 0 };
    const allHidden = { id: "prod_2", sortOrder: 1 };
    const price = { id: "price_1", productId: "prod_1", isActive: true, showOnSignup: true };
    mockDb.select
      .mockReturnValueOnce(chain([visible, allHidden]))
      .mockReturnValueOnce(chain([price]));

    const result = await listCatalog();

    expect(result).toEqual([{ ...visible, prices: [price] }]);
  });
});

describe("listAdminCatalog", () => {
  it("includes archived products and prices, unfiltered", async () => {
    const active = { id: "prod_1", sortOrder: 0 };
    const archived = { id: "prod_2", sortOrder: 1 };
    const price = { id: "price_1", productId: "prod_2", isActive: false };
    mockDb.select
      .mockReturnValueOnce(chain([active, archived]))
      .mockReturnValueOnce(chain([price]));

    const result = await listAdminCatalog();

    expect(result).toEqual([
      { ...active, prices: [] },
      { ...archived, prices: [price] },
    ]);
  });
});
