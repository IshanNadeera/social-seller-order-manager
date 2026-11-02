import { zodResolver } from '@hookform/resolvers/zod';
import { customerCreateSchema } from '@ssom/shared';
import type { CustomerCreateInput, CustomerCreateRequest, CustomerDetail } from '@ssom/shared';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import type { UseFormRegisterReturn } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import type { z } from 'zod';
import { ApiErrorMessage } from '../../components/ApiErrorMessage';
import {
  CheckboxField,
  FormAlert,
  SubmitButton,
  TextAreaField,
  TextField,
  linkClass,
} from '../../components/form';
import { useApi } from '../../lib/api-context';
import { applyServerFieldErrors, hasServerFieldError } from '../../lib/form-errors';
import { strings } from '../../lib/strings';
import { ADDRESS_FIELDS, AddressFields } from './AddressFields';
import type { AddressFieldName } from './AddressFields';
import { useCustomerSaved } from './api';
import { WithCustomer } from './CustomerDetailPage';
import { customerPaths } from './paths';

const s = strings.customers;
const CUSTOMER_FIELDS = ['name', 'phone', 'email', 'notes'] as const;
const NESTED_ADDRESS_FIELDS = ADDRESS_FIELDS.map((name) => `address.${name}` as const);

/** The customer's own details, without the first address (used when editing). */
const customerEditSchema = customerCreateSchema.omit({ address: true });
type CustomerEditRequest = z.input<typeof customerEditSchema>;
type CustomerEditInput = z.output<typeof customerEditSchema>;

function FormPage({
  title,
  back,
  backLabel,
  children,
}: {
  title: string;
  back: string;
  backLabel: string;
  children: ReactNode;
}) {
  return (
    <section className="max-w-xl space-y-5">
      <p>
        <Link to={back} className={linkClass}>
          {backLabel}
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">{title}</h1>
      {children}
    </section>
  );
}

/** Name, phone, email and notes: the same inputs for adding and editing. */
type CustomerFieldName = (typeof CUSTOMER_FIELDS)[number];

function CustomerFields({
  field,
  errors,
}: {
  field: (name: CustomerFieldName) => UseFormRegisterReturn;
  errors: Partial<Record<CustomerFieldName, string>>;
}) {
  return (
    <>
      <TextField label={s.fields.name} autoComplete="off" error={errors.name} {...field('name')} />
      <TextField
        label={s.fields.phone}
        hint={s.fields.phoneHint}
        type="tel"
        inputMode="tel"
        autoComplete="off"
        error={errors.phone}
        {...field('phone')}
      />
      <TextField
        label={s.fields.email}
        type="email"
        inputMode="email"
        autoComplete="off"
        error={errors.email}
        {...field('email')}
      />
      <TextAreaField
        label={s.fields.notes}
        hint={s.fields.notesHint}
        error={errors.notes}
        {...field('notes')}
      />
    </>
  );
}

/** Message per field name, from React Hook Form's errors object. */
function messages<Name extends string>(
  names: readonly Name[],
  messageOf: (name: Name) => string | undefined,
): Partial<Record<Name, string>> {
  const found: Partial<Record<Name, string>> = {};
  for (const name of names) {
    const message = messageOf(name);
    if (message !== undefined) found[name] = message;
  }
  return found;
}

