// Quick-add a customer or a product without leaving the order (docs/DEVELOPMENT.md §6.4). Each
// opens in a Sheet over the order form, which stays mounted, so what the seller typed is kept.
import { zodResolver } from '@hookform/resolvers/zod';
import { customerCreateSchema, productCreateSchema } from '@ssom/shared';
import type { CustomerDetail, ProductView } from '@ssom/shared';
import { useMutation } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { ApiErrorMessage } from '../../components/ApiErrorMessage';
import { FormAlert, SubmitButton, TextField } from '../../components/form';
import { Sheet, stopSubmit } from '../../components/Sheet';
import { useApi } from '../../lib/api-context';
import { applyServerFieldErrors, hasServerFieldError } from '../../lib/form-errors';
import { strings } from '../../lib/strings';
import { useBusinessCurrency } from '../account/use-business';
import { useCustomerSaved } from '../customers/api';
import { useProductSaved } from '../products/api';

const quickCustomerSchema = customerCreateSchema.pick({ name: true, phone: true });
type QuickCustomerRequest = z.input<typeof quickCustomerSchema>;
type QuickCustomerInput = z.output<typeof quickCustomerSchema>;
const CUSTOMER_FIELDS = ['name', 'phone'] as const;

/** Name and phone are enough to start an order (§6.4); the rest can be added later. */
export function QuickCustomerSheet({
  open,
  initialName,
  onClose,
  onCreated,
}: {
  open: boolean;
  /** What the seller had typed into the customer search. */
  initialName: string;
  onClose: () => void;
  onCreated: (customer: CustomerDetail) => void;
}) {
  const api = useApi();
  const saved = useCustomerSaved();
  const s = strings.orders.quickCustomer;
  const form = useForm<QuickCustomerRequest, unknown, QuickCustomerInput>({
    resolver: zodResolver(quickCustomerSchema),
    defaultValues: { name: '', phone: '' },
  });
  const { reset } = form;
  const save = useMutation({
    mutationFn: (input: QuickCustomerInput) => api.post<CustomerDetail>('/customers', input),
    onSuccess: (customer) => {
      saved(customer);
      onCreated(customer);
    },
    onError: (error) => applyServerFieldErrors(error, form.setError, CUSTOMER_FIELDS),
  });
  const { reset: resetSave } = save;

  // Each opening starts afresh, with the searched-for text as the name.
  useEffect(() => {
    if (!open) return;
    reset({ name: initialName.trim(), phone: '' });
    resetSave();
  }, [open, initialName, reset, resetSave]);

  const { errors } = form.formState;
  return (
    <Sheet open={open} title={s.title} busy={save.isPending} onClose={onClose}>
      {save.isError && !hasServerFieldError(save.error, CUSTOMER_FIELDS) && (
        <FormAlert tone="error">
          <ApiErrorMessage error={save.error} />
        </FormAlert>
      )}
      <form
        noValidate
        onSubmit={stopSubmit(form.handleSubmit((input) => save.mutate(input)))}
        className="space-y-4"
      >
        <TextField
          label={s.name}
          autoComplete="off"
          error={errors.name?.message}
          {...form.register('name')}
        />
        <TextField
          label={s.phone}
          hint={strings.customers.fields.phoneHint}
          type="tel"
          inputMode="tel"
          autoComplete="off"
          error={errors.phone?.message}
          {...form.register('phone')}
        />
        <SubmitButton pending={save.isPending} pendingLabel={s.pending}>
          {s.submit}
        </SubmitButton>
      </form>
    </Sheet>
  );
}

const quickProductSchema = productCreateSchema.pick({ name: true, sellingPrice: true });
type QuickProductRequest = z.input<typeof quickProductSchema>;
type QuickProductInput = z.output<typeof quickProductSchema>;
const PRODUCT_FIELDS = ['name', 'sellingPrice'] as const;

/** Adds a product to the catalogue and puts it on the order line it was opened from. */
export function QuickProductSheet({
  open,
  initialName,
  onClose,
  onCreated,
}: {
  open: boolean;
  /** What the seller had typed as the item name. */
  initialName: string;
  onClose: () => void;
  onCreated: (product: ProductView) => void;
}) {
  const api = useApi();
  const saved = useProductSaved();
  const currency = useBusinessCurrency();
  const s = strings.orders.quickProduct;
  const form = useForm<QuickProductRequest, unknown, QuickProductInput>({
    resolver: zodResolver(quickProductSchema),
    defaultValues: { name: '', sellingPrice: '' },
  });
  const { reset } = form;
  const save = useMutation({
    mutationFn: (input: QuickProductInput) => api.post<ProductView>('/products', input),
    onSuccess: (product) => {
      saved(product);
      onCreated(product);
    },
    onError: (error) => applyServerFieldErrors(error, form.setError, PRODUCT_FIELDS),
  });
  const { reset: resetSave } = save;

  useEffect(() => {
    if (!open) return;
    reset({ name: initialName.trim(), sellingPrice: '' });
    resetSave();
  }, [open, initialName, reset, resetSave]);

  const { errors } = form.formState;
  return (
    <Sheet open={open} title={s.title} busy={save.isPending} onClose={onClose}>
      {save.isError && !hasServerFieldError(save.error, PRODUCT_FIELDS) && (
        <FormAlert tone="error">
          <ApiErrorMessage error={save.error} />
        </FormAlert>
      )}
      <form
        noValidate
        onSubmit={stopSubmit(form.handleSubmit((input) => save.mutate(input)))}
        className="space-y-4"
      >
        <TextField
          label={s.name}
          autoComplete="off"
          error={errors.name?.message}
          {...form.register('name')}
        />
        <TextField
          label={s.price}
          hint={strings.products.fields.sellingPriceHint(currency)}
          inputMode="decimal"
          autoComplete="off"
          error={errors.sellingPrice?.message}
          {...form.register('sellingPrice')}
        />
        <SubmitButton pending={save.isPending} pendingLabel={s.pending}>
          {s.submit}
        </SubmitButton>
      </form>
    </Sheet>
  );
}
