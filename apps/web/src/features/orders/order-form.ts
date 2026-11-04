// The order form's values and what becomes of them (docs/DEVELOPMENT.md §6.4, §7.5, §9.6).
// The form holds what the seller typed (all text); toOrderRequest() turns it into the POST /orders
// body, which the shared orderCreateSchema checks, the same schema the API uses. previewOrder() is
// the live total: exact cents (BigInt), but only a preview; the server calculates the real totals.
import { cents, orderCreateSchema } from '@ssom/shared';
import type { FulfilmentType, OrderCreateInput, PaymentMethod, SourceChannel } from '@ssom/shared';
import { z } from 'zod';

export type OrderItemValues = {
  /** A catalogue product, or '' for a one-off item. */
  productId: string;
  /** The one-off item's name; for a product, its name (shown only, not sent). */
  name: string;
  quantity: string;
  unitPrice: string;
};

export type OrderDeliveryValues = {
  recipientName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  district: string;
  postalCode: string;
  /** The customer's saved address it was filled from; '' once the seller edits it. */
  sourceAddressId: string;
  saveToCustomer: boolean;
};

export type OrderFormValues = {
  sourceChannel: SourceChannel | '';
  sourceNote: string;
  /** '' for a walk-in sale without a customer. */
  customerId: string;
  fulfilmentType: FulfilmentType;
  delivery: OrderDeliveryValues;
  items: OrderItemValues[];
  discountAmount: string;
  deliveryFee: string;
  paymentMethod: PaymentMethod | '';
  initialPayment: { amount: string; method: PaymentMethod | '' };
  notes: string;
};

export const DELIVERY_FIELDS = [
  'recipientName',
  'phone',
  'addressLine1',
  'addressLine2',
  'city',
  'district',
  'postalCode',
] as const;

export const emptyItem = (): OrderItemValues => ({
  productId: '',
  name: '',
  quantity: '1',
  unitPrice: '',
});

/** A new order: delivery (the default, §6.4) with the business's delivery fee, one empty line. */
export function emptyOrderForm(defaultDeliveryFee: string): OrderFormValues {
  return {
    sourceChannel: '',
    sourceNote: '',
    customerId: '',
    fulfilmentType: 'DELIVERY',
    delivery: {
      recipientName: '',
      phone: '',
      addressLine1: '',
      addressLine2: '',
      city: '',
      district: '',
      postalCode: '',
      sourceAddressId: '',
      saveToCustomer: false,
    },
    items: [emptyItem()],
    discountAmount: '',
    deliveryFee: defaultDeliveryFee,
    paymentMethod: '',
    initialPayment: { amount: '', method: '' },
    notes: '',
  };
}

const blankToUndefined = (value: string) => (value.trim() === '' ? undefined : value);

/** "2" → 2. Anything else is passed on as NaN, so the schema gives its plain message. */
function quantityOf(value: string): number | undefined {
  const text = value.trim();
  if (text === '') return undefined;
  return /^\d+(\.\d+)?$/.test(text) ? Number(text) : Number.NaN;
}

/**
 * The POST /orders body for these values, before validation. Blank optional fields are left out,
 * and so is everything that doesn't apply: the address and fee of a pickup order, a product line's
 * name (the server takes it from the product).
 */
