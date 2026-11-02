import { ConflictException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import type {
  Page,
  ProductCreateInput,
  ProductListQuery,
  ProductUpdateInput,
  ProductView,
} from '@ssom/shared';
import { PrismaService } from '../common/prisma.service';
import { orNotFound, tenantData, tenantWhere } from '../common/tenant';
import type { TenantScope } from '../common/tenant';
import { Prisma } from '../generated/prisma/client';
import { PRODUCT_LIST_ORDER, productSearchWhere } from './product-search';

const productSelect = {
  id: true,
  name: true,
  sku: true,
  description: true,
  sellingPrice: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductSelect;

type ProductRow = Prisma.ProductGetPayload<{ select: typeof productSelect }>;

/**
 * Products (docs/DEVELOPMENT.md §6.7, §8.2, §9.3). Every method takes the caller's tenant scope first
 * and filters by it (§11.1). Orders keep their own name, SKU and price copies (§1.3 principle 4), so
 * nothing here changes existing orders.
 *
 * SKU rule: unique among the business's ACTIVE products. The partial unique index
 * `products_sku_unique` enforces it, including under concurrent requests; a violation becomes
 * 409 SKU_TAKEN with a field error. Archiving a product frees its SKU.
 */
@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(auth: TenantScope, query: ProductListQuery): Promise<Page<ProductView>> {
    const where = productSearchWhere(auth, query.q, query.includeArchived);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        select: productSelect,
        orderBy: PRODUCT_LIST_ORDER,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { items: rows.map(toView), page: query.page, pageSize: query.pageSize, total };
  }

  async get(auth: TenantScope, id: string): Promise<ProductView> {
    return toView(
      orNotFound(
        await this.prisma.product.findFirst({
          where: tenantWhere(auth, { id }),
          select: productSelect,
        }),
      ),
    );
  }

  async create(auth: TenantScope, input: ProductCreateInput): Promise<ProductView> {
    const row = await skuTakenAs409(() =>
      this.prisma.product.create({
        data: tenantData(auth, {
          name: input.name,
          sku: input.sku ?? null,
          description: input.description ?? null,
          sellingPrice: input.sellingPrice,
        }),
        select: productSelect,
      }),
    );
    return toView(row);
  }

  /** Changes only the fields sent; null clears the SKU or description. */
  async update(auth: TenantScope, id: string, input: ProductUpdateInput): Promise<ProductView> {
    const current = orNotFound(
      await this.prisma.product.findFirst({
        where: tenantWhere(auth, { id }),
        select: { archivedAt: true },
      }),
    );
    if (current.archivedAt !== null) throw archivedError();

    // Fields left out are undefined, which Prisma leaves unchanged.
    const result = await skuTakenAs409(() =>
      this.prisma.product.updateMany({
        where: tenantWhere(auth, { id, archivedAt: null }),
        data: input,
      }),
    );
    if (result.count === 0) throw archivedError(); // archived between the check and the update
    return this.get(auth, id);
  }

  /** Archives the product (never deleted while orders may refer to it, §8.1). Repeating it changes nothing. */
  async archive(auth: TenantScope, id: string): Promise<ProductView> {
    await this.prisma.product.updateMany({
      where: tenantWhere(auth, { id, archivedAt: null }),
      data: { archivedAt: new Date() },
    });
    // If nothing was archived, the product was already archived (fine) or is not this business's,
    // which get() answers with the standard 404.
    return this.get(auth, id);
  }
}

function toView(row: ProductRow): ProductView {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    description: row.description,
    sellingPrice: row.sellingPrice.toFixed(2),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Runs the write; a clash on `products_sku_unique` becomes 409 SKU_TAKEN on the `sku` field. */
async function skuTakenAs409<Result>(write: () => Promise<Result>): Promise<Result> {
  try {
    return await write();
  } catch (error) {
    if (isSkuTaken(error)) {
      throw new ConflictException({
        code: 'SKU_TAKEN',
        message: 'Another active product already uses this SKU.',
        fieldErrors: { sku: 'Another active product already uses this SKU.' },
      });
    }
    throw error;
  }
}

/**
 * True for a violation of the partial unique index products_sku_unique. With the pg driver adapter,
 * Prisma reports P2002 and puts the index name in meta.driverAdapterError.cause.constraint.
 */
function isSkuTaken(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  return `${error.message} ${JSON.stringify(error.meta ?? {})}`.includes('products_sku_unique');
}

function archivedError(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'PRODUCT_ARCHIVED',
    message: 'This product is archived, so it can no longer be changed.',
  });
}
