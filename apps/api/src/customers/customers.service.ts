import { Injectable } from '@nestjs/common';
import { PHONE_UNREADABLE, normalizePhone } from '@ssom/shared';
import type {
  CustomerAddressView,
  CustomerCreateInput,
  CustomerDetail,
  CustomerListQuery,
  CustomerSummary,
  CustomerUpdateInput,
  Page,
} from '@ssom/shared';
import { PrismaService } from '../common/prisma.service';
import { orNotFound, tenantData, tenantWhere } from '../common/tenant';
import type { TenantScope } from '../common/tenant';
import type { Prisma } from '../generated/prisma/client';
import { customerArchivedError } from './customer-lock';
import { CUSTOMER_LIST_ORDER, customerSearchWhere } from './customer-search';

const summarySelect = {
  id: true,
  name: true,
  phoneDisplay: true,
  phoneNormalized: true,
  email: true,
  archivedAt: true,
} satisfies Prisma.CustomerSelect;

const addressSelect = {
  id: true,
  label: true,
  recipientName: true,
  phone: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  district: true,
  postalCode: true,
  isDefault: true,
} satisfies Prisma.CustomerAddressSelect;

type SummaryRow = Prisma.CustomerGetPayload<{ select: typeof summarySelect }>;

interface OrderStats {
  orderCount: number;
  lastOrderAt: Date | null;
}

const NO_ORDERS: OrderStats = { orderCount: 0, lastOrderAt: null };

/**
 * Customers (docs/DEVELOPMENT.md §6.6, §7.11, §9.2). Every method takes the caller's tenant scope
 * first and filters by it (§11.1); another business's customer is simply "not found".
 */
@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(auth: TenantScope, query: CustomerListQuery): Promise<Page<CustomerSummary>> {
    const where = customerSearchWhere(auth, query.q, query.includeArchived);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        select: summarySelect,
        orderBy: CUSTOMER_LIST_ORDER,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    const stats = await this.orderStats(
      auth,
      rows.map((row) => row.id),
    );
    return {
      items: rows.map((row) => toSummary(row, stats.get(row.id) ?? NO_ORDERS)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async get(auth: TenantScope, id: string): Promise<CustomerDetail> {
    const row = orNotFound(
      await this.prisma.customer.findFirst({
        where: tenantWhere(auth, { id }),
        select: {
          ...summarySelect,
          notes: true,
          createdAt: true,
          updatedAt: true,
          addresses: {
            where: { archivedAt: null },
            select: addressSelect,
            orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
          },
        },
      }),
    );
    const stats = (await this.orderStats(auth, [id])).get(id) ?? NO_ORDERS;
    return {
      ...toSummary(row, stats),
      notes: row.notes,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      addresses: row.addresses satisfies CustomerAddressView[],
    };
  }

  /** Creates the customer and, if given, their first address (as the default), in one transaction. */
  async create(auth: TenantScope, input: CustomerCreateInput): Promise<CustomerDetail> {
    const phone = normalizePhone(input.phone);
    const id = await this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.create({
        data: tenantData(auth, {
          name: input.name,
          phoneDisplay: phone?.display ?? null,
          phoneNormalized: phone?.normalized ?? null,
          email: input.email ?? null,
          notes: input.notes ?? null,
        }),
        select: { id: true },
      });
      if (input.address !== undefined) {
        const { address } = input;
        await tx.customerAddress.create({
          data: tenantData(auth, {
            customerId: customer.id,
            label: address.label ?? null,
            recipientName: address.recipientName,
            phone: address.phone,
            addressLine1: address.addressLine1,
            addressLine2: address.addressLine2 ?? null,
            city: address.city ?? null,
            district: address.district ?? null,
            postalCode: address.postalCode ?? null,
            isDefault: true,
          }),
        });
      }
      return customer.id;
    });
    return this.get(auth, id);
  }

  /** Changes only the fields sent; a new phone is normalised again, null clears a field. */
  async update(auth: TenantScope, id: string, input: CustomerUpdateInput): Promise<CustomerDetail> {
    const current = orNotFound(
      await this.prisma.customer.findFirst({
        where: tenantWhere(auth, { id }),
        select: { archivedAt: true },
      }),
    );
    if (current.archivedAt !== null) throw customerArchivedError();

    const data: Prisma.CustomerUpdateManyMutationInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.phone !== undefined) {
      const phone = normalizePhone(input.phone);
      data.phoneDisplay = phone?.display ?? null;
      data.phoneNormalized = phone?.normalized ?? null;
    }
    if (input.email !== undefined) data.email = input.email;
    if (input.notes !== undefined) data.notes = input.notes;

    const result = await this.prisma.customer.updateMany({
      where: tenantWhere(auth, { id, archivedAt: null }),
      data,
    });
    if (result.count === 0) throw customerArchivedError(); // archived between the check and the update
    return this.get(auth, id);
  }

  /** Archives the customer (§8.1: never deleted while referenced). Repeating it changes nothing. */
  async archive(auth: TenantScope, id: string): Promise<CustomerDetail> {
    const result = await this.prisma.customer.updateMany({
      where: tenantWhere(auth, { id, archivedAt: null }),
      data: { archivedAt: new Date() },
    });
    // Nothing archived: either already archived (fine) or not this business's customer (404).
    if (result.count === 0) {
      orNotFound(
        await this.prisma.customer.findFirst({
          where: tenantWhere(auth, { id }),
          select: { id: true },
        }),
      );
    }
    return this.get(auth, id);
  }

  /** Order count and latest order date per customer, for this business only. */
  private async orderStats(auth: TenantScope, ids: string[]): Promise<Map<string, OrderStats>> {
    if (ids.length === 0) return new Map();
    const groups = await this.prisma.order.groupBy({
      by: ['customerId'],
      where: tenantWhere(auth, { customerId: { in: ids } }),
      _count: { _all: true },
      _max: { createdAt: true },
    });
    return new Map(
      groups
        .filter(
          (group): group is typeof group & { customerId: string } => group.customerId !== null,
        )
        .map((group) => [
          group.customerId,
          { orderCount: group._count._all, lastOrderAt: group._max.createdAt },
        ]),
    );
  }
}

function toSummary(row: SummaryRow, stats: OrderStats): CustomerSummary {
  return {
    id: row.id,
    name: row.name,
    phone: row.phoneDisplay,
    phoneE164: row.phoneNormalized,
    phoneWarning:
      row.phoneDisplay !== null && row.phoneNormalized === null ? PHONE_UNREADABLE : null,
    email: row.email,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    orderCount: stats.orderCount,
    lastOrderAt: stats.lastOrderAt?.toISOString() ?? null,
  };
}
