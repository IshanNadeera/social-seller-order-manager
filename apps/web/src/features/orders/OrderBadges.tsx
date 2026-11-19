// The order's stage and payment status as small labels, on the list and the details page.
// §6.9: each has text and an icon, never colour alone (components/Badge.tsx).
import type { OrderStage, PaymentStatus } from '@ssom/shared';
import { Badge } from '../../components/Badge';
import type { BadgeTone } from '../../components/Badge';
import { strings } from '../../lib/strings';

const STAGE_BADGE: Record<OrderStage, { icon: string; tone: BadgeTone }> = {
  NEW: { icon: '✦', tone: 'info' },
  AWAITING_CONFIRMATION: { icon: '…', tone: 'warning' },
  CONFIRMED: { icon: '✓', tone: 'info' },
  PREPARING: { icon: '⚙', tone: 'info' },
  READY_TO_SEND: { icon: '▣', tone: 'info' },
  READY_FOR_PICKUP: { icon: '▣', tone: 'info' },
  OUT_FOR_DELIVERY: { icon: '→', tone: 'info' },
  DELIVERY_FAILED: { icon: '!', tone: 'warning' },
  COMPLETED: { icon: '✔', tone: 'good' },
  CANCELLED: { icon: '✕', tone: 'bad' },
  RETURNED: { icon: '↩', tone: 'neutral' },
};

/** The display stage (§7.3), one label from the order and delivery statuses. */
export function StageLabel({ stage }: { stage: OrderStage }) {
  const badge = STAGE_BADGE[stage];
  return (
    <Badge icon={badge.icon} tone={badge.tone}>
      {strings.orderStage[stage]}
    </Badge>
  );
}

const PAYMENT_BADGE: Record<PaymentStatus, { icon: string; tone: BadgeTone }> = {
  UNPAID: { icon: '○', tone: 'warning' },
  PARTIALLY_PAID: { icon: '◐', tone: 'info' },
  PAID: { icon: '✓', tone: 'good' },
  PARTIALLY_REFUNDED: { icon: '↺', tone: 'neutral' },
  REFUNDED: { icon: '↺', tone: 'neutral' },
};

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  const badge = PAYMENT_BADGE[status];
  return (
    <Badge icon={badge.icon} tone={badge.tone}>
      {strings.paymentStatus[status]}
    </Badge>
  );
}
