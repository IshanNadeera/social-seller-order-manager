// GET /exports/orders.csv (docs/DEVELOPMENT.md §9.4, §11.4): the orders list's search and filters,
// without paging. A file holds at most MAX_EXPORT_ROWS orders; a bigger result asks the seller to
// narrow the filters instead of being cut short.
import { z } from 'zod';
import { DELIVERY_STATUSES, ORDER_STATUSES, PAYMENT_STATUSES, SOURCE_CHANNELS } from '../enums.js';
import { searchListQueryFields } from './common.js';
import { checkDateRange, localDateField } from './dashboard.js';

/** Orders one CSV file may hold. */
export const MAX_EXPORT_ROWS = 10_000;
/** Exports a business may make in any hour (§11.4: rate limits on exports). */
export const EXPORTS_PER_HOUR = 10;

export const orderExportQuerySchema = z
  .strictObject({
    q: searchListQueryFields.q,
    orderStatus: z
      .enum(ORDER_STATUSES, { error: 'Choose an order status from the list.' })
      .optional(),
    paymentStatus: z
      .enum(PAYMENT_STATUSES, { error: 'Choose a payment status from the list.' })
      .optional(),
    deliveryStatus: z
      .enum(DELIVERY_STATUSES, { error: 'Choose a delivery status from the list.' })
      .optional(),
    sourceChannel: z.enum(SOURCE_CHANNELS, { error: 'Choose a source from the list.' }).optional(),
    from: localDateField('start').optional(),
    to: localDateField('end').optional(),
  })
  .superRefine((query, ctx) => {
    if (query.from !== undefined && query.to !== undefined)
      checkDateRange(query.from, query.to, ctx);
  });

export type OrderExportQuery = z.output<typeof orderExportQuerySchema>;
