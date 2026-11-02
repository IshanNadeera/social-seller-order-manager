import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { MAX_ACTIVE_ADDRESSES } from '@ssom/shared';
import type { AddressCreateInput, AddressUpdateInput, CustomerDetail } from '@ssom/shared';
import { PrismaService } from '../common/prisma.service';
import { orNotFound, tenantData, tenantWhere } from '../common/tenant';
import type { TenantScope } from '../common/tenant';
import type { Prisma } from '../generated/prisma/client';
import { lockActiveCustomer } from './customer-lock';
import { CustomersService } from './customers.service';

type Tx = Prisma.TransactionClient;

/**
 * A customer's saved delivery addresses (docs/DEVELOPMENT.md §7.11, §8.2, §9.2).
 *
 * Rule: a customer with active addresses always has exactly one default. The first address becomes
 * the default, making another one the default moves it, and archiving the default passes it to the
 * oldest remaining address. The partial unique index `address_one_default` is the final guard.
 *
 * Every change runs in one transaction that first locks the customer row, so two changes to the
 * same customer never interleave. Orders keep their own copy of an address (§7.11), so nothing here
 * changes existing orders. Each method returns the customer, so the caller sees the new default.
 */
@Injectable()
export class AddressesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomersService,
  ) {}

  async add(
    auth: TenantScope,
    customerId: string,
    input: AddressCreateInput,
  ): Promise<CustomerDetail> {
    await this.prisma.$transaction(async (tx) => {
      await lockActiveCustomer(tx, auth, customerId);
      const active = await tx.customerAddress.findMany({
        where: tenantWhere(auth, { customerId, archivedAt: null }),
        select: { isDefault: true },
      });
      if (active.length >= MAX_ACTIVE_ADDRESSES) throw limitReachedError();

      const hasDefault = active.some((address) => address.isDefault);
      const makeDefault = input.isDefault === true || !hasDefault;
      if (makeDefault && hasDefault) await clearDefault(tx, auth, customerId);
      await tx.customerAddress.create({
        data: tenantData(auth, {
          customerId,
          label: input.label ?? null,
          recipientName: input.recipientName,
          phone: input.phone,
          addressLine1: input.addressLine1,
          addressLine2: input.addressLine2 ?? null,
          city: input.city ?? null,
          district: input.district ?? null,
          postalCode: input.postalCode ?? null,
          isDefault: makeDefault,
        }),
      });
    });
    return this.customers.get(auth, customerId);
  }

  /** Changes only the fields sent; null clears an optional field. `isDefault: true` moves the default here. */
  async update(
    auth: TenantScope,
    customerId: string,
    addressId: string,
    input: AddressUpdateInput,
  ): Promise<CustomerDetail> {
    await this.prisma.$transaction(async (tx) => {
      await lockActiveCustomer(tx, auth, customerId);
      const address = await findAddress(tx, auth, customerId, addressId);
      if (address.archivedAt !== null) throw addressArchivedError();

      const { isDefault, ...fields } = input;
      const makeDefault = isDefault === true && !address.isDefault;
      const changesFields = Object.values(fields).some((value) => value !== undefined);
      if (!makeDefault && !changesFields) return; // e.g. making the default address the default
      if (makeDefault) await clearDefault(tx, auth, customerId);
      // Fields left out are undefined, which Prisma leaves unchanged.
      await tx.customerAddress.updateMany({
        where: tenantWhere(auth, { id: addressId, customerId }),
        data: makeDefault ? { ...fields, isDefault: true } : fields,
      });
    });
    return this.customers.get(auth, customerId);
  }

  /** Archives the address (never deleted while orders may refer to it, §8.1). Repeating it changes nothing. */
  async archive(auth: TenantScope, customerId: string, addressId: string): Promise<CustomerDetail> {
    await this.prisma.$transaction(async (tx) => {
      await lockActiveCustomer(tx, auth, customerId);
      const address = await findAddress(tx, auth, customerId, addressId);
      if (address.archivedAt !== null) return;

      await tx.customerAddress.updateMany({
        where: tenantWhere(auth, { id: addressId, customerId }),
        data: { archivedAt: new Date(), isDefault: false },
      });
      if (address.isDefault) await promoteOldest(tx, auth, customerId);
    });
    return this.customers.get(auth, customerId);
  }
}

/** The customer's address, or the standard 404 (also for another customer's or business's address). */
async function findAddress(tx: Tx, auth: TenantScope, customerId: string, addressId: string) {
  return orNotFound(
    await tx.customerAddress.findFirst({
      where: tenantWhere(auth, { id: addressId, customerId }),
      select: { archivedAt: true, isDefault: true },
    }),
  );
}

async function clearDefault(tx: Tx, auth: TenantScope, customerId: string): Promise<void> {
  await tx.customerAddress.updateMany({
    where: tenantWhere(auth, { customerId, isDefault: true, archivedAt: null }),
    data: { isDefault: false },
  });
}

/** After the default is archived: the oldest remaining active address becomes the default, if any. */
async function promoteOldest(tx: Tx, auth: TenantScope, customerId: string): Promise<void> {
  const next = await tx.customerAddress.findFirst({
    where: tenantWhere(auth, { customerId, archivedAt: null }),
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  if (next === null) return;
  await tx.customerAddress.updateMany({
    where: tenantWhere(auth, { id: next.id, customerId }),
    data: { isDefault: true },
  });
}

function addressArchivedError(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'ADDRESS_ARCHIVED',
    message: 'This address is archived, so it can no longer be changed. Add a new address instead.',
  });
}

function limitReachedError(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'ADDRESS_LIMIT_REACHED',
    message: `A customer can have at most ${MAX_ACTIVE_ADDRESSES} saved addresses. Archive one you no longer use first.`,
  });
}
