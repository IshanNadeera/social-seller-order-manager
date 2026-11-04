import type { OrderDetail } from '@ssom/shared';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { ApiErrorMessage } from '../../components/ApiErrorMessage';
import { FormAlert, buttonClass, linkClass } from '../../components/form';
import { Pagination } from '../../components/Pagination';
import { isApiError } from '../../lib/api-client';
import { formatDateTime } from '../../lib/format';
import { formatMoney } from '../../lib/money';
import { strings } from '../../lib/strings';
import { useBusinessCurrency, useBusinessTimeZone } from '../account/use-business';
import { customerPaths } from '../customers/paths';
import { useOrder, useOrderEvents } from './api';
import { describeEvent } from './event-text';
import { OrderActions } from './OrderActions';
import { PaymentBadge, StageLabel } from './OrderBadges';

const d = strings.orders.detail;
const t = strings.orders.timeline;
const LIST_PATH = '/orders';

/** /orders/:orderId (docs/DEVELOPMENT.md §6.5). Another business's order is "not found" (404). */
export function OrderDetailPage() {
  const { orderId = '' } = useParams();
  const query = useOrder(orderId);
  if (query.data !== undefined) return <OrderView order={query.data} />;
  if (query.isPending) {
    return (
      <p role="status" className="text-slate-600">
        {strings.common.loading}
      </p>
    );
  }
  if (isApiError(query.error) && query.error.status === 404) {
    return (
      <section className="space-y-3">
        <h1 className="text-2xl font-semibold">{d.notFoundTitle}</h1>
        <p className="text-slate-700">{d.notFoundBody}</p>
        <Link to={LIST_PATH} className={linkClass}>
          {d.back}
        </Link>
      </section>
    );
  }
  return (
    <section className="space-y-3">
      <FormAlert tone="error">
        <p className="font-semibold">{d.loadFailed}</p>
        <ApiErrorMessage error={query.error} />
      </FormAlert>
      <button type="button" className={buttonClass.secondary} onClick={() => void query.refetch()}>
        {strings.common.retry}
      </button>
    </section>
  );
}

/** One §6.5 section, named by its heading (a landmark screen readers can jump to). */
function Card({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="space-y-3 rounded-xl border border-slate-200 bg-white p-4"
    >
      <h2 id={headingId} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A label and value; values may be missing (shown as "Not set yet" or "—"). */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-slate-600">{label}</dt>
      <dd className="text-slate-900 sm:text-right">{children}</dd>
    </>
  );
}

const rows = 'grid gap-x-4 gap-y-1 sm:grid-cols-[1fr_auto]';

