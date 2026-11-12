// The order page's delivery card (docs/DEVELOPMENT.md §6.5, §7.2): the delivery copy, courier,
// tracking and COD, with a button only for each delivery move the shared transition table allows
// now, for this user, and "Mark COD settled" once the courier has collected the money. Moves that
// need details (courier, a reason, the settle date) open a sheet first. The API checks every rule
// again.
import { zodResolver } from '@hookform/resolvers/zod';
import {
  allowedDeliveryTransitions,
  deliveryDispatchSchema,
  deliveryFailedSchema,
  deliveryReturnedSchema,
} from '@ssom/shared';
import type {
  CodSettleInput,
  DeliveryStatus,
  OrderDetail,
  OrderDeliveryView,
  PaymentRecorded,
} from '@ssom/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import type { Resolver } from 'react-hook-form';
import { ApiErrorMessage } from '../../components/ApiErrorMessage';
import {
  FormAlert,
  SubmitButton,
  TextAreaField,
  TextField,
  buttonClass,
} from '../../components/form';
import { Sheet, stopSubmit } from '../../components/Sheet';
import { isApiError } from '../../lib/api-client';
import { useApi } from '../../lib/api-context';
import { formatMoney } from '../../lib/money';
import { strings } from '../../lib/strings';
import { useBusinessCurrency, useBusinessId } from '../account/use-business';
import { useMe } from '../account/use-me';
import { orderKeys, useOrderSaved } from './api';
import { codSettleFormSchema, emptyCodSettleForm, localToday } from './payment-form';
import type { CodSettleFormValues } from './payment-form';

const d = strings.orders.detail;
const v = strings.orders.delivery;

type Move = Exclude<DeliveryStatus, 'PENDING'>;
/** Which sheet is open: a move that needs details, or settling COD. */
type Asking = 'DISPATCHED' | 'FAILED' | 'RETURNED' | 'SETTLE' | null;

const path = (order: OrderDetail, action: string) =>
  `/orders/${encodeURIComponent(order.id)}/${action}`;
const MOVE_PATH: Record<Move, string> = {
  DISPATCHED: 'delivery/dispatch',
  DELIVERED: 'delivery/delivered',
  FAILED: 'delivery/failed',
  RETURNED: 'delivery/returned',
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-slate-600">{label}</dt>
      <dd className="text-slate-900 sm:text-right">{children}</dd>
    </>
  );
}

export function DeliveryCard({ order, delivery }: { order: OrderDetail; delivery: OrderDeliveryView }) {
  const api = useApi();
  const saved = useOrderSaved();
  const currency = useBusinessCurrency();
  // Until /me answers, act as staff: owner-only corrections stay hidden rather than flash in.
  const role = useMe().data?.role ?? 'STAFF';
  const [asking, setAsking] = useState<Asking>(null);

  const showCod = order.paymentMethod === 'COD' || delivery.codStatus !== 'NOT_APPLICABLE';
  const allowed = allowedDeliveryTransitions(delivery.status, {
    orderStatus: order.orderStatus,
    role,
  }) as Move[];
  const canSettle = delivery.codStatus === 'COLLECTED';
  const closed = order.orderStatus === 'CANCELLED' || order.orderStatus === 'RETURNED';
  const waitingForReady = delivery.status === 'PENDING' && !closed && allowed.length === 0;

  // "Delivered" needs nothing more, so it is one tap, like the order's own moves.
  const deliver = useMutation({
    mutationFn: () => api.post<OrderDetail>(path(order, MOVE_PATH.DELIVERED), {}),
    onSuccess: saved,
  });

  const open = (next: Asking) => {
    deliver.reset();
    setAsking(next);
  };
  const done = (updated: OrderDetail) => {
    setAsking(null);
    saved(updated);
  };

  return (
    <div className="space-y-3">
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[1fr_auto]">
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
            <Row label={d.codAmount}>{formatMoney(delivery.codAmount, currency)}</Row>
            <Row label={d.codStatus}>{strings.codStatus[delivery.codStatus]}</Row>
          </>
        )}
      </dl>

      {deliver.isError && (
        <FormAlert tone="error">
          <p className="font-semibold">{v.actionFailed}</p>
          <ApiErrorMessage error={deliver.error} />
        </FormAlert>
      )}
      {waitingForReady && <p className="text-slate-600">{v.readyFirst}</p>}
      {(allowed.length > 0 || canSettle) && (
        <div className="flex flex-wrap gap-2">
          {allowed.map((to) =>
            to === 'DELIVERED' ? (
              <button
                key={to}
                type="button"
                className={buttonClass.primary}
                disabled={deliver.isPending}
                aria-busy={deliver.isPending || undefined}
                onClick={() => deliver.mutate()}
              >
                {deliver.isPending ? v.moving : v.move.DELIVERED}
              </button>
            ) : (
              <button
                key={to}
                type="button"
                className={
                  to === 'DISPATCHED' ? buttonClass.primary : buttonClass.secondary
                }
                disabled={deliver.isPending}
                onClick={() => open(to)}
              >
                {to === 'DISPATCHED' && delivery.status === 'FAILED' ? v.redispatch : v.move[to]}
              </button>
            ),
          )}
          {canSettle && (
            <button
              type="button"
              className={buttonClass.primary}
              disabled={deliver.isPending}
              onClick={() => open('SETTLE')}
            >
              {v.settleCod}
            </button>
          )}
        </div>
      )}

      <DispatchSheet
        order={order}
        delivery={delivery}
        open={asking === 'DISPATCHED'}
        onClose={() => setAsking(null)}
        onDone={done}
      />
      <ReasonSheet
        order={order}
        move={asking === 'FAILED' || asking === 'RETURNED' ? asking : null}
        // Only the owner's correction of a delivered parcel must say why it came back (§7.2).
        reasonRequired={asking === 'FAILED' || delivery.status === 'DELIVERED'}
        onClose={() => setAsking(null)}
        onDone={done}
      />
      <SettleSheet
        order={order}
        delivery={delivery}
        open={asking === 'SETTLE'}
        onClose={() => setAsking(null)}
        onDone={done}
      />
    </div>
  );
}

