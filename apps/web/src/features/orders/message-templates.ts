// Copyable customer messages (docs/DEVELOPMENT.md §2.1, §6.5, §6.8): read-only defaults filled
// with the order's own details. The app never sends them; the seller copies one into WhatsApp,
// Messenger or SMS. Only the messages that fit the order's current state are offered. The wording
// lives in lib/strings.ts with the rest of the UI text.
import { cents } from '@ssom/shared';
import type { OrderDetail } from '@ssom/shared';
import { formatMoney } from '../../lib/money';
import { strings } from '../../lib/strings';

const m = strings.orders.messages;

export type MessageTemplateId = 'confirmation' | 'paymentReminder' | 'dispatched' | 'readyForPickup';

export type MessageTemplate = { id: MessageTemplateId; title: string; text: string };

export type MessageContext = { businessName: string; currency: string };

/** Lines joined with line breaks; missing lines (null) are left out, blank strings kept as gaps. */
const lines = (...parts: (string | null)[]) =>
  parts.filter((part): part is string => part !== null).join('\n');

/** Who the message greets: the saved customer, else the delivery recipient, else nobody. */
function greetingName(order: OrderDetail): string | null {
  if (order.customer.id !== null) return order.customer.name;
  return order.delivery?.recipientName ?? null;
}

function address(order: OrderDetail): string {
  const delivery = order.delivery;
  if (delivery === null) return '';
  return [delivery.addressLine1, delivery.addressLine2, delivery.city, delivery.district]
    .filter((part): part is string => part !== null && part !== '')
    .join(', ');
}

/** The messages that make sense for this order now, in the order a seller would send them. */
export function messageTemplates(order: OrderDetail, context: MessageContext): MessageTemplate[] {
  const money = (amount: string) => formatMoney(amount, context.currency);
  const hi = m.greeting(greetingName(order));
  const { delivery } = order;
  const closed = order.orderStatus === 'CANCELLED' || order.orderStatus === 'RETURNED';
  const balance = cents(order.balanceDue);
  // COD the customer will still hand to the courier.
  const cod =
    delivery !== null && delivery.codStatus === 'PENDING' && cents(delivery.codAmount) > 0n
      ? delivery.codAmount
      : null;
  const templates: MessageTemplate[] = [];
  if (closed) return templates;

  const paymentLine =
    cod !== null
      ? m.payOnDelivery(money(cod))
      : balance > 0n
        ? m.balanceToPay(money(order.balanceDue))
        : m.paidInFull;
  templates.push({
    id: 'confirmation',
    title: m.titles.confirmation,
    text: lines(
      hi,
      m.thanksForOrder(order.orderNumber, context.businessName),
      '',
      ...order.items.map((item) => m.itemLine(item.quantity, item.name, money(item.lineTotal))),
      '',
      m.total(money(order.totalAmount)),
      paymentLine,
      delivery !== null
        ? m.deliverTo(delivery.recipientName, address(order))
        : m.pickupLater,
    ),
  });

  // COD is collected by the courier (and then owed by them), so it never needs a reminder.
  const codWithCourier =
    delivery !== null && (delivery.codStatus === 'PENDING' || delivery.codStatus === 'COLLECTED');
  if (balance > 0n && !codWithCourier) {
    templates.push({
      id: 'paymentReminder',
      title: m.titles.paymentReminder,
      text: lines(hi, m.reminder(order.orderNumber, money(order.balanceDue)), m.signOff(context.businessName)),
    });
  }

  if (delivery !== null && delivery.status === 'DISPATCHED') {
    templates.push({
      id: 'dispatched',
      title: m.titles.dispatched,
      text: lines(
        hi,
        m.onItsWay(order.orderNumber),
        delivery.courierName !== null ? m.courier(delivery.courierName) : null,
        delivery.trackingNumber !== null ? m.tracking(delivery.trackingNumber) : null,
        cod !== null ? m.keepCodReady(money(cod)) : null,
        m.signOff(context.businessName),
      ),
    });
  }

  if (order.fulfilmentType === 'PICKUP' && order.orderStatus === 'READY') {
    templates.push({
      id: 'readyForPickup',
      title: m.titles.readyForPickup,
      text: lines(
        hi,
        m.readyToCollect(order.orderNumber),
        balance > 0n ? m.balanceAtCollection(money(order.balanceDue)) : null,
        m.signOff(context.businessName),
      ),
    });
  }
  return templates;
}
