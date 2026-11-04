// The order's stage and payment status as small labels, on the list and the details page.
import type { OrderStage, PaymentStatus } from '@ssom/shared';
import { strings } from '../../lib/strings';

/** The display stage (§7.3), one label from the order and delivery statuses. */
export function StageLabel({ stage }: { stage: OrderStage }) {
  return (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-800">
      {strings.orderStage[stage]}
    </span>
  );
}

/** §6.9: status badges use text and an icon, not colour alone. */
const PAYMENT_BADGE: Record<PaymentStatus, { icon: string; className: string }> = {
  UNPAID: { icon: '○', className: 'bg-amber-50 text-amber-900 ring-amber-200' },
  PARTIALLY_PAID: { icon: '◐', className: 'bg-sky-50 text-sky-900 ring-sky-200' },
  PAID: { icon: '✓', className: 'bg-green-50 text-green-900 ring-green-200' },
  PARTIALLY_REFUNDED: { icon: '↺', className: 'bg-slate-100 text-slate-800 ring-slate-300' },
  REFUNDED: { icon: '↺', className: 'bg-slate-100 text-slate-800 ring-slate-300' },
};

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  const badge = PAYMENT_BADGE[status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${badge.className}`}
    >
      <span aria-hidden="true">{badge.icon}</span>
      {strings.paymentStatus[status]}
    </span>
  );
}
