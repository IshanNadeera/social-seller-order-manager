import { ForbiddenException, Injectable } from '@nestjs/common';
import type { BusinessUpdateInput, BusinessView } from '@ssom/shared';
import type { AuthContext } from '../auth/auth-context';
import { PrismaService } from '../common/prisma.service';
import { orNotFound } from '../common/tenant';

const businessSelect = {
  id: true,
  name: true,
  contactPhone: true,
  orderPrefix: true,
  currency: true,
  timezone: true,
  defaultDeliveryFee: true,
  counter: { select: { nextOrderSeq: true } },
} as const;

type BusinessRow = {
  id: string;
  name: string;
  contactPhone: string | null;
  orderPrefix: string;
  currency: string;
  timezone: string;
  defaultDeliveryFee: { toFixed(digits: number): string };
  counter: { nextOrderSeq: number } | null;
};

function toView(row: BusinessRow): BusinessView {
  return {
    id: row.id,
    name: row.name,
    contactPhone: row.contactPhone,
    orderPrefix: row.orderPrefix,
    currency: row.currency,
    timezone: row.timezone,
    defaultDeliveryFee: row.defaultDeliveryFee.toFixed(2),
    nextOrderSequence: row.counter?.nextOrderSeq ?? 1,
  };
}

@Injectable()
export class BusinessesService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /business (§9.1): the caller's own business; the id comes from the membership only. */
  async get(auth: AuthContext): Promise<BusinessView> {
    const row = await this.prisma.business.findUnique({
      where: { id: auth.businessId },
      select: businessSelect,
    });
    return toView(orNotFound(row));
  }

  /**
   * PATCH /business (§6.8, §9.1): only the fields sent change. Owner only. A new order prefix
   * applies to orders created from now on; the counter carries on, so numbers never repeat
   * (NIM-0042, then ABC-0043). A new timezone changes how dates are grouped from now on.
   */
  async update(auth: AuthContext, input: BusinessUpdateInput): Promise<BusinessView> {
    if (auth.role !== 'OWNER') {
      throw new ForbiddenException({
        code: 'OWNER_ONLY',
        message: 'Only the business owner can change these settings.',
        fieldErrors: {},
      });
    }
    const row = await this.prisma.business.update({
      where: { id: auth.businessId },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.contactPhone === undefined ? {} : { contactPhone: input.contactPhone }),
        ...(input.orderPrefix === undefined ? {} : { orderPrefix: input.orderPrefix }),
        ...(input.defaultDeliveryFee === undefined
          ? {}
          : { defaultDeliveryFee: input.defaultDeliveryFee }),
        ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
      },
      select: businessSelect,
    });
    return toView(row);
  }
}