type DispatchValues = { courierName: string; trackingNumber: string };
type DispatchBody = { courierName?: string | null; trackingNumber?: string | null };

/** Send the parcel out, with the courier and tracking number if known. */
function DispatchSheet({
  order,
  delivery,
  open,
  onClose,
  onDone,
}: {
  order: OrderDetail;
  delivery: OrderDeliveryView;
  open: boolean;
  onClose: () => void;
  onDone: (order: OrderDetail) => void;
}) {
  const api = useApi();
  const form = useForm<DispatchValues, unknown, DispatchBody>({
    resolver: zodResolver(deliveryDispatchSchema) as Resolver<DispatchValues, unknown, DispatchBody>,
    defaultValues: { courierName: '', trackingNumber: '' },
  });
  const save = useMutation({
    mutationFn: (body: DispatchBody) =>
      api.post<OrderDetail>(path(order, MOVE_PATH.DISPATCHED), body),
    onSuccess: onDone,
  });
  const { reset } = form;
  const { reset: resetSave } = save;
  const courier = delivery.courierName ?? '';
  const tracking = delivery.trackingNumber ?? '';
  useEffect(() => {
    if (!open) return;
    // What the seller saved earlier is kept unless they change it here.
    reset({ courierName: courier, trackingNumber: tracking });
    resetSave();
  }, [open, courier, tracking, reset, resetSave]);

  const s = v.dispatchSheet;
  const { errors } = form.formState;
  return (
    <Sheet open={open} title={s.title(order.orderNumber)} busy={save.isPending} onClose={onClose}>
      <p className="text-slate-700">{s.body}</p>
      {save.isError && (
        <FormAlert tone="error">
          <ApiErrorMessage error={save.error} />
        </FormAlert>
      )}
      <form
        noValidate
        className="space-y-4"
        onSubmit={stopSubmit(
          form.handleSubmit((body) => {
            if (!save.isPending) save.mutate(body);
          }),
        )}
      >
        <TextField
          label={s.courier}
          autoComplete="off"
          error={errors.courierName?.message}
          {...form.register('courierName')}
        />
        <TextField
          label={s.tracking}
          autoComplete="off"
          error={errors.trackingNumber?.message}
          {...form.register('trackingNumber')}
        />
        <SubmitButton pending={save.isPending} pendingLabel={s.pending}>
          {s.submit}
        </SubmitButton>
      </form>
    </Sheet>
  );
}

type ReasonValues = { reason: string };
type ReasonBody = { reason?: string | null };