export function toOrderRequest(values: OrderFormValues): Record<string, unknown> {
  const isDelivery = values.fulfilmentType === 'DELIVERY';
  const { delivery } = values;
  const amount = values.initialPayment.amount;
  return {
    sourceChannel: blankToUndefined(values.sourceChannel),
    sourceNote: values.sourceNote,
    customerId: values.customerId === '' ? null : values.customerId,
    fulfilmentType: values.fulfilmentType,
    items: values.items.map((item) =>
      item.productId === ''
        ? {
            name: blankToUndefined(item.name),
            quantity: quantityOf(item.quantity),
            unitPrice: blankToUndefined(item.unitPrice),
          }
        : {
            productId: item.productId,
            quantity: quantityOf(item.quantity),
            unitPrice: blankToUndefined(item.unitPrice),
          },
    ),
    discountAmount: blankToUndefined(values.discountAmount),
    deliveryFee: isDelivery ? blankToUndefined(values.deliveryFee) : undefined,
    paymentMethod: blankToUndefined(values.paymentMethod),
    initialPayment:
      amount.trim() === ''
        ? undefined
        : { amount, method: blankToUndefined(values.initialPayment.method) },
    delivery: isDelivery
      ? {
          recipientName: delivery.recipientName,
          phone: delivery.phone,
          addressLine1: delivery.addressLine1,
          addressLine2: delivery.addressLine2,
          city: delivery.city,
          district: delivery.district,
          postalCode: delivery.postalCode,
          sourceAddressId: blankToUndefined(delivery.sourceAddressId),
          // Only a typed address can be saved, and only to a chosen customer (§6.4).
          saveToCustomer:
            delivery.saveToCustomer && delivery.sourceAddressId === '' && values.customerId !== ''
              ? true
              : undefined,
        }
      : undefined,
    notes: values.notes,
  };
}

/**
 * The form's validation: the form values, turned into the request, against the API's own schema.
 * Error paths (items.0.quantity, delivery.addressLine1…) match the form's field names.
 */
export const orderFormSchema = z.preprocess(
  (values) => toOrderRequest(values as OrderFormValues),
  orderCreateSchema,
) as unknown as z.ZodType<OrderCreateInput, OrderFormValues>;

/** The API's field paths ("items[0].quantity") as form field names ("items.0.quantity"). */
export function formFieldName(apiField: string): string {
  return apiField.replace(/\[(\d+)\]/g, '.$1');
}

/** cents(), or null for anything that isn't an amount. Blank counts as `blank`. */
function centsOr(value: string, blank: bigint | null): bigint | null {
  if (value.trim() === '') return blank;
  try {
    return cents(value);
  } catch {
    return null;
  }
}

/** Cents back to "1234.50" (and "-12.00"). */
export function fromCents(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const size = value < 0n ? -value : value;
  return `${sign}${size / 100n}.${String(size % 100n).padStart(2, '0')}`;
}

export interface OrderPreview {
  /** Each line's total, or null while its quantity or price isn't a valid number. */
  lineTotals: (string | null)[];
  subtotal: string | null;
  discount: string | null;
  deliveryFee: string | null;
  total: string | null;
  received: string | null;
  balance: string | null;
}

/** The live totals (§7.5) for what's on the form now. Not authoritative: the server recalculates. */
export function previewOrder(values: OrderFormValues): OrderPreview {
  const lineCents = values.items.map((item) => {
    const quantity = item.quantity.trim();
    const price = centsOr(item.unitPrice, null);
    if (!/^\d+$/.test(quantity) || price === null) return null;
    return BigInt(quantity) * price;
  });
  const subtotal = lineCents.every((line) => line !== null)
    ? lineCents.reduce<bigint>((sum, line) => sum + (line ?? 0n), 0n)
    : null;
  const discount = centsOr(values.discountAmount, 0n);
  const deliveryFee = values.fulfilmentType === 'DELIVERY' ? centsOr(values.deliveryFee, 0n) : 0n;
  const received = centsOr(values.initialPayment.amount, 0n);
  const total =
    subtotal === null || discount === null || deliveryFee === null
      ? null
      : subtotal - discount + deliveryFee;
  const balance = total === null || received === null ? null : total - received;
  const show = (value: bigint | null) => (value === null ? null : fromCents(value));
  return {
    lineTotals: lineCents.map(show),
    subtotal: show(subtotal),
    discount: show(discount),
    deliveryFee: show(deliveryFee),
    total: show(total),
    received: show(received),
    balance: balance === null ? null : fromCents(balance < 0n ? 0n : balance),
  };
}
