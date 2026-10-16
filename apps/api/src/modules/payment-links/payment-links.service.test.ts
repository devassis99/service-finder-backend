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
  // db.$primary is the same mock, so one queue serves either.
  db.$primary = db;
  return {
    mockDb: db as Record<"select" | "insert" | "update" | "delete", ReturnType<typeof vi.fn>>,
  };
});
vi.mock("../../db", () => ({ db: mockDb }));

const { mockStripe } = vi.hoisted(() => ({
  mockStripe: {
    coupons: { create: vi.fn() },
    promotionCodes: { create: vi.fn() },
    paymentLinks: { create: vi.fn() },
  },
}));
vi.mock("../../shared/stripe", () => ({ stripe: mockStripe }));

import { ConflictError } from "../auth";
import { NotFoundError } from "../products";
import {
  createPaymentLinks,
  getOrCreateDefaultPaymentLink,
  getPublicSignupLink,
  resolveSignupLink,
} from "./payment-links.service";

const product = { id: "prod_1", key: "pro", isActive: true };
const monthlyPrice = {
  id: "price_month",
  productId: "prod_1",
  billingInterval: "month",
  stripePriceId: "sp_month",
  currency: "usd",
  isActive: true,
};
const quarterlyPrice = {
  id: "price_quarter",
  productId: "prod_1",
  billingInterval: "quarter",
  stripePriceId: "sp_quarter",
  currency: "eur",
  isActive: true,
};

describe("createPaymentLinks", () => {
  it("creates one Stripe Payment Link per requested billing cycle, no discount", async () => {
    mockDb.select.mockReturnValueOnce(chain([product])).mockReturnValueOnce(chain([monthlyPrice]));
    mockStripe.paymentLinks.create.mockResolvedValueOnce({
      id: "plink_1",
      url: "https://stripe/plink_1",
    });
    mockDb.insert.mockReturnValueOnce(
      chain([
        {
          id: "row_1",
          productId: "prod_1",
          priceId: "price_month",
          stripePaymentLinkId: "plink_1",
          url: "https://stripe/plink_1",
          token: null,
          stripePromotionCode: null,
          stripeCouponId: null,
          createdByUserId: "bo_1",
        },
      ]),
    );

    const result = await createPaymentLinks({ productId: "prod_1", billingIntervals: ["month"] });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "row_1",
      billingInterval: "month",
      url: "https://stripe/plink_1",
    });
    // Internal bookkeeping stays out of the response.
    expect(result[0]).not.toHaveProperty("stripeCouponId");
    expect(result[0]).not.toHaveProperty("createdByUserId");
    expect(mockStripe.coupons.create).not.toHaveBeenCalled();
  });

  it("makes one link for a cycle listed twice", async () => {
    mockDb.select.mockReturnValueOnce(chain([product])).mockReturnValueOnce(chain([monthlyPrice]));
    mockStripe.paymentLinks.create.mockResolvedValueOnce({ id: "plink_1", url: "u" });
    mockDb.insert.mockReturnValueOnce(chain([{ id: "row_1", token: null }]));

    await createPaymentLinks({ productId: "prod_1", billingIntervals: ["month", "month"] });

    expect(mockStripe.paymentLinks.create).toHaveBeenCalledOnce();
  });

  it("throws NotFoundError when the product doesn't exist", async () => {
    mockDb.select.mockReturnValueOnce(chain([]));
    await expect(
      createPaymentLinks({ productId: "ghost", billingIntervals: ["month"] }),
    ).rejects.toThrow(NotFoundError);
  });

  it("refuses an archived product", async () => {
    mockDb.select.mockReturnValueOnce(chain([{ ...product, isActive: false }]));
    await expect(
      createPaymentLinks({ productId: "prod_1", billingIntervals: ["month"] }),
    ).rejects.toThrow(ConflictError);
    expect(mockStripe.paymentLinks.create).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when a requested cycle has no active price", async () => {
    mockDb.select.mockReturnValueOnce(chain([product])).mockReturnValueOnce(chain([monthlyPrice])); // no "year" price among active prices

    await expect(
      createPaymentLinks({ productId: "prod_1", billingIntervals: ["year"] }),
    ).rejects.toThrow(NotFoundError);
  });

  it("refuses a fixed-amount discount across cycles priced in different currencies", async () => {
    mockDb.select
      .mockReturnValueOnce(chain([product]))
      .mockReturnValueOnce(chain([monthlyPrice, quarterlyPrice]));

    await expect(
      createPaymentLinks({
        productId: "prod_1",
        billingIntervals: ["month", "quarter"],
        discount: { type: "amount", value: 500 },
      }),
    ).rejects.toThrow(ConflictError);
    expect(mockStripe.coupons.create).not.toHaveBeenCalled();
  });

  it("creates a shared coupon and promotion code for a percentage discount", async () => {
    mockDb.select.mockReturnValueOnce(chain([product])).mockReturnValueOnce(chain([monthlyPrice]));
    mockStripe.coupons.create.mockResolvedValueOnce({ id: "coupon_1" });
    mockStripe.promotionCodes.create.mockResolvedValueOnce({ code: "SAVE20" });
    mockStripe.paymentLinks.create.mockResolvedValueOnce({
      id: "plink_2",
      url: "https://stripe/plink_2",
    });
    mockDb.insert.mockReturnValueOnce(
      chain([
        {
          id: "row_2",
          productId: "prod_1",
          priceId: "price_month",
          stripePaymentLinkId: "plink_2",
          url: "https://stripe/plink_2",
          token: null,
          stripePromotionCode: "SAVE20",
        },
      ]),
    );

    const result = await createPaymentLinks({
      productId: "prod_1",
      billingIntervals: ["month"],
      discount: { type: "percent", value: 20 },
    });

    expect(mockStripe.coupons.create).toHaveBeenCalledWith({
      percent_off: 20,
      duration: "forever",
    });
    expect(mockStripe.paymentLinks.create).toHaveBeenCalledWith(
      expect.objectContaining({ allow_promotion_codes: true }),
    );
    expect(result[0]!.promotionCode).toBe("SAVE20");
    expect(result[0]).not.toHaveProperty("stripePromotionCode");
  });
});

