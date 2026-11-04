import { zodResolver } from '@hookform/resolvers/zod';
import { PAYMENT_METHODS, SOURCE_CHANNELS } from '@ssom/shared';
import type { CustomerDetail, CustomerSummary, OrderCreateInput, OrderDetail } from '@ssom/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import type { FieldPath } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
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
import { isApiError } from '../../lib/api-client';
import { useApi } from '../../lib/api-context';
import { formatMoney } from '../../lib/money';
import { strings } from '../../lib/strings';
import {
  useBusinessCurrency,
  useBusinessDefaultDeliveryFee,
  useBusinessId,
} from '../account/use-business';
import { AddressFields } from '../customers/AddressFields';
import type { AddressFieldName } from '../customers/AddressFields';
import { customerKeys } from '../customers/api';
import { orderKeys } from './api';
import { CustomerPicker } from './CustomerPicker';
import { ItemLine } from './ItemLine';
import {
  DELIVERY_FIELDS,
  emptyItem,
  emptyOrderForm,
  formFieldName,
  orderFormSchema,
  previewOrder,
} from './order-form';
import type { OrderDeliveryValues, OrderFormValues } from './order-form';

const f = strings.orders.form;

/** One numbered part of the form (§6.4's field sequence). */
function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
      <legend className="px-1 text-lg font-semibold">{title}</legend>
      {children}
    </fieldset>
  );
}

/**
 * /orders/new (docs/DEVELOPMENT.md §6.4): the order form, in §6.4's order, with a live total. The
 * request is checked with the API's own schema; the server calculates the real totals and the order
 * number. Saving sends an Idempotency-Key (the same one again for an unchanged retry), and a failed
 * save keeps everything the seller typed.
 */
