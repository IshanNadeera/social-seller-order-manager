// /cod: "COD to settle" (docs/DEVELOPMENT.md §2.2, §9.4). Delivered COD orders whose money the
// courier still holds, one courier at a time. The seller ticks the orders one remittance covers and
// marks them settled together; the API settles all of them or none.
import { zodResolver } from '@hookform/resolvers/zod';
import { cents } from '@ssom/shared';
import type { CodAwaitingItem, CodBulkSettled, CodBulkSettleInput } from '@ssom/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { ApiErrorMessage } from '../../components/ApiErrorMessage';
import {
  CheckboxField,
  FormAlert,
  SelectField,
  SubmitButton,
  TextAreaField,
  TextField,
  buttonClass,
  linkClass,
} from '../../components/form';
import { Sheet, stopSubmit } from '../../components/Sheet';
import { isApiError } from '../../lib/api-client';
import { useApi } from '../../lib/api-context';
import { formatDate } from '../../lib/format';
import { formatMoney } from '../../lib/money';
import { strings } from '../../lib/strings';
import { useBusinessCurrency, useBusinessId, useBusinessTimeZone } from '../account/use-business';
import { dashboardKeys } from '../dashboard/api';
import { codKeys, orderKeys, useCodAwaiting } from './api';
import { codBulkSettleFormSchema, emptyCodSettleForm, localToday } from './payment-form';
import type { CodSettleFormValues } from './payment-form';

const c = strings.orders.cod;
const LIST_PATH = '/orders';
const orderPath = (id: string) => `/orders/${encodeURIComponent(id)}`;

/** Orders with no courier name are grouped under this key. */
const NO_COURIER = '';
const courierOf = (item: CodAwaitingItem) => item.courierName ?? NO_COURIER;
const courierLabel = (key: string) => (key === NO_COURIER ? c.noCourier : key);

