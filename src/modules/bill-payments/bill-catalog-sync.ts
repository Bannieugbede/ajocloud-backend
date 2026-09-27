import type { PrismaClient } from '../../../generated/prisma/client.js';
import type { BillPaymentProvider } from './providers/bill-payment-provider.js';

type CatalogClient = Pick<PrismaClient, 'billCategory' | 'billBiller' | 'billProduct'>;

/** Stored on each category so a changed catalogue is noticed before expiry. */
export interface StoredCategoryData {
  readonly position: number;
  readonly revision: string | null;
}

/**
 * Copies a provider's catalogue into the database.
 *
 * Everything the provider lists is upserted and marked active; everything it no
 * longer lists is marked inactive rather than deleted, because past payments
 * still point at those rows and their receipts must keep naming who was paid.
 *
 * Shared by the service, which refreshes when the stored copy expires or its
 * revision changes, and the seed, so both write the same rows.
 */
export async function syncBillCatalog(
  prisma: CatalogClient,
  provider: Pick<
    BillPaymentProvider,
    'name' | 'catalogRevision' | 'listCategories' | 'listBillers'
  >,
  expiresAt: Date,
  refreshedAt: Date = new Date(),
): Promise<void> {
  const categories = await provider.listCategories();
  const revision = provider.catalogRevision ?? null;

  for (const [position, category] of categories.entries()) {
    const catalogData: StoredCategoryData = { position, revision };
    const stored = await prisma.billCategory.upsert({
      where: {
        provider_providerCode: { provider: provider.name, providerCode: category.code },
      },
      create: {
        provider: provider.name,
        providerCode: category.code,
        name: category.name,
        catalogData: { ...catalogData },
        refreshedAt,
        expiresAt,
      },
      update: {
        name: category.name,
        status: 'ACTIVE',
        catalogData: { ...catalogData },
        refreshedAt,
        expiresAt,
      },
    });

    const billers = await provider.listBillers(category.code);
    for (const biller of billers) {
      const billerData = {
        referenceKind: biller.referenceKind,
        referenceLabel: biller.referenceLabel ?? null,
      };
      const storedBiller = await prisma.billBiller.upsert({
        where: { categoryId_providerCode: { categoryId: stored.id, providerCode: biller.code } },
        create: {
          categoryId: stored.id,
          providerCode: biller.code,
          name: biller.name,
          catalogData: billerData,
          refreshedAt,
          expiresAt,
        },
        update: {
          name: biller.name,
          status: 'ACTIVE',
          catalogData: billerData,
          refreshedAt,
          expiresAt,
        },
      });

      for (const product of biller.products) {
        // Limits are written explicitly, nulls included: a package that moves
        // from a fixed price to a range must lose the old fixed price.
        const terms = {
          name: product.name,
          currency: product.currency,
          minimumMinor: product.minimumMinor ?? null,
          maximumMinor: product.maximumMinor ?? null,
          fixedAmountMinor: product.fixedAmountMinor ?? null,
          catalogData: { validity: product.validity ?? null },
        };
        await prisma.billProduct.upsert({
          where: {
            billerId_providerCode: { billerId: storedBiller.id, providerCode: product.code },
          },
          create: { billerId: storedBiller.id, providerCode: product.code, ...terms },
          update: { status: 'ACTIVE', ...terms },
        });
      }
      await prisma.billProduct.updateMany({
        where: {
          billerId: storedBiller.id,
          providerCode: { notIn: biller.products.map((product) => product.code) },
        },
        data: { status: 'INACTIVE' },
      });
    }
    await prisma.billBiller.updateMany({
      where: {
        categoryId: stored.id,
        providerCode: { notIn: billers.map((biller) => biller.code) },
      },
      data: { status: 'INACTIVE' },
    });
  }

  await prisma.billCategory.updateMany({
    where: {
      provider: provider.name,
      providerCode: { notIn: categories.map((category) => category.code) },
    },
    data: { status: 'INACTIVE' },
  });
}