export function OrderCreatePage() {
  const api = useApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const businessId = useBusinessId();
  const currency = useBusinessCurrency();
  const defaultDeliveryFee = useBusinessDefaultDeliveryFee();

  const form = useForm<OrderFormValues, unknown, OrderCreateInput>({
    resolver: zodResolver(orderFormSchema),
    defaultValues: emptyOrderForm(defaultDeliveryFee),
  });
  const lines = useFieldArray({ control: form.control, name: 'items' });
  const values = form.watch();
  const preview = previewOrder(values);
  const { errors, isSubmitted } = form.formState;
  const [customer, setCustomer] = useState<CustomerSummary | null>(null);
  const [addressFailed, setAddressFailed] = useState(false);
  const reviewId = useId();

  const isDelivery = values.fulfilmentType === 'DELIVERY';
  const fromSavedAddress = values.delivery.sourceAddressId !== '';
  const money = (amount: string | null) =>
    amount === null ? strings.common.none : formatMoney(amount, currency);

  /** Fills the delivery details from the customer's default address, unless the seller typed some. */
  const prefillDelivery = (detail: CustomerDetail) => {
    const current = form.getValues('delivery');
    const blank = DELIVERY_FIELDS.every((name) => current[name].trim() === '');
    if (!blank && current.sourceAddressId === '') return;
    const address = detail.addresses.find((saved) => saved.isDefault) ?? detail.addresses[0];
    const next: OrderDeliveryValues =
      address === undefined
        ? {
            ...current,
            recipientName: current.recipientName || detail.name,
            phone: current.phone || (detail.phone ?? ''),
            sourceAddressId: '',
          }
        : {
            recipientName: address.recipientName,
            phone: address.phone,
            addressLine1: address.addressLine1,
            addressLine2: address.addressLine2 ?? '',
            city: address.city ?? '',
            district: address.district ?? '',
            postalCode: address.postalCode ?? '',
            sourceAddressId: address.id,
            saveToCustomer: false,
          };
    form.setValue('delivery', next, { shouldDirty: true, shouldValidate: isSubmitted });
  };

  const chooseCustomer = async (chosen: CustomerSummary) => {
    setCustomer(chosen);
    setAddressFailed(false);
    form.setValue('customerId', chosen.id, { shouldDirty: true, shouldValidate: isSubmitted });
    try {
      const detail = await queryClient.ensureQueryData({
        queryKey: customerKeys.detail(businessId, chosen.id),
        queryFn: ({ signal }) =>
          api.get<CustomerDetail>(`/customers/${encodeURIComponent(chosen.id)}`, { signal }),
      });
      // The seller may have picked someone else meanwhile.
      if (form.getValues('customerId') === chosen.id) prefillDelivery(detail);
    } catch {
      setAddressFailed(true);
    }
  };

  const clearCustomer = () => {
    setCustomer(null);
    setAddressFailed(false);
    form.setValue('customerId', '', { shouldDirty: true });
    // A saved address belongs to that customer; the typed details stay.
    form.setValue('delivery.sourceAddressId', '');
  };

  // The key belongs to one request body: a retry of the same order reuses it, so it can't be saved
  // twice (§9.8); a changed order gets a new one.
  const attempt = useRef<{ body: string; key: string } | null>(null);
  const save = useMutation({
    mutationFn: (input: OrderCreateInput) => {
      const body = JSON.stringify(input);
      if (attempt.current?.body !== body) attempt.current = { body, key: crypto.randomUUID() };
      return api.post<OrderDetail>('/orders', input, { idempotencyKey: attempt.current.key });
    },
    onSuccess: (order) => {
      void queryClient.invalidateQueries({ queryKey: orderKeys.all(businessId) });
      void queryClient.invalidateQueries({ queryKey: customerKeys.all(businessId) });
      void navigate(`/orders/${encodeURIComponent(order.id)}`);
    },
    onError: (error) => {
      if (!isApiError(error)) return;
      for (const [field, message] of Object.entries(error.fieldErrors)) {
        form.setError(formFieldName(field) as FieldPath<OrderFormValues>, {
          type: 'server',
          message,
        });
      }
    },
  });
  const onSubmit = form.handleSubmit((input) => {
    if (!save.isPending) save.mutate(input);
  });

  const addressField = (name: AddressFieldName) =>
    // The order's address has no label (§7.11), so AddressFields is shown without one.
    form.register(`delivery.${name as (typeof DELIVERY_FIELDS)[number]}`, {
      onChange: () => form.setValue('delivery.sourceAddressId', ''),
    });
  const addressErrors = Object.fromEntries(
    DELIVERY_FIELDS.flatMap((name) => {
      const message = errors.delivery?.[name]?.message;
      return message === undefined ? [] : [[name, message]];
    }),
  );

  return (
    <section className="max-w-2xl space-y-5">
      <p>
        <Link to="/orders" className={linkClass}>
          {f.back}
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">{strings.nav.newOrder}</h1>

      <form noValidate onSubmit={(event) => void onSubmit(event)} className="space-y-5">
        {/* 1. Source channel */}
        <Step title={f.steps.source}>
          <SelectField
            label={f.sourceChannel}
            error={errors.sourceChannel?.message}
            {...form.register('sourceChannel', {
              onChange: (event: { target: { value: string } }) => {
                // A walk-in sale without a customer is a pickup (§7.10).
                if (event.target.value === 'WALK_IN' && form.getValues('customerId') === '') {
                  form.setValue('fulfilmentType', 'PICKUP');
                }
              },
            })}
          >
            <option value="">{f.chooseSource}</option>
            {SOURCE_CHANNELS.map((channel) => (
              <option key={channel} value={channel}>
                {strings.sourceChannel[channel]}
              </option>
            ))}
          </SelectField>
          {values.sourceChannel === 'OTHER' && (
            <TextField
              label={f.sourceNote}
              hint={f.sourceNoteHint}
              autoComplete="off"
              error={errors.sourceNote?.message}
              {...form.register('sourceNote')}
            />
          )}
        </Step>

        {/* 2. Customer */}
        <Step title={f.steps.customer}>
          <CustomerPicker
            customer={customer}
            error={errors.customerId?.message}
            onChoose={(chosen) => void chooseCustomer(chosen)}
            onClear={clearCustomer}
          />
          {addressFailed && <p className="text-sm text-amber-800">{f.customer.addressFailed}</p>}
        </Step>

        {/* 3. Fulfilment type */}
        <Step title={f.steps.fulfilment}>
          <div className="flex flex-wrap gap-4">
            {(['DELIVERY', 'PICKUP'] as const).map((type) => (
              <label key={type} className="flex min-h-11 items-center gap-2 font-medium">
                <input
                  type="radio"
                  value={type}
                  className="size-5 accent-blue-700"
                  {...form.register('fulfilmentType')}
                />
                {strings.fulfilmentType[type]}
              </label>
            ))}
          </div>
          {errors.fulfilmentType?.message !== undefined && (
            <p className="text-sm text-red-700">{errors.fulfilmentType.message}</p>
          )}
        </Step>

        {/* 4. Delivery details */}
        {isDelivery && (
          <Step title={f.steps.delivery}>
            {fromSavedAddress && <p className="text-sm text-slate-600">{f.fromSavedAddress}</p>}
            {errors.delivery?.message !== undefined && (
              <p className="text-sm text-red-700">{errors.delivery.message}</p>
            )}
            <AddressFields
              field={addressField}
              errors={addressErrors}
              showLabel={false}
              savedDistrict={values.delivery.district || null}
            />
            {values.customerId !== '' && !fromSavedAddress && (
              <CheckboxField
                label={f.saveToCustomer}
                {...form.register('delivery.saveToCustomer')}
              />
            )}
          </Step>
        )}

        {/* 5. Items */}
        <Step title={f.steps.items}>
          {/* Errors about the list as a whole, e.g. too many items. */}
          {(errors.items?.root?.message ?? errors.items?.message) !== undefined && (
            <p className="text-sm text-red-700">
              {errors.items?.root?.message ?? errors.items?.message}
            </p>
          )}
          {lines.fields.map((line, index) => (
            <ItemLine
              key={line.id}
              form={form}
              index={index}
              currency={currency}
              lineTotal={preview.lineTotals[index] ?? null}
              onRemove={lines.fields.length > 1 ? () => lines.remove(index) : undefined}
            />
          ))}
          <button
            type="button"
            className={buttonClass.secondary}
            onClick={() => lines.append(emptyItem())}
          >
            {f.item.add}
          </button>
        </Step>

        {/* 6–7. Discount and delivery fee */}
        <Step title={f.steps.charges}>
          <TextField
            label={f.discount}
            hint={f.discountHint}
            inputMode="decimal"
            autoComplete="off"
            error={errors.discountAmount?.message}
            {...form.register('discountAmount')}
          />
          {isDelivery && (
            <TextField
              label={f.deliveryFee}
              hint={f.deliveryFeeHint}
              inputMode="decimal"
              autoComplete="off"
              error={errors.deliveryFee?.message}
              {...form.register('deliveryFee')}
            />
          )}
        </Step>

        {/* 8. Payment */}
        <Step title={f.steps.payment}>
          <SelectField
            label={f.paymentMethod}
            error={errors.paymentMethod?.message}
            {...form.register('paymentMethod')}
          >
            <option value="">{f.choosePaymentMethod}</option>
            {PAYMENT_METHODS.map((method) => (
              <option key={method} value={method} disabled={method === 'COD' && !isDelivery}>
                {strings.paymentMethod[method]}
              </option>
            ))}
          </SelectField>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={f.received}
              hint={f.receivedHint}
              inputMode="decimal"
              autoComplete="off"
              error={errors.initialPayment?.amount?.message}
              {...form.register('initialPayment.amount')}
            />
            <SelectField
              label={f.receivedMethod}
              error={errors.initialPayment?.method?.message}
              {...form.register('initialPayment.method')}
            >
              <option value="">{f.receivedMethodSame}</option>
              {PAYMENT_METHODS.filter((method) => method !== 'COD').map((method) => (
                <option key={method} value={method}>
                  {strings.paymentMethod[method]}
                </option>
              ))}
            </SelectField>
          </div>
        </Step>

        {/* 9. Private notes */}
        <Step title={f.steps.notes}>
          <TextAreaField
            label={f.notes}
            hint={f.notesHint}
            error={errors.notes?.message}
            {...form.register('notes')}
          />
        </Step>

        {/* 10. Review summary → Save */}
        <section aria-labelledby={reviewId} className="space-y-4 rounded-xl bg-slate-50 p-4">
          <h2 id={reviewId} className="text-lg font-semibold">
            {f.steps.review}
          </h2>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1" aria-live="polite">
            <dt>{f.summary.subtotal}</dt>
            <dd className="text-right">{money(preview.subtotal)}</dd>
            <dt>{f.summary.discount}</dt>
            <dd className="text-right">{money(preview.discount)}</dd>
            {isDelivery && (
              <>
                <dt>{f.summary.deliveryFee}</dt>
                <dd className="text-right">{money(preview.deliveryFee)}</dd>
              </>
            )}
            <dt className="font-semibold">{f.summary.total}</dt>
            <dd className="text-right font-semibold">{money(preview.total)}</dd>
            <dt>{f.summary.received}</dt>
            <dd className="text-right">{money(preview.received)}</dd>
            <dt className="font-semibold">{f.summary.balance}</dt>
            <dd className="text-right font-semibold">{money(preview.balance)}</dd>
          </dl>
          <p className="text-sm text-slate-600">{f.summary.note}</p>
          {save.isError && (
            <FormAlert tone="error">
              <p className="font-semibold">{f.failed}</p>
              <ApiErrorMessage error={save.error} />
            </FormAlert>
          )}
          <SubmitButton pending={save.isPending} pendingLabel={f.pending}>
            {f.submit}
          </SubmitButton>
        </section>
      </form>
    </section>
  );
}
