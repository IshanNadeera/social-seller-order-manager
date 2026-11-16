// GET /dashboard/summary (docs/DEVELOPMENT.md §6.2, §15): the period is two local dates in the
// business timezone, both included; leave both out for today.
import { z } from 'zod';
import { inclusiveDays, isIsoDate } from '../dates.js';
import { MAX_DATE_RANGE_DAYS } from './orders.js';

const localDate = (label: string) =>
  z
    .string({ error: `Enter the ${label} date as YYYY-MM-DD.` })
    .refine(isIsoDate, `Enter the ${label} date as YYYY-MM-DD, for example 2026-10-01.`)
    .optional();

export const dashboardSummaryQuerySchema = z
  .strictObject({ from: localDate('start'), to: localDate('end') })
  .superRefine((query, ctx) => {
    if ((query.from === undefined) !== (query.to === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: [query.from === undefined ? 'from' : 'to'],
        message: 'Choose both a start and an end date, or neither for today.',
      });
      return;
    }
    if (query.from === undefined || query.to === undefined) return;
    const days = inclusiveDays(query.from, query.to);
    if (days < 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'The end date must be on or after the start date.',
      });
    } else if (days > MAX_DATE_RANGE_DAYS) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: `Choose a range of at most ${MAX_DATE_RANGE_DAYS} days.`,
      });
    }
  });

export type DashboardSummaryQuery = z.output<typeof dashboardSummaryQuerySchema>;
