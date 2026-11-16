// GET /reports/sales (docs/DEVELOPMENT.md §9.4, §2.2): a report always covers a chosen period, two
// local dates in the business timezone, both included.
import { z } from 'zod';
import { checkDateRange, localDateField } from './dashboard.js';

export const salesReportQuerySchema = z
  .strictObject({ from: localDateField('start'), to: localDateField('end') })
  .superRefine((query, ctx) => checkDateRange(query.from, query.to, ctx));

export type SalesReportQuery = z.output<typeof salesReportQuerySchema>;
