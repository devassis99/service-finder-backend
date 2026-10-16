import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { billingProducts, billingPrices } from "@service-finder/db/schema";
import { stripe } from "../../shared/stripe";
import { ConflictError } from "../auth";

/**
 * Shared by every billing module (products/prices/payment-links) for a
 * 404 — this is the one they all throw and error-handler.ts checks for,
 * so it lives here (products being the "root" resource of the three)
 * rather than each module defining its own. prices.service.ts and
 * payment-links.service.ts import it from this module's index.ts.
 */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export interface CreateProductInput {
  key: string;
  name: string;
  description?: string;
  features?: string[];
  limits?: Record<string, number>;
  trialDays?: number;
  sortOrder?: number;
}

/**
 * Creates the Stripe Product first, then our row — so a row only ever
 * exists for something that's really in Stripe.
 *
 * The key is checked before Stripe is called: `key` is unique, and
 * finding that out from the insert would leave an orphaned Product in
 * Stripe behind a 500 (two names that slugify alike, "Pro" and "pro",
 * are enough to hit it from the Plans page).
 */
export async function createProduct(input: CreateProductInput) {
  const [existing] = await db.$primary
    .select({ id: billingProducts.id })
    .from(billingProducts)
    .where(eq(billingProducts.key, input.key));
  if (existing) {
    throw new ConflictError(
      `A product with the key "${input.key}" already exists — give this one a different name`,
    );
  }

  const stripeProduct = await stripe.products.create({
    name: input.name,
    description: input.description,
    metadata: { key: input.key },
  });

  const [product] = await db
    .insert(billingProducts)
    .values({
      key: input.key,
      stripeProductId: stripeProduct.id,
      name: input.name,
      description: input.description,
      features: input.features ?? [],
      limits: input.limits ?? {},
      trialDays: input.trialDays ?? 0,
      sortOrder: input.sortOrder ?? 0,
    })
    .returning();

  return product;
}

export async function archiveProduct(productId: string) {
  const [product] = await db
    .select()
    .from(billingProducts)
    .where(eq(billingProducts.id, productId));
  if (!product) throw new NotFoundError("Product not found");

  await stripe.products.update(product.stripeProductId, { active: false });

  const [updated] = await db
    .update(billingProducts)
    .set({ isActive: false })
    .where(eq(billingProducts.id, productId))
    .returning();

  return updated;
}

/**
 * Every list here needs an explicit, total ORDER BY. Without one,
 * Postgres returns rows in physical (heap) order — and an UPDATE writes
 * a new row version, so merely toggling a price's showOnSignup would
 * move that row to the end of the Plans table. Ties are broken down to
 * the primary key so the order is fully deterministic.
 */
const productOrder = [
  asc(billingProducts.sortOrder),
  asc(billingProducts.createdAt),
  asc(billingProducts.id),
];

// Cadence in enum order (month → quarter → half_year → year), then the
// active price ahead of its archived predecessors, newest first.
const priceOrder = [
  asc(billingPrices.billingInterval),
  desc(billingPrices.isActive),
  desc(billingPrices.createdAt),
  asc(billingPrices.id),
];

/**
 * Public catalog: active products with their active, showOnSignup prices
 * nested — what the self-signup pricing page renders from. Visibility is
 * per price (see billing-prices.ts's showOnSignup doc comment): a price
 * can be isActive (still sellable via a payment link) but excluded here,
 * and a product left with no visible prices is dropped entirely.
 */
export async function listCatalog() {
  const products = await db
    .select()
    .from(billingProducts)
    .where(eq(billingProducts.isActive, true))
    .orderBy(...productOrder);

  const prices = await db
    .select()
    .from(billingPrices)
    .where(and(eq(billingPrices.isActive, true), eq(billingPrices.showOnSignup, true)))
    .orderBy(...priceOrder);

  return products
    .map((product) => ({
      ...product,
      prices: prices.filter((price) => price.productId === product.id),
    }))
    .filter((product) => product.prices.length > 0);
}

/**
 * Admin catalog: every product and every price, active or archived —
 * same shape as listCatalog() but without the isActive filters. The
 * public catalog only ever shows what a customer should be able to buy
 * right now; the Plans page needs the full history (its "Archived"
 * status filter) so admins can see what used to be offered too.
 *
 * Read from the primary, not a replica: the Plans page refetches this
 * the moment one of its own writes succeeds, and a lagging replica would
 * answer with the table as it was just before — the new product simply
 * not there yet.
 */
export async function listAdminCatalog() {
  const products = await db.$primary
    .select()
    .from(billingProducts)
    .orderBy(...productOrder);

  const prices = await db.$primary
    .select()
    .from(billingPrices)
    .orderBy(...priceOrder);

  return products.map((product) => ({
    ...product,
    prices: prices.filter((price) => price.productId === product.id),
  }));
}