describe("getOrCreateDefaultPaymentLink", () => {
  it("reuses an existing default signup link", async () => {
    const existing = {
      id: "row_existing",
      priceId: "price_month",
      token: "tok_existing",
      isDefault: true,
      isActive: true,
      stripePromotionCode: null,
    };
    mockDb.select.mockReturnValueOnce(chain([monthlyPrice])).mockReturnValueOnce(chain([existing]));

    const result = await getOrCreateDefaultPaymentLink("price_month");

    expect(result.id).toBe("row_existing");
    expect(result.url).toBe("http://localhost:5274/join/tok_existing");
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("creates a tenant-app signup link, not a Stripe Payment Link", async () => {
    mockDb.select.mockReturnValueOnce(chain([monthlyPrice])).mockReturnValueOnce(chain([]));
    const insertChain = chain([
      {
        id: "row_new",
        priceId: "price_month",
        token: "tok_new",
        url: "http://localhost:5274/join/tok_new",
        isDefault: true,
        stripePromotionCode: null,
      },
    ]);
    mockDb.insert.mockReturnValueOnce(insertChain);

    const result = await getOrCreateDefaultPaymentLink("price_month");

    expect(result.id).toBe("row_new");
    expect(mockStripe.paymentLinks.create).not.toHaveBeenCalled();
    const values = (insertChain.values as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      token: string;
      url: string;
    };
    expect(values.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(values.url).toBe(`http://localhost:5274/join/${values.token}`);
  });

  it("throws NotFoundError when the price doesn't exist", async () => {
    mockDb.select.mockReturnValueOnce(chain([]));
    await expect(getOrCreateDefaultPaymentLink("ghost")).rejects.toThrow(NotFoundError);
  });

  it("throws ConflictError for an archived price", async () => {
    mockDb.select.mockReturnValueOnce(chain([{ ...monthlyPrice, isActive: false }]));
    await expect(getOrCreateDefaultPaymentLink("price_month")).rejects.toThrow(ConflictError);
  });
});

describe("resolveSignupLink", () => {
  const link = {
    id: "link_1",
    productId: "prod_1",
    priceId: "price_month",
    token: "tok_1",
    isActive: true,
    expiresAt: null as Date | null,
    trialDaysOverride: null as number | null,
    discountType: null,
    discountValue: null,
  };
  const activeProduct = {
    ...product,
    name: "Pro",
    description: null,
    features: [],
    limits: { seats: 5 },
    trialDays: 14,
  };

  function mockLookups(l = link, pr: object = monthlyPrice, prod: object = activeProduct) {
    mockDb.select
      .mockReturnValueOnce(chain([l]))
      .mockReturnValueOnce(chain([pr]))
      .mockReturnValueOnce(chain([prod]));
  }

  it("resolves a live link with the plan's trial", async () => {
    mockLookups();
    const result = await resolveSignupLink("tok_1");
    expect(result.price.id).toBe("price_month");
    expect(result.trialDays).toBe(14);
  });

  it("prefers the link's own trial override", async () => {
    mockLookups({ ...link, trialDaysOverride: 30 });
    expect((await resolveSignupLink("tok_1")).trialDays).toBe(30);
  });

  it("404s an unknown token", async () => {
    mockDb.select.mockReturnValueOnce(chain([]));
    await expect(resolveSignupLink("nope")).rejects.toThrow(NotFoundError);
  });

  it("refuses an expired link, a switched-off link and an archived price", async () => {
    mockLookups({ ...link, expiresAt: new Date(Date.now() - 1000) });
    await expect(resolveSignupLink("tok_1")).rejects.toThrow(ConflictError);
    mockLookups({ ...link, isActive: false });
    await expect(resolveSignupLink("tok_1")).rejects.toThrow(ConflictError);
    mockLookups(link, { ...monthlyPrice, isActive: false });
    await expect(resolveSignupLink("tok_1")).rejects.toThrow(ConflictError);
  });

  it("still resolves after checkout even if the link expired meanwhile", async () => {
    mockLookups({ ...link, expiresAt: new Date(Date.now() - 1000) });
    const result = await resolveSignupLink("tok_1", { afterCheckout: true });
    expect(result.link.id).toBe("link_1");
  });
});

describe("getPublicSignupLink", () => {
  it("answers with the plan and terms, and nothing internal", async () => {
    mockDb.select
      .mockReturnValueOnce(
        chain([
          {
            id: "link_1",
            productId: "prod_1",
            priceId: "price_month",
            token: "tok_1",
            isActive: true,
            expiresAt: null,
            trialDaysOverride: null,
            discountType: null,
            discountValue: null,
            createdByUserId: "bo_1",
          },
        ]),
      )
      .mockReturnValueOnce(chain([{ ...monthlyPrice, unitAmount: 4900, trialDaysOverride: null }]))
      .mockReturnValueOnce(
        chain([
          {
            ...product,
            stripeProductId: "stripe_prod_1",
            name: "Pro",
            description: null,
            features: ["Up to 5 seats"],
            limits: { seats: 5 },
            trialDays: 0,
          },
        ]),
      );

    const result = await getPublicSignupLink("tok_1");

    expect(result).toMatchObject({
      token: "tok_1",
      plan: { key: "pro", name: "Pro", limits: { seats: 5 } },
      billingCycle: "monthly",
      unitAmount: 4900,
      currency: "usd",
      trialDays: 0,
    });
    expect(JSON.stringify(result)).not.toMatch(/stripe|createdBy|sp_month/i);
  });
});
