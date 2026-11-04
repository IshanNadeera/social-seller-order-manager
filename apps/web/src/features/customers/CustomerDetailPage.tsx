import { MAX_ACTIVE_ADDRESSES } from '@ssom/shared';
import type { CustomerAddressView, CustomerDetail } from '@ssom/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { ApiErrorMessage } from '../../components/ApiErrorMessage';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { FormAlert, buttonClass, linkClass } from '../../components/form';
import { isApiError } from '../../lib/api-client';
import { useApi } from '../../lib/api-context';
import { formatDate } from '../../lib/format';
import { strings } from '../../lib/strings';
import { AddressForm } from './AddressForm';
import { CustomerOrders } from './CustomerOrders';
import { useBusinessTimeZone } from '../account/use-business';
import { useCustomer, useCustomerSaved } from './api';
import { customerPaths } from './paths';

const s = strings.customers;

/**
 * Loads one customer and renders `children` with it; otherwise a loading line, "not found" (also
 * for another business's customer: the API answers both with the same 404), or an error with retry.
 */
export function WithCustomer({
  id,
  children,
}: {
  id: string;
  children: (customer: CustomerDetail) => ReactNode;
}) {
  const query = useCustomer(id);
  if (query.data !== undefined) return children(query.data);
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
        <h1 className="text-2xl font-semibold">{s.detail.notFoundTitle}</h1>
        <p className="text-slate-700">{s.detail.notFoundBody}</p>
        <Link to={customerPaths.list} className={linkClass}>
          {s.detail.back}
        </Link>
      </section>
    );
  }
  return (
    <section className="space-y-3">
      <FormAlert tone="error">
        <p className="font-semibold">{s.detail.loadFailed}</p>
        <ApiErrorMessage error={query.error} />
      </FormAlert>
      <button type="button" className={buttonClass.secondary} onClick={() => void query.refetch()}>
        {strings.common.retry}
      </button>
    </section>
  );
}

/** /customers/:customerId (§6.6): details, order count, last order date and addresses. */
export function CustomerDetailPage() {
  const { customerId = '' } = useParams();
  return (
    <WithCustomer id={customerId}>
      {(customer) => <CustomerView customer={customer} />}
    </WithCustomer>
  );
}

function CustomerView({ customer }: { customer: CustomerDetail }) {
  const api = useApi();
  const saved = useCustomerSaved();
  const timeZone = useBusinessTimeZone();
  const [confirming, setConfirming] = useState(false);
  const archived = customer.archivedAt !== null;

  const archive = useMutation({
    mutationFn: () =>
      api.post<CustomerDetail>(`/customers/${encodeURIComponent(customer.id)}/archive`, undefined),
    onSuccess: (updated) => {
      saved(updated);
      setConfirming(false);
    },
  });

  const none = strings.common.none;

  return (
    <section className="space-y-6">
      <p>
        <Link to={customerPaths.list} className={linkClass}>
          {s.detail.back}
        </Link>
      </p>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold break-words">{customer.name}</h1>
          {archived && <ArchivedBadge />}
        </div>
        {!archived && (
          <div className="flex gap-2">
            <Link to={customerPaths.edit(customer.id)} className={buttonClass.secondary}>
              {strings.common.edit}
            </Link>
            <button
              type="button"
              className={buttonClass.secondary}
              onClick={() => {
                archive.reset();
                setConfirming(true);
              }}
            >
              {s.detail.archive}
            </button>
          </div>
        )}
      </div>

      {archived && archive.isSuccess && (
        <FormAlert tone="success">{s.detail.archivedDone}</FormAlert>
      )}
      {archived && <Notice>{s.detail.archivedBanner}</Notice>}

      <dl className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <Detail term={s.detail.phone}>
          {customer.phone ?? none}
          {customer.phoneWarning !== null && (
            <span className="mt-1 block text-sm text-amber-800">{s.detail.phoneUnreadable}</span>
          )}
        </Detail>
        <Detail term={s.detail.email}>{customer.email ?? none}</Detail>
        <Detail term={s.detail.orders}>{customer.orderCount}</Detail>
        <Detail term={s.detail.lastOrder}>
          {customer.lastOrderAt === null ? none : formatDate(customer.lastOrderAt, timeZone)}
        </Detail>
        {customer.notes !== null && (
          <div className="sm:col-span-2">
            <Detail term={s.detail.notes}>
              <span className="whitespace-pre-line">{customer.notes}</span>
            </Detail>
          </div>
        )}
      </dl>

      <Addresses customer={customer} />

      <CustomerOrders customerId={customer.id} />

      <ConfirmDialog
        open={confirming}
        title={s.archiveDialog.title(customer.name)}
        body={s.archiveDialog.body}
        confirmLabel={s.archiveDialog.confirm}
        pendingLabel={s.archiveDialog.pending}
        pending={archive.isPending}
        error={archive.error ?? undefined}
        onConfirm={() => archive.mutate()}
        onCancel={() => setConfirming(false)}
      />
    </section>
  );
}

function Detail({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-sm font-medium text-slate-600">{term}</dt>
      <dd className="mt-0.5 break-words text-slate-900">{children}</dd>
    </div>
  );
}