/** Non-negative cents back to "1234.50". */
const fromCents = (value: bigint) => `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;

export function CodSettlePage() {
  const query = useCodAwaiting();
  const [done, setDone] = useState<CodBulkSettled | null>(null);
  const currency = useBusinessCurrency();

  return (
    <section className="max-w-3xl space-y-5">
      <p>
        <Link to={LIST_PATH} className={linkClass}>
          {c.back}
        </Link>
      </p>
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">{c.title}</h1>
        <p className="text-slate-700">{c.intro}</p>
      </header>
      <div role="status">
        {done !== null && (
          <FormAlert tone="success">
            {c.done(done.settled.length, formatMoney(done.totalAmount, currency))}
          </FormAlert>
        )}
      </div>
      {query.data === undefined ? (
        query.isError ? (
          <div className="space-y-3">
            <FormAlert tone="error">
              <p className="font-semibold">{c.loadFailed}</p>
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
          <p className="text-slate-600">{strings.common.loading}</p>
        )
      ) : query.data.items.length === 0 ? (
        <div className="space-y-2 rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center">
          <h2 className="font-semibold">{c.emptyTitle}</h2>
          <p className="text-slate-600">{c.emptyBody}</p>
        </div>
      ) : (
        <Remittance
          items={query.data.items}
          total={query.data.total}
          onSettled={(result) => setDone(result)}
          onStart={() => setDone(null)}
        />
      )}
    </section>
  );
}

function Remittance({
  items,
  total,
  onSettled,
  onStart,
}: {
  items: CodAwaitingItem[];
  /** All COD awaiting settlement, which may be more than the page shows. */
  total: number;
  onSettled: (result: CodBulkSettled) => void;
  onStart: () => void;
}) {
  const currency = useBusinessCurrency();
  const timeZone = useBusinessTimeZone();
  const couriers = useMemo(() => [...new Set(items.map(courierOf))], [items]);
  const [chosenCourier, setChosenCourier] = useState<string | null>(null);
  // One remittance comes from one courier; a courier that is gone (all settled) falls back.
  const courier =
    chosenCourier !== null && couriers.includes(chosenCourier)
      ? chosenCourier
      : (couriers[0] ?? NO_COURIER);
  const rows = items.filter((item) => courierOf(item) === courier);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [settling, setSettling] = useState(false);

  const chosen = rows.filter((row) => selected.has(row.orderId));
  const sum = fromCents(chosen.reduce((acc, row) => acc + cents(row.codAmount), 0n));
  const allChosen = rows.length > 0 && chosen.length === rows.length;

  const toggle = (orderId: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(orderId);
      else next.delete(orderId);
      return next;
    });

  return (
    <div className="space-y-4">
      {couriers.length > 1 && (
        <SelectField
          label={c.courier}
          value={courier}
          onChange={(event) => {
            setChosenCourier(event.target.value);
            setSelected(new Set());
          }}
        >
          {couriers.map((key) => (
            <option key={key} value={key}>
              {courierLabel(key)}
            </option>
          ))}
        </SelectField>
      )}

      <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold">{courierLabel(courier)}</h2>
        <CheckboxField
          label={c.selectAll}
          checked={allChosen}
          onChange={(event) =>
            setSelected(event.target.checked ? new Set(rows.map((row) => row.orderId)) : new Set())
          }
        />
        <ul aria-label={c.listLabel} className="divide-y divide-slate-100">
          {rows.map((row) => (
            <li
              key={row.orderId}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
            >
              <div className="space-y-0.5">
                <CheckboxField
                  label={c.row(row.orderNumber, row.recipientName)}
                  checked={selected.has(row.orderId)}
                  onChange={(event) => toggle(row.orderId, event.target.checked)}
                />
                <p className="pl-8 text-sm text-slate-600">
                  {[
                    row.trackingNumber === null ? null : c.tracking(row.trackingNumber),
                    row.deliveredAt === null
                      ? null
                      : c.delivered(formatDate(row.deliveredAt, timeZone)),
                  ]
                    .filter((part): part is string => part !== null)
                    .join(' · ')}
                </p>
                <p className="pl-8">
                  <Link to={orderPath(row.orderId)} className={`${linkClass} text-sm`}>
                    {c.view}
                  </Link>
                </p>
              </div>
              <span className="font-medium text-slate-900">
                {formatMoney(row.codAmount, currency)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {total > items.length && (
        <p className="text-sm text-slate-600">{c.more(items.length, total)}</p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-medium">{c.selected(chosen.length, formatMoney(sum, currency))}</p>
        <button
          type="button"
          className={buttonClass.primary}
          disabled={chosen.length === 0}
          onClick={() => {
            onStart();
            setSettling(true);
          }}
        >
          {c.settle}
        </button>
      </div>

      <SettleSheet
        open={settling}
        orderIds={chosen.map((row) => row.orderId)}
        courier={courierLabel(courier)}
        total={sum}
        onClose={() => setSettling(false)}
        onDone={(result) => {
          setSettling(false);
          setSelected(new Set());
          onSettled(result);
        }}
      />
    </div>
  );
}

const FIELDS = ['settledAt', 'reference', 'notes'] as const;

/** The remittance's date and reference, then POST /cod/settle with an Idempotency-Key. */
function SettleSheet({
  open,
  orderIds,
  courier,
  total,
  onClose,
  onDone,
}: {
  open: boolean;
  orderIds: string[];
  courier: string;
  total: string;
  onClose: () => void;
  onDone: (result: CodBulkSettled) => void;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const businessId = useBusinessId();
  const currency = useBusinessCurrency();
  const form = useForm<CodSettleFormValues, unknown, CodBulkSettleInput>({
    // Checked as the request it becomes, with the orders chosen now.
    resolver: zodResolver(codBulkSettleFormSchema(orderIds)),
    defaultValues: emptyCodSettleForm(),
  });

  // One key per request body: an unchanged retry can't record the remittance twice (§9.8).
  const attempt = useRef<{ body: string; key: string } | null>(null);
  const save = useMutation({
    mutationFn: (input: CodBulkSettleInput) => {
      const body = JSON.stringify(input);
      if (attempt.current?.body !== body) attempt.current = { body, key: crypto.randomUUID() };
      return api.post<CodBulkSettled>('/cod/settle', input, {
        idempotencyKey: attempt.current.key,
      });
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: codKeys.all(businessId) });
      void queryClient.invalidateQueries({ queryKey: orderKeys.all(businessId) });
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.all(businessId) });
      onDone(result);
    },
    onError: (error) => {
      if (!isApiError(error)) return;
      for (const [field, message] of Object.entries(error.fieldErrors)) {
        const name = FIELDS.find((candidate) => candidate === field);
        if (name !== undefined) form.setError(name, { type: 'server', message });
      }
    },
  });

  const { reset } = form;
  const { reset: resetSave } = save;
  useEffect(() => {
    if (!open) return;
    reset(emptyCodSettleForm(localToday()));
    resetSave();
    attempt.current = null;
  }, [open, reset, resetSave]);

  const s = c.sheet;
  const { errors } = form.formState;
  const fields = strings.orders.delivery.settleSheet;
  return (
    <Sheet open={open} title={s.title} busy={save.isPending} onClose={onClose}>
      <p className="text-slate-700">
        {s.body(orderIds.length, courier, formatMoney(total, currency))}
      </p>
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
          label={fields.date}
          hint={fields.dateHint}
          type="date"
          max={localToday()}
          error={errors.settledAt?.message}
          {...form.register('settledAt')}
        />
        <TextField
          label={fields.reference}
          hint={fields.referenceHint}
          autoComplete="off"
          error={errors.reference?.message}
          {...form.register('reference')}
        />
        <TextAreaField
          label={fields.notes}
          error={errors.notes?.message}
          {...form.register('notes')}
        />
        <SubmitButton pending={save.isPending} pendingLabel={s.pending}>
          {s.submit}
        </SubmitButton>
      </form>
    </Sheet>
  );
}
