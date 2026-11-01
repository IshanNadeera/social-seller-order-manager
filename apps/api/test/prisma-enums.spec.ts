// The database enums (generated from prisma/schema.prisma) and the shared enums used by the web app
// and API code must be identical (packages/shared/src/enums.ts, docs/DEVELOPMENT.md §7.1).
// If this fails after a schema change, run: npm run prisma:generate -w apps/api
import {
  COD_STATUSES,
  DELIVERY_STATUSES,
  FULFILMENT_TYPES,
  MEMBER_ROLES,
  ORDER_EVENT_TYPES,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PAYMENT_TYPES,
  SOURCE_CHANNELS,
} from '@ssom/shared';
import type * as Shared from '@ssom/shared';
import { describe, expect, it } from 'vitest';
import {
  CodStatus,
  DeliveryStatus,
  FulfilmentType,
  MemberRole,
  OrderEventType,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  PaymentType,
  SourceChannel,
} from '../src/generated/prisma/enums';

// Compile-time check: each Prisma enum type equals the shared union type (typecheck fails otherwise).
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type PrismaValue<T> = T[keyof T];
const _sameTypes: [
  Same<PrismaValue<typeof OrderStatus>, Shared.OrderStatus>,
  Same<PrismaValue<typeof PaymentStatus>, Shared.PaymentStatus>,
  Same<PrismaValue<typeof DeliveryStatus>, Shared.DeliveryStatus>,
  Same<PrismaValue<typeof CodStatus>, Shared.CodStatus>,
  Same<PrismaValue<typeof SourceChannel>, Shared.SourceChannel>,
  Same<PrismaValue<typeof FulfilmentType>, Shared.FulfilmentType>,
  Same<PrismaValue<typeof PaymentMethod>, Shared.PaymentMethod>,
  Same<PrismaValue<typeof PaymentType>, Shared.PaymentType>,
  Same<PrismaValue<typeof MemberRole>, Shared.MemberRole>,
  Same<PrismaValue<typeof OrderEventType>, Shared.OrderEventType>,
] = [true, true, true, true, true, true, true, true, true, true];

describe('Prisma enums match @ssom/shared', () => {
  it.each([
    ['OrderStatus', OrderStatus, ORDER_STATUSES],
    ['PaymentStatus', PaymentStatus, PAYMENT_STATUSES],
    ['DeliveryStatus', DeliveryStatus, DELIVERY_STATUSES],
    ['CodStatus', CodStatus, COD_STATUSES],
    ['SourceChannel', SourceChannel, SOURCE_CHANNELS],
    ['FulfilmentType', FulfilmentType, FULFILMENT_TYPES],
    ['PaymentMethod', PaymentMethod, PAYMENT_METHODS],
    ['PaymentType', PaymentType, PAYMENT_TYPES],
    ['MemberRole', MemberRole, MEMBER_ROLES],
    ['OrderEventType', OrderEventType, ORDER_EVENT_TYPES],
  ] as const)('%s has the same values in the same order', (_name, prismaEnum, sharedValues) => {
    expect(Object.values(prismaEnum)).toEqual([...sharedValues]);
  });
});
