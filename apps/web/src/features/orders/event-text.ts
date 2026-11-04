// One plain sentence for each entry of an order's activity history (docs/DEVELOPMENT.md §6.5, §8.2).
// Event values are stored JSON, so they are read defensively: an unexpected shape still gives a
// sensible sentence, never a crash or raw codes.
import { isCodStatus, isDeliveryStatus, isOrderStatus } from '@ssom/shared';
import type { OrderEventView } from '@ssom/shared';
import { formatMoney } from '../../lib/money';
import { strings } from '../../lib/strings';

const t = strings.orders.timeline;

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

export function describeEvent(event: OrderEventView, currency: string): string {
  const after = event.newValue;
  const before = event.oldValue;
  const amount = (value: unknown) => {
    const found = text(value);
    return found === null ? null : formatMoney(found, currency);
  };

  switch (event.type) {
    case 'ORDER_CREATED': {
      const total = amount(field(after, 'totalAmount'));
      return total === null ? t.created : t.createdWithTotal(total);
    }
    case 'ORDER_UPDATED': {
      const total = amount(field(after, 'totalAmount'));
      return total === null ? t.updated : t.updatedWithTotal(total);
    }
    case 'ORDER_STATUS_CHANGED': {
      const from = text(field(before, 'orderStatus'));
      const to = text(field(after, 'orderStatus'));
      if (to === null || !isOrderStatus(to)) return t.updated;
      const toLabel = strings.orderStatus[to];
      return from !== null && isOrderStatus(from)
        ? t.status(strings.orderStatus[from], toLabel)
        : t.statusTo(toLabel);
    }
    case 'DELIVERY_STATUS_CHANGED': {
      const to = text(field(after, 'deliveryStatus')) ?? text(field(after, 'status'));
      return to !== null && isDeliveryStatus(to)
        ? t.delivery(strings.deliveryStatus[to])
        : t.deliveryChanged;
    }
    case 'PAYMENT_RECORDED': {
      const paid = amount(field(after, 'amount'));
      return paid === null ? t.paymentRecorded : t.payment(paid);
    }
    case 'REFUND_RECORDED': {
      const refunded = amount(field(after, 'amount'));
      return refunded === null ? t.refundRecorded : t.refund(refunded);
    }
    case 'COD_STATUS_CHANGED': {
      const to = text(field(after, 'codStatus'));
      return to !== null && isCodStatus(to) ? t.cod(strings.codStatus[to]) : t.codChanged;
    }
    case 'NOTE_ADDED':
      return t.note;
  }
}
