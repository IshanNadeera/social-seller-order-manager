// POST /orders request (docs/DEVELOPMENT.md §6.4, §7.5–§7.10, §9.6). Strict: unknown fields, client
// totals (subtotal, totalAmount, lineTotal…) and businessId are refused. The server calculates money.
import { z } from 'zod';
import { FULFILMENT_TYPES, PAYMENT_METHODS, SOURCE_CHANNELS } from '../enums.js';
import { SOURCE_NOTE_MAX_LENGTH } from '../constants.js';
import { optionalText, requiredText } from './common.js';
import { addressInputSchema } from './customers.js';
import { moneySchema } from './money.js';

export const ORDER_MAX_ITEMS = 100;
export const ORDER_NOTES_MAX_LENGTH = 2000;
export const ITEM_NAME_MAX_LENGTH = 200;
/** Snapshot name of an anonymous walk-in sale (§7.10). */
export const WALK_IN_CUSTOMER_NAME = 'Walk-in customer';

const uuid = (message: string) => z.uuid({ error: message });

const orderItemSchema = z.strictObject(
  {
    /** A catalogue product; its name, SKU and price come from the database. */
    productId: uuid('Choose a product from the list.').optional(),
    /** For a custom item (no product). */
    name: requiredText(ITEM_NAME_MAX_LENGTH, 'Enter the item name.').optional(),
    quantity: z
      .number({ error: 'Enter a quantity.' })
      .int('Enter a whole number.')
      .min(1, 'Enter a whole number from 1 to 9,999.')
      .max(9999, 'Enter a whole number from 1 to 9,999.'),
    /** Optional for a product (defaults to its selling price); required for a custom item. */
    unitPrice: moneySchema('Enter the price.').optional(),
  },
  { error: 'Each item needs a product (or a name and price) and a quantity.' },
);

/** The order's own copy of the delivery address (§7.11), plus COD and "save to customer". */
const deliverySchema = addressInputSchema.omit({ label: true }).extend({
  /** The saved address it was copied from (informational, §8.2). */
  sourceAddressId: uuid('Choose an address from the list.').nullable().optional(),
  /** Also save this address to the customer (§6.4). */
  saveToCustomer: z.boolean({ error: 'Use true or false.' }).optional(),
  /** COD amount; defaults to the balance due after any advance payment (§7.8). */
  codAmount: moneySchema('Enter the COD amount.').optional(),
});

export const orderCreateSchema = z
  .strictObject({
    sourceChannel: z.enum(SOURCE_CHANNELS, { error: 'Choose where the order came from.' }),
    sourceNote: optionalText(SOURCE_NOTE_MAX_LENGTH),
    fulfilmentType: z
      .enum(FULFILMENT_TYPES, { error: 'Choose delivery or pickup.' })
      .default('DELIVERY'),
    /** Required except for an anonymous walk-in sale (§7.10). */
    customerId: uuid('Choose a customer.').nullable().optional(),
    items: z
      .array(orderItemSchema, { error: 'Add at least one item.' })
      .min(1, 'Add at least one item.')
      .max(ORDER_MAX_ITEMS, `An order can have at most ${ORDER_MAX_ITEMS} items.`),
    discountAmount: moneySchema('Enter the discount.').default('0.00'),
    /** Defaults to the business's delivery fee for delivery orders, 0 for pickup. */
    deliveryFee: moneySchema('Enter the delivery fee.').optional(),
    paymentMethod: z.enum(PAYMENT_METHODS, { error: 'Choose how the customer will pay.' }),
    initialPayment: z
      .strictObject(
        {
          amount: moneySchema('Enter the amount paid now.'),
          /** Defaults to the order's payment method. Required when that is COD. */
          method: z.enum(PAYMENT_METHODS, { error: 'Choose how it was paid.' }).optional(),
        },
        { error: 'Enter the advance payment.' },
      )
      .optional(),
    delivery: deliverySchema.optional(),
    notes: optionalText(ORDER_NOTES_MAX_LENGTH),
  })
  .superRefine((order, ctx) => {
    const issue = (path: PropertyKey[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });

    // §7.9: a note is required for OTHER.
    if (order.sourceChannel === 'OTHER' && (order.sourceNote ?? null) === null) {
      issue(['sourceNote'], 'Say where this order came from.');
    }
    // §7.10: no customer only for an anonymous walk-in sale, which is always a pickup.
    if ((order.customerId ?? null) === null) {
      if (order.sourceChannel !== 'WALK_IN') issue(['customerId'], 'Choose a customer.');
      else if (order.fulfilmentType !== 'PICKUP') {
        issue(['fulfilmentType'], 'An order without a customer must be a pickup.');
      }
    }
    // A delivery order needs the address; a pickup order has none and no delivery fee.
    if (order.fulfilmentType === 'DELIVERY' && order.delivery === undefined) {
      issue(['delivery'], 'Enter the delivery address.');
    }
    if (order.fulfilmentType === 'PICKUP') {
      if (order.delivery !== undefined)
        issue(['delivery'], 'A pickup order has no delivery address.');
      if (order.deliveryFee !== undefined && order.deliveryFee !== '0.00') {
        issue(['deliveryFee'], 'A pickup order has no delivery fee.');
      }
    }
    // §7.8: COD only for delivery orders.
    if (order.paymentMethod === 'COD' && order.fulfilmentType !== 'DELIVERY') {
      issue(['paymentMethod'], 'Cash on delivery is only for delivery orders.');
    }
    if (order.paymentMethod !== 'COD' && order.delivery?.codAmount !== undefined) {
      if (order.delivery.codAmount !== '0.00') {
        issue(['delivery', 'codAmount'], 'Choose cash on delivery to collect a COD amount.');
      }
    }
    // An advance on a COD order is paid some other way; COD money only arrives at settlement (§7.8).
    if (order.initialPayment !== undefined) {
      const method = order.initialPayment.method ?? order.paymentMethod;
      if (method === 'COD' && order.initialPayment.amount !== '0.00') {
        issue(['initialPayment', 'method'], 'Choose how the advance was paid, for example cash.');
      }
    }
    if (order.delivery?.saveToCustomer === true && (order.customerId ?? null) === null) {
      issue(['delivery', 'saveToCustomer'], 'Choose a customer to save the address to.');
    }
    // Each item is a product, or a custom item with a name and a price.
    order.items.forEach((item, index) => {
      if (item.productId === undefined) {
        if (item.name === undefined) issue(['items', index, 'name'], 'Enter the item name.');
        if (item.unitPrice === undefined) issue(['items', index, 'unitPrice'], 'Enter the price.');
      } else if (item.name !== undefined) {
        issue(['items', index, 'name'], 'A catalogue product uses its own name.');
      }
    });
  });

export type OrderCreateRequest = z.input<typeof orderCreateSchema>;
export type OrderCreateInput = z.output<typeof orderCreateSchema>;
