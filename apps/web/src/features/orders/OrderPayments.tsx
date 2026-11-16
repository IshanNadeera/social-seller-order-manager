// The order's payment section (docs/DEVELOPMENT.md §6.5, §7.7): the summary, the payment history,
// and recording payments and refunds. A cancelled or returned order that still holds money shows a
// refund prompt until the refund is recorded.
import { zodResolver } from '@hookform/resolvers/zod';
import { MANUAL_PAYMENT_METHODS, cents } from '@ssom/shared';
import type {
  OrderDetail,
  PaymentCreateInput,
  PaymentRecorded,
  PaymentType,
  PaymentView,
} from '@ssom/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import type { FieldPath } from 'react-hook-form';
import { ApiErrorMessage } from '../../components/ApiErrorMessage';
import {
  FormAlert,
  SelectField,
  SubmitButton,
  TextAreaField,
  TextField,
  buttonClass,
} from '../../components/form';
import { Pagination } from '../../components/Pagination';
import { Sheet, stopSubmit } from '../../components/Sheet';
import { isApiError } from '../../lib/api-client';
import { useApi } from '../../lib/api-context';
import { formatDate, formatDateTime } from '../../lib/format';
import { formatMoney } from '../../lib/money';
import { strings } from '../../lib/strings';
import { useBusinessCurrency, useBusinessId, useBusinessTimeZone } from '../account/use-business';
import { orderKeys, useOrderPayments, useOrderSaved } from './api';
import { formFieldName } from './order-form';
import { emptyPaymentForm, localToday, paymentFormSchema } from './payment-form';
import type { PaymentFormValues } from './payment-form';

const d = strings.orders.detail;
const p = strings.orders.payments;

/** Non-negative cents back to "1234.50". */
const fromCents = (value: bigint) =>
  `${value / 100n}.${String((value < 0n ? -value : value) % 100n).padStart(2, '0')}`;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-slate-600">{label}</dt>
      <dd className="text-slate-900 sm:text-right">{children}</dd>
    </>
  );
}

export function OrderPayments({ order }: { order: OrderDetail }) {
  const currency = useBusinessCurrency();
  const money = (amount: string) => formatMoney(amount, currency);
  const [page, setPage] = useState(1);
  const payments = useOrderPayments(order.id, page);
  const [recording, setRecording] = useState<PaymentType | null>(null);

  const closed = order.orderStatus === 'CANCELLED' || order.orderStatus === 'RETURNED';
  const netPaid = cents(order.amountPaid) - cents(order.amountRefunded);
  // The same rules the API applies (§7.7); the buttons only appear when the action can succeed.
  const canPay = !closed && cents(order.balanceDue) > 0n;
  const canRefund = netPaid > 0n;
  const refundOwed = cents(order.refundOwed) > 0n;

  return (
    <div className="space-y-4">
      {refundOwed && (
        <div role="status" className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="font-semibold text-amber-900">
            {p.refundPromptTitle(money(order.refundOwed))}
          </p>
          <p className="text-sm text-amber-900">{p.refundPromptBody}</p>
          <button
            type="button"
            className={buttonClass.primary}
            onClick={() => setRecording('REFUND')}
          >
            {p.recordRefund}
          </button>
        </div>
      )}

      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[1fr_auto]">
        <Row label={d.paymentMethod}>{strings.paymentMethod[order.paymentMethod]}</Row>
        <Row label={d.total}>{money(order.totalAmount)}</Row>
        <Row label={d.paid}>{money(order.amountPaid)}</Row>
        <Row label={d.refunded}>{money(order.amountRefunded)}</Row>
        <Row label={d.balance}>
          <span className="font-semibold">{money(order.balanceDue)}</span>
        </Row>
        {refundOwed && (
          <Row label={d.refundOwed}>
            <span className="font-semibold text-red-800">{money(order.refundOwed)}</span>
          </Row>
        )}
      </dl>

      {(canPay || (canRefund && !refundOwed)) && (
        <div className="flex flex-wrap gap-2">
          {canPay && (
            <button
              type="button"
              className={buttonClass.primary}
              onClick={() => setRecording('PAYMENT')}
            >
              {p.recordPayment}
            </button>
          )}
          {canRefund && !refundOwed && (
            <button
              type="button"
              className={buttonClass.secondary}
              onClick={() => setRecording('REFUND')}
            >
              {p.recordRefund}
            </button>
          )}
        </div>
      )}

      <PaymentHistory query={payments} onPage={setPage} />

      <PaymentSheet
        order={order}
        type={recording}
        payments={payments.data?.items ?? []}
        netPaid={netPaid}
        onClose={() => setRecording(null)}
      />
    </div>
  );
}

