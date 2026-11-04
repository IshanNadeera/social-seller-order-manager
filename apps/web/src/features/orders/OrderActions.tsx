// Order status actions (docs/DEVELOPMENT.md §6.5, §7.2): a button only for each move the shared
// transition table allows now, for this user. Cancel and return ask for a reason in a sheet first,
// so nothing irreversible happens on one tap. The API checks the same rules again.
import { zodResolver } from '@hookform/resolvers/zod';
import { allowedOrderTransitions, orderCancelSchema } from '@ssom/shared';
import type { OrderCancelInput, OrderCancelRequest, OrderDetail, OrderStatus } from '@ssom/shared';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { ApiErrorMessage } from '../../components/ApiErrorMessage';
import { FormAlert, TextAreaField, buttonClass } from '../../components/form';
import { Sheet, stopSubmit } from '../../components/Sheet';
import { useApi } from '../../lib/api-context';
import { strings } from '../../lib/strings';
import { useMe } from '../account/use-me';
import { useOrderSaved } from './api';

const d = strings.orders.detail;
const r = strings.orders.reasonSheet;

/** Moves that need a reason, and so a confirmation sheet. */
type ReasonMove = 'CANCELLED' | 'RETURNED';
const needsReason = (to: OrderStatus): to is ReasonMove => to === 'CANCELLED' || to === 'RETURNED';

export function OrderActions({ order }: { order: OrderDetail }) {
  const api = useApi();
  const saved = useOrderSaved();
  // Until /me answers, act as staff: owner-only corrections stay hidden rather than flash in.
  const role = useMe().data?.role ?? 'STAFF';
  const [asking, setAsking] = useState<ReasonMove | null>(null);
  const base = `/orders/${encodeURIComponent(order.id)}`;

  const allowed = allowedOrderTransitions(order.orderStatus, {
    fulfilmentType: order.fulfilmentType,
    deliveryStatus: order.delivery?.status ?? null,
    role,
  });

  const move = useMutation({
    mutationFn: (to: OrderStatus) => api.post<OrderDetail>(`${base}/status`, { to }),
    onSuccess: saved,
  });

  if (allowed.length === 0) return <p className="text-slate-600">{d.noActions}</p>;

  return (
    <div className="space-y-3">
      {move.isError && (
        <FormAlert tone="error">
          <p className="font-semibold">{d.statusFailed}</p>
          <ApiErrorMessage error={move.error} />
        </FormAlert>
      )}
      <div className="flex flex-wrap gap-2">
        {allowed.map((to) =>
          needsReason(to) ? (
            <button
              key={to}
              type="button"
              className={buttonClass.danger}
              disabled={move.isPending}
              onClick={() => {
                move.reset();
                setAsking(to);
              }}
            >
              {d.move[to]}
            </button>
          ) : (
            <button
              key={to}
              type="button"
              className={buttonClass.secondary}
              disabled={move.isPending}
              aria-busy={(move.isPending && move.variables === to) || undefined}
              onClick={() => move.mutate(to)}
            >
              {move.isPending && move.variables === to ? d.moving : d.move[to]}
            </button>
          ),
        )}
      </div>
      <ReasonSheet
        order={order}
        move={asking}
        onClose={() => setAsking(null)}
        onDone={(updated) => {
          setAsking(null);
          saved(updated);
        }}
      />
    </div>
  );
}

/** "Cancel NIM-0042?" with a required reason: the confirmation §6.3 asks for. */
function ReasonSheet({
  order,
  move,
  onClose,
  onDone,
}: {
  order: OrderDetail;
  move: ReasonMove | null;
  onClose: () => void;
  onDone: (order: OrderDetail) => void;
}) {
  const api = useApi();
  const base = `/orders/${encodeURIComponent(order.id)}`;
  const form = useForm<OrderCancelRequest, unknown, OrderCancelInput>({
    resolver: zodResolver(orderCancelSchema),
    defaultValues: { reason: '' },
  });
  const save = useMutation({
    mutationFn: ({ to, reason }: { to: ReasonMove; reason: string }) =>
      to === 'CANCELLED'
        ? api.post<OrderDetail>(`${base}/cancel`, { reason })
        : api.post<OrderDetail>(`${base}/status`, { to, reason }),
    onSuccess: onDone,
  });
  const { reset } = form;
  const { reset: resetSave } = save;
  useEffect(() => {
    if (move === null) return;
    reset({ reason: '' });
    resetSave();
  }, [move, reset, resetSave]);

  const cancelling = move === 'CANCELLED';
  return (
    <Sheet
      open={move !== null}
      title={cancelling ? r.cancelTitle(order.orderNumber) : r.returnTitle(order.orderNumber)}
      busy={save.isPending}
      onClose={onClose}
    >
      <p className="text-slate-700">{cancelling ? r.cancelBody : r.returnBody}</p>
      {save.isError && (
        <FormAlert tone="error">
          <ApiErrorMessage error={save.error} />
        </FormAlert>
      )}
      <form
        noValidate
        className="space-y-4"
        onSubmit={stopSubmit(
          form.handleSubmit(({ reason }) => {
            if (move !== null) save.mutate({ to: move, reason });
          }),
        )}
      >
        <TextAreaField
          label={r.reason}
          hint={r.reasonHint}
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
            {r.keep}
          </button>
          <button
            type="submit"
            className={buttonClass.danger}
            disabled={save.isPending}
            aria-busy={save.isPending || undefined}
          >
            {save.isPending
              ? cancelling
                ? r.cancelPending
                : r.returnPending
              : cancelling
                ? r.cancelConfirm
                : r.returnConfirm}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