function ArchivedBadge() {
  return (
    <span className="rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
      {s.detail.archivedBadge}
    </span>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      {children}
    </p>
  );
}

type AddressMode = { kind: 'idle' } | { kind: 'adding' } | { kind: 'editing'; id: string };

/** Saved delivery addresses (§6.6, §7.11): the default first, then the others. */
function Addresses({ customer }: { customer: CustomerDetail }) {
  const api = useApi();
  const saved = useCustomerSaved();
  const [mode, setMode] = useState<AddressMode>({ kind: 'idle' });
  const [removing, setRemoving] = useState<CustomerAddressView | null>(null);
  const a = s.addresses;
  const archived = customer.archivedAt !== null;
  const base = `/customers/${encodeURIComponent(customer.id)}/addresses`;
  const atLimit = customer.addresses.length >= MAX_ACTIVE_ADDRESSES;

  const makeDefault = useMutation({
    mutationFn: (addressId: string) =>
      api.patch<CustomerDetail>(`${base}/${encodeURIComponent(addressId)}`, { isDefault: true }),
    onSuccess: saved,
  });
  const remove = useMutation({
    mutationFn: (addressId: string) =>
      api.post<CustomerDetail>(`${base}/${encodeURIComponent(addressId)}/archive`, undefined),
    onSuccess: (updated) => {
      saved(updated);
      setRemoving(null);
    },
  });

  const done = () => setMode({ kind: 'idle' });

  return (
    <section aria-labelledby="addresses-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="addresses-heading" className="text-lg font-semibold">
          {a.title}
        </h2>
        {!archived && mode.kind === 'idle' && !atLimit && (
          <button
            type="button"
            className={buttonClass.secondary}
            onClick={() => setMode({ kind: 'adding' })}
          >
            {a.add}
          </button>
        )}
      </div>

      {makeDefault.isError && (
        <FormAlert tone="error">
          <ApiErrorMessage error={makeDefault.error} />
        </FormAlert>
      )}
      {!archived && atLimit && <Notice>{a.limitReached(MAX_ACTIVE_ADDRESSES)}</Notice>}

      {mode.kind === 'adding' && (
        <AddressForm
          customerId={customer.id}
          offerDefault={customer.addresses.length > 0}
          prefill={{ recipientName: customer.name, phone: customer.phone ?? '' }}
          onDone={done}
        />
      )}

      {customer.addresses.length === 0 && mode.kind !== 'adding' && (
        <p className="text-slate-600">{a.empty}</p>
      )}

      <ul className="space-y-3">
        {customer.addresses.map((address) => (
          <li key={address.id}>
            {mode.kind === 'editing' && mode.id === address.id ? (
              <AddressForm
                customerId={customer.id}
                address={address}
                offerDefault={false}
                onDone={done}
              />
            ) : (
              <AddressCard
                address={address}
                actions={
                  archived || mode.kind !== 'idle' ? null : (
                    <>
                      {!address.isDefault && (
                        <button
                          type="button"
                          className={buttonClass.quiet}
                          disabled={makeDefault.isPending}
                          onClick={() => makeDefault.mutate(address.id)}
                        >
                          {makeDefault.isPending && makeDefault.variables === address.id
                            ? strings.common.saving
                            : a.makeDefault}
                        </button>
                      )}
                      <button
                        type="button"
                        className={buttonClass.quiet}
                        onClick={() => setMode({ kind: 'editing', id: address.id })}
                      >
                        {strings.common.edit}
                      </button>
                      <button
                        type="button"
                        className={buttonClass.quiet}
                        onClick={() => {
                          remove.reset();
                          setRemoving(address);
                        }}
                      >
                        {a.remove}
                      </button>
                    </>
                  )
                }
              />
            )}
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={removing !== null}
        title={a.removeDialog.title}
        body={a.removeDialog.body}
        confirmLabel={a.removeDialog.confirm}
        pendingLabel={a.removeDialog.pending}
        pending={remove.isPending}
        error={remove.error ?? undefined}
        onConfirm={() => {
          if (removing !== null) remove.mutate(removing.id);
        }}
        onCancel={() => setRemoving(null)}
      />
    </section>
  );
}

/** One saved address, as it would be written on a parcel. */
function AddressCard({ address, actions }: { address: CustomerAddressView; actions: ReactNode }) {
  const place = [address.city, address.district, address.postalCode]
    .filter((part): part is string => part !== null)
    .join(', ');
  return (
    <article className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">{address.label ?? address.recipientName}</h3>
        {address.isDefault && (
          <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-800">
            {s.addresses.default}
          </span>
        )}
      </div>
      <address className="text-slate-800 not-italic">
        <span className="block">
          {address.recipientName} · {address.phone}
        </span>
        <span className="block">{address.addressLine1}</span>
        {address.addressLine2 !== null && <span className="block">{address.addressLine2}</span>}
        {place !== '' && <span className="block">{place}</span>}
      </address>
      {actions !== null && <div className="-ml-2 flex flex-wrap gap-1">{actions}</div>}
    </article>
  );
}