function PaymentHistory({
  query,
  onPage,
}: {
  query: ReturnType<typeof useOrderPayments>;
  onPage: (page: number) => void;
}) {
  const currency = useBusinessCurrency();
  const timeZone = useBusinessTimeZone();
  return (
    <section className="space-y-2" aria-label={p.history}>
      <h3 className="font-semibold">{p.history}</h3>
      {query.data === undefined ? (
        query.isError ? (
          <div className="space-y-2">
            <FormAlert tone="error">
              <p className="font-semibold">{p.loadFailed}</p>
              <ApiErrorMessage error={query.error} />
            </FormAlert>
            <button
              type="button"
              className={buttonClass.secondary}
              onClick={() => void query.refetch()}
            >
              {strings.common.retry}
            </button>
          </div>
        ) : (
          <p role="status" className="text-slate-600">
            {strings.common.loading}
          </p>
        )
      ) : query.data.items.length === 0 ? (
        <p className="text-slate-600">{p.empty}</p>
      ) : (
        <>
          <ul aria-label={p.history} className="divide-y divide-slate-100">
            {query.data.items.map((payment) => (
              <li key={payment.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  <span className="block font-medium">
                    {strings.paymentType[payment.type]}
                    {' · '}
                    {formatDateTime(payment.occurredAt, timeZone)}
                  </span>
                  <span className="block text-sm text-slate-600">
                    {p.line(strings.paymentMethod[payment.method], payment.recordedBy.name)}
                    {payment.reference !== null && ` · ${p.reference(payment.reference)}`}
                  </span>
                  {payment.refundOfPaymentId !== null && (
                    <span className="block text-sm text-slate-600">{p.refundOf}</span>
                  )}
                  {payment.notes !== null && (
                    <span className="block text-sm text-slate-700">{payment.notes}</span>
                  )}
                </span>
                <span
                  className={
                    payment.type === 'REFUND'
                      ? 'font-medium text-red-800'
                      : 'font-medium text-slate-900'
                  }
                >
                  {payment.type === 'REFUND' ? '−' : ''}
                  {formatMoney(payment.amount, currency)}
                </span>
              </li>
            ))}
          </ul>
          <Pagination
            page={query.data.page}
            pageSize={query.data.pageSize}
            total={query.data.total}
            onPage={onPage}
          />
        </>
      )}
    </section>
  );
}

const FIELDS: FieldPath<PaymentFormValues>[] = [
  'amount',
  'method',
  'occurredAt',
  'refundOfPaymentId',
  'reference',
  'notes',
];

/** Record a payment or a refund (§7.7), in a sheet over the order page. */
function PaymentSheet({
  order,
  type,
  payments,
  netPaid,
  onClose,
}: {
  order: OrderDetail;
  type: PaymentType | null;
  /** Payments already on screen, to link a refund to (optional). */
  payments: PaymentView[];
  netPaid: bigint;
  onClose: () => void;
}) {
  const api = useApi();
  const saved = useOrderSaved();
  const queryClient = useQueryClient();
  const businessId = useBusinessId();
  const currency = useBusinessCurrency();
  const timeZone = useBusinessTimeZone();
  const refund = type === 'REFUND';
  const schema = useMemo(() => paymentFormSchema(type ?? 'PAYMENT'), [type]);
  const form = useForm<PaymentFormValues, unknown, PaymentCreateInput>({
    resolver: zodResolver(schema),
    defaultValues: emptyPaymentForm(''),
  });
  const { errors } = form.formState;

  // One key per request body: an unchanged retry can't record the money twice (§9.8).
  const attempt = useRef<{ body: string; key: string } | null>(null);
  const save = useMutation({
    mutationFn: (input: PaymentCreateInput) => {
      const body = JSON.stringify(input);
      if (attempt.current?.body !== body) attempt.current = { body, key: crypto.randomUUID() };
      return api.post<PaymentRecorded>(`/orders/${encodeURIComponent(order.id)}/payments`, input, {
        idempotencyKey: attempt.current.key,
      });
    },
    onSuccess: (result) => {
      saved(result.order);
      void queryClient.invalidateQueries({ queryKey: orderKeys.payments(businessId, order.id) });
      onClose();
    },
    onError: (error) => {
      if (!isApiError(error)) return;
      for (const [field, message] of Object.entries(error.fieldErrors)) {
        const name = formFieldName(field);
        if ((FIELDS as string[]).includes(name)) {
          form.setError(name as FieldPath<PaymentFormValues>, { type: 'server', message });
        }
      }
    },
  });

  // Each opening starts afresh, with the amount most likely to be right.
  const { reset } = form;
  const { reset: resetSave } = save;
  const suggested =
    type === null
      ? ''
      : refund
        ? cents(order.refundOwed) > 0n
          ? order.refundOwed
          : fromCents(netPaid)
        : order.balanceDue;
  useEffect(() => {
    if (type === null) return;
    reset(emptyPaymentForm(suggested, localToday()));
    resetSave();
    attempt.current = null;
  }, [type, suggested, reset, resetSave]);

  const s = p.sheet;
  const refundable = payments.filter((payment) => payment.type === 'PAYMENT');
  return (
    <Sheet
      open={type !== null}
      title={refund ? s.refundTitle : s.paymentTitle}
      busy={save.isPending}
      onClose={onClose}
    >
      {save.isError && (
        <FormAlert tone="error">
          <ApiErrorMessage error={save.error} />
        </FormAlert>
      )}
      <form
        noValidate
        className="space-y-4"
        onSubmit={stopSubmit(
          form.handleSubmit((input) => {
            if (!save.isPending) save.mutate(input);
          }),
        )}
      >
        <TextField
          label={s.amount}
          hint={
            refund
              ? s.refundAmountHint(formatMoney(fromCents(netPaid), currency))
              : s.paymentAmountHint(formatMoney(order.balanceDue, currency))
          }
          inputMode="decimal"
          autoComplete="off"
          error={errors.amount?.message}
          {...form.register('amount')}
        />
        <SelectField label={s.method} error={errors.method?.message} {...form.register('method')}>
          <option value="">{s.chooseMethod}</option>
          {MANUAL_PAYMENT_METHODS.map((method) => (
            <option key={method} value={method}>
              {strings.paymentMethod[method]}
            </option>
          ))}
        </SelectField>
        <TextField
          label={s.date}
          hint={s.dateHint}
          type="date"
          max={localToday()}
          error={errors.occurredAt?.message}
          {...form.register('occurredAt')}
        />
        {refund && refundable.length > 0 && (
          <SelectField
            label={s.refundOf}
            error={errors.refundOfPaymentId?.message}
            {...form.register('refundOfPaymentId')}
          >
            <option value="">{s.refundOfNone}</option>
            {refundable.map((payment) => (
              <option key={payment.id} value={payment.id}>
                {s.refundOfOption(
                  formatDate(payment.occurredAt, timeZone),
                  formatMoney(payment.amount, currency),
                )}
              </option>
            ))}
          </SelectField>
        )}
        <TextField
          label={s.reference}
          hint={s.referenceHint}
          autoComplete="off"
          error={errors.reference?.message}
          {...form.register('reference')}
        />
        <TextAreaField
          label={s.notes}
          hint={s.notesHint}
          error={errors.notes?.message}
          {...form.register('notes')}
        />
        <SubmitButton pending={save.isPending} pendingLabel={s.pending}>
          {refund ? s.submitRefund : s.submitPayment}
        </SubmitButton>
      </form>
    </Sheet>
  );
}