function OrderView({ order }: { order: OrderDetail }) {
  const currency = useBusinessCurrency();
  const timeZone = useBusinessTimeZone();
  const money = (amount: string) => formatMoney(amount, currency);
  const { delivery, customer } = order;
  const showCod =
    delivery !== null && (order.paymentMethod === 'COD' || delivery.codStatus !== 'NOT_APPLICABLE');

  return (
    <section className="max-w-3xl space-y-5">
      <p>
        <Link to={LIST_PATH} className={linkClass}>
          {d.back}
        </Link>
      </p>
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">{order.orderNumber}</h1>
        <p className="text-slate-600">{d.created(formatDateTime(order.createdAt, timeZone))}</p>
        <p className="flex flex-wrap items-center gap-2">
          <StageLabel stage={order.stage} />
          <PaymentBadge status={order.paymentStatus} />
        </p>
      </header>

      <Card title={d.sections.actions}>
        <OrderActions order={order} />
      </Card>

      <Card title={d.sections.customer}>
        {customer.id === null ? (
          <p className="text-slate-700">{d.walkIn}</p>
        ) : (
          <div className="space-y-1">
            <p className="font-medium">{customer.name}</p>
            {customer.phone !== null && <p className="text-slate-700">{customer.phone}</p>}
            <Link to={customerPaths.detail(customer.id)} className={linkClass}>
              {d.viewCustomer}
            </Link>
          </div>
        )}
        <dl className={rows}>
          <Row label={d.source}>
            {strings.sourceChannel[order.sourceChannel]}
            {order.sourceNote !== null && ` · ${order.sourceNote}`}
          </Row>
          <Row label={d.fulfilment}>{strings.fulfilmentType[order.fulfilmentType]}</Row>
        </dl>
      </Card>

      {delivery !== null && (
        <Card title={d.sections.delivery}>
          <dl className={rows}>
            <Row label={d.deliveryStatus}>{strings.deliveryStatus[delivery.status]}</Row>
            <Row label={d.recipient}>{delivery.recipientName}</Row>
            <Row label={d.phone}>{delivery.phone}</Row>
            <Row label={d.address}>
              {[
                delivery.addressLine1,
                delivery.addressLine2,
                delivery.city,
                delivery.district,
                delivery.postalCode,
              ]
                .filter((part): part is string => part !== null && part !== '')
                .join(', ')}
            </Row>
            <Row label={d.courier}>{delivery.courierName ?? d.notSet}</Row>
            <Row label={d.tracking}>{delivery.trackingNumber ?? d.notSet}</Row>
            {showCod && (
              <>
                <Row label={d.codAmount}>{money(delivery.codAmount)}</Row>
                <Row label={d.codStatus}>{strings.codStatus[delivery.codStatus]}</Row>
              </>
            )}
          </dl>
        </Card>
      )}

      <Card title={d.sections.items}>
        <ul className="divide-y divide-slate-100">
          {order.items.map((item) => (
            <li key={item.id} className="flex flex-wrap justify-between gap-2 py-2">
              <span>
                <span className="block font-medium">{item.name}</span>
                <span className="block text-sm text-slate-600">
                  {d.quantity(item.quantity, money(item.unitPrice))}
                  {item.sku !== null && ` · ${d.sku(item.sku)}`}
                </span>
              </span>
              <span className="text-slate-900">{money(item.lineTotal)}</span>
            </li>
          ))}
        </ul>
        <dl className={`${rows} border-t border-slate-200 pt-3`}>
          <Row label={d.subtotal}>{money(order.subtotal)}</Row>
          <Row label={d.discount}>{money(order.discountAmount)}</Row>
          {order.fulfilmentType === 'DELIVERY' && (
            <Row label={d.deliveryFee}>{money(order.deliveryFee)}</Row>
          )}
          <Row label={d.total}>
            <span className="font-semibold">{money(order.totalAmount)}</span>
          </Row>
        </dl>
      </Card>

      <Card title={d.sections.payment}>
        <dl className={rows}>
          <Row label={d.paymentMethod}>{strings.paymentMethod[order.paymentMethod]}</Row>
          <Row label={d.total}>{money(order.totalAmount)}</Row>
          <Row label={d.paid}>{money(order.amountPaid)}</Row>
          <Row label={d.refunded}>{money(order.amountRefunded)}</Row>
          <Row label={d.balance}>
            <span className="font-semibold">{money(order.balanceDue)}</span>
          </Row>
          {order.refundOwed !== '0.00' && (
            <Row label={d.refundOwed}>
              <span className="font-semibold text-red-800">{money(order.refundOwed)}</span>
            </Row>
          )}
        </dl>
      </Card>

      {order.notes !== null && (
        <Card title={d.sections.notes}>
          <p className="whitespace-pre-line text-slate-800">{order.notes}</p>
        </Card>
      )}

      <Card title={t.title}>
        <Timeline orderId={order.id} />
      </Card>
    </section>
  );
}

/** The activity history (§6.5), oldest first, a page at a time. */
function Timeline({ orderId }: { orderId: string }) {
  const [page, setPage] = useState(1);
  const events = useOrderEvents(orderId, page);
  const currency = useBusinessCurrency();
  const timeZone = useBusinessTimeZone();

  if (events.data === undefined) {
    return events.isError ? (
      <div className="space-y-3">
        <FormAlert tone="error">
          <p className="font-semibold">{t.loadFailed}</p>
          <ApiErrorMessage error={events.error} />
        </FormAlert>
        <button
          type="button"
          className={buttonClass.secondary}
          onClick={() => void events.refetch()}
        >
          {strings.common.retry}
        </button>
      </div>
    ) : (
      <p role="status" className="text-slate-600">
        {strings.common.loading}
      </p>
    );
  }
  if (events.data.items.length === 0) return <p className="text-slate-600">{t.empty}</p>;

  return (
    <div className="space-y-3" aria-busy={events.isFetching || undefined}>
      <ol aria-label={t.title} className="space-y-3 border-l-2 border-slate-200 pl-4">
        {events.data.items.map((event) => (
          <li key={event.id} className="space-y-0.5">
            <p className="font-medium text-slate-900">{describeEvent(event, currency)}</p>
            <p className="text-sm text-slate-600">
              {formatDateTime(event.createdAt, timeZone)}
              {' · '}
              {event.actor === null ? t.automatic : t.by(event.actor.name)}
            </p>
            {event.reason !== null && (
              <p className="text-sm text-slate-700">{t.reason(event.reason)}</p>
            )}
          </li>
        ))}
      </ol>
      <Pagination
        page={events.data.page}
        pageSize={events.data.pageSize}
        total={events.data.total}
        onPage={setPage}
      />
    </div>
  );
}