/** /customers/new (§6.6): the customer, and optionally their first delivery address. */
export function CustomerCreatePage() {
  const api = useApi();
  const navigate = useNavigate();
  const saved = useCustomerSaved();
  const [withAddress, setWithAddress] = useState(false);

  // shouldUnregister: when the address section is closed, its fields leave the form values, so no
  // half-typed address is sent (or validated).
  const form = useForm<CustomerCreateRequest, unknown, CustomerCreateInput>({
    resolver: zodResolver(customerCreateSchema),
    shouldUnregister: true,
    defaultValues: { name: '', phone: '', email: '', notes: '' },
  });
  const { errors } = form.formState;

  // Opening the address section starts it blank, with the customer's name and phone filled in.
  useEffect(() => {
    if (!withAddress) return;
    const { name, phone } = form.getValues();
    for (const field of ADDRESS_FIELDS) form.setValue(`address.${field}`, '');
    form.setValue('address.recipientName', typeof name === 'string' ? name : '');
    form.setValue('address.phone', typeof phone === 'string' ? phone : '');
  }, [withAddress, form]);

  const create = useMutation({
    mutationFn: (input: CustomerCreateInput) => api.post<CustomerDetail>('/customers', input),
    onSuccess: (customer) => {
      saved(customer);
      void navigate(customerPaths.detail(customer.id), { replace: true });
    },
    onError: (error) =>
      applyServerFieldErrors(error, form.setError, [...CUSTOMER_FIELDS, ...NESTED_ADDRESS_FIELDS]),
  });

  const onSubmit = form.handleSubmit((input) => create.mutate(input));
  const showAlert =
    create.isError &&
    !hasServerFieldError(create.error, [...CUSTOMER_FIELDS, ...NESTED_ADDRESS_FIELDS]);

  return (
    <FormPage title={s.create.title} back={customerPaths.list} backLabel={s.detail.back}>
      {showAlert && (
        <FormAlert tone="error">
          <ApiErrorMessage error={create.error} />
        </FormAlert>
      )}
      <form noValidate onSubmit={(event) => void onSubmit(event)} className="space-y-4">
        <CustomerFields
          field={(name) => form.register(name)}
          errors={messages(CUSTOMER_FIELDS, (name) => errors[name]?.message)}
        />
        <CheckboxField
          label={s.create.addAddress}
          checked={withAddress}
          onChange={(event) => setWithAddress(event.target.checked)}
        />
        {withAddress && (
          <fieldset className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
            <legend className="px-1 font-semibold">{s.addresses.newTitle}</legend>
            <AddressFields
              field={(name: AddressFieldName) => form.register(`address.${name}`)}
              errors={messages(ADDRESS_FIELDS, (name) => errors.address?.[name]?.message)}
            />
          </fieldset>
        )}
        <SubmitButton pending={create.isPending} pendingLabel={strings.common.saving}>
          {s.create.submit}
        </SubmitButton>
      </form>
    </FormPage>
  );
}

/** /customers/:customerId/edit (§6.6). Sends only the fields that changed. */
export function CustomerEditPage() {
  const { customerId = '' } = useParams();
  return (
    <WithCustomer id={customerId}>
      {(customer) =>
        customer.archivedAt === null ? (
          <CustomerEditForm customer={customer} />
        ) : (
          <FormPage
            title={s.edit.title}
            back={customerPaths.detail(customer.id)}
            backLabel={s.edit.back}
          >
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {s.detail.archivedBanner}
            </p>
          </FormPage>
        )
      }
    </WithCustomer>
  );
}

function CustomerEditForm({ customer }: { customer: CustomerDetail }) {
  const api = useApi();
  const navigate = useNavigate();
  const saved = useCustomerSaved();
  const detailPath = customerPaths.detail(customer.id);

  const form = useForm<CustomerEditRequest, unknown, CustomerEditInput>({
    resolver: zodResolver(customerEditSchema),
    defaultValues: {
      name: customer.name,
      phone: customer.phone ?? '',
      email: customer.email ?? '',
      notes: customer.notes ?? '',
    },
  });
  const { errors, dirtyFields } = form.formState;

  const update = useMutation({
    // Only the changed fields, already validated and cleaned by the shared schema.
    mutationFn: (changes: Record<string, unknown>) =>
      api.patch<CustomerDetail>(`/customers/${encodeURIComponent(customer.id)}`, changes),
    onSuccess: (updated) => {
      saved(updated);
      void navigate(detailPath, { replace: true });
    },
    onError: (error) => applyServerFieldErrors(error, form.setError, CUSTOMER_FIELDS),
  });

  const onSubmit = form.handleSubmit((input) => {
    const changes = Object.fromEntries(
      CUSTOMER_FIELDS.filter((name) => dirtyFields[name]).map((name) => [name, input[name]]),
    );
    // Nothing changed: go back without a request.
    if (Object.keys(changes).length === 0) {
      void navigate(detailPath);
      return;
    }
    update.mutate(changes);
  });

  return (
    <FormPage title={s.edit.title} back={detailPath} backLabel={s.edit.back}>
      {update.isError && !hasServerFieldError(update.error, CUSTOMER_FIELDS) && (
        <FormAlert tone="error">
          <ApiErrorMessage error={update.error} />
        </FormAlert>
      )}
      <form noValidate onSubmit={(event) => void onSubmit(event)} className="space-y-4">
        <CustomerFields
          field={(name) => form.register(name)}
          errors={messages(CUSTOMER_FIELDS, (name) => errors[name]?.message)}
        />
        <SubmitButton pending={update.isPending} pendingLabel={strings.common.saving}>
          {s.edit.submit}
        </SubmitButton>
      </form>
    </FormPage>
  );
}