/** "Delivery failed" (reason required) or "Record return" (reason required after delivery). */
function ReasonSheet({
  order,
  move,
  reasonRequired,
  onClose,
  onDone,
}: {
  order: OrderDetail;
  move: 'FAILED' | 'RETURNED' | null;
  reasonRequired: boolean;
  onClose: () => void;
  onDone: (order: OrderDetail) => void;
}) {
  const api = useApi();
  const schema = reasonRequired ? deliveryFailedSchema : deliveryReturnedSchema;
  const form = useForm<ReasonValues, unknown, ReasonBody>({
    resolver: zodResolver(schema) as Resolver<ReasonValues, unknown, ReasonBody>,
    defaultValues: { reason: '' },
  });
  const save = useMutation({
    mutationFn: ({ to, body }: { to: 'FAILED' | 'RETURNED'; body: ReasonBody }) =>
      api.post<OrderDetail>(path(order, MOVE_PATH[to]), body),
    onSuccess: onDone,
  });
  const { reset } = form;
  const { reset: resetSave } = save;
  useEffect(() => {
    if (move === null) return;
    reset({ reason: '' });
    resetSave();
  }, [move, reset, resetSave]);

  const s = v.reasonSheet;
  const failed = move === 'FAILED';
  return (
    <Sheet
      open={move !== null}
      title={failed ? s.failedTitle(order.orderNumber) : s.returnedTitle(order.orderNumber)}
      busy={save.isPending}
      onClose={onClose}
    >
      <p className="text-slate-700">{failed ? s.failedBody : s.returnedBody}</p>
      {save.isError && (
        <FormAlert tone="error">
          <ApiErrorMessage error={save.error} />
        </FormAlert>
      )}
      <form
        noValidate
        className="space-y-4"
        onSubmit={stopSubmit(
          form.handleSubmit((body) => {
            if (move !== null && !save.isPending) save.mutate({ to: move, body });
          }),
        )}
      >
        <TextAreaField
          label={reasonRequired ? s.reason : s.reasonOptional}
          hint={s.reasonHint}
          error={form.formState.errors.reason?.message}
          {...form.register('reason')}
        />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            className={buttonClass.secondary}
            onClick={onClose}
            disabled={save.isPending}
          >
            {s.keep}
          </button>
          <button
            type="submit"
            className={buttonClass.danger}
            disabled={save.isPending}
            aria-busy={save.isPending || undefined}
          >
            {save.isPending ? s.pending : failed ? v.move.FAILED : v.move.RETURNED}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

const SETTLE_FIELDS = ['settledAt', 'reference', 'notes'] as const;

/** Record the courier's COD payout (§7.7): one COD payment, with the day it arrived. */
function SettleSheet({
  order,
  delivery,
  open,
  onClose,
  onDone,
}: {
  order: OrderDetail;
  delivery: OrderDeliveryView;
  open: boolean;
  onClose: () => void;
  onDone: (order: OrderDetail) => void;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const businessId = useBusinessId();
  const currency = useBusinessCurrency();
  const schema = useMemo(() => codSettleFormSchema(), []);
  const form = useForm<CodSettleFormValues, unknown, CodSettleInput>({
    resolver: zodResolver(schema),
    defaultValues: emptyCodSettleForm(),
  });

  // One key per request body: an unchanged retry can't record the payout twice (§9.8).
  const attempt = useRef<{ body: string; key: string } | null>(null);
  const save = useMutation({
    mutationFn: (input: CodSettleInput) => {
      const body = JSON.stringify(input);
      if (attempt.current?.body !== body) attempt.current = { body, key: crypto.randomUUID() };
      return api.post<PaymentRecorded>(path(order, 'cod/settle'), input, {
        idempotencyKey: attempt.current.key,
      });
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: orderKeys.payments(businessId, order.id) });
      onDone(result.order);
    },
    onError: (error) => {
      if (!isApiError(error)) return;
      for (const [field, message] of Object.entries(error.fieldErrors)) {
        const name = SETTLE_FIELDS.find((candidate) => candidate === field);
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

  const s = v.settleSheet;
  const { errors } = form.formState;
  return (
    <Sheet open={open} title={s.title} busy={save.isPending} onClose={onClose}>
      <p className="text-slate-700">{s.body(formatMoney(delivery.codAmount, currency))}</p>
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
          label={s.date}
          hint={s.dateHint}
          type="date"
          max={localToday()}
          error={errors.settledAt?.message}
          {...form.register('settledAt')}
        />
        <TextField
          label={s.reference}
          hint={s.referenceHint}
          autoComplete="off"
          error={errors.reference?.message}
          {...form.register('reference')}
        />
        <TextAreaField label={s.notes} error={errors.notes?.message} {...form.register('notes')} />
        <SubmitButton pending={save.isPending} pendingLabel={s.pending}>
          {s.submit}
        </SubmitButton>
      </form>
    </Sheet>
  );
}
