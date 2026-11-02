import { zodResolver } from '@hookform/resolvers/zod';
import { addressCreateSchema } from '@ssom/shared';
import type {
  AddressCreateInput,
  AddressCreateRequest,
  CustomerAddressView,
  CustomerDetail,
} from '@ssom/shared';
import { useMutation } from '@tanstack/react-query';
import { useId } from 'react';
import { useForm } from 'react-hook-form';
import { ApiErrorMessage } from '../../components/ApiErrorMessage';
import { CheckboxField, FormAlert, SubmitButton, buttonClass } from '../../components/form';
import { useApi } from '../../lib/api-context';
import { applyServerFieldErrors, hasServerFieldError } from '../../lib/form-errors';
import { strings } from '../../lib/strings';
import { ADDRESS_FIELDS, AddressFields } from './AddressFields';
import type { AddressFieldName } from './AddressFields';
import { useCustomerSaved } from './api';

const s = strings.customers.addresses;

/** Form values for an address being edited: the saved values, with blanks for empty optionals. */
function toFormValues(address: CustomerAddressView): AddressCreateRequest {
  return {
    recipientName: address.recipientName,
    phone: address.phone,
    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2 ?? '',
    city: address.city ?? '',
    district: address.district ?? '',
    postalCode: address.postalCode ?? '',
    label: address.label ?? '',
  };
}

const EMPTY: AddressCreateRequest = {
  recipientName: '',
  phone: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  district: '',
  postalCode: '',
  label: '',
};

/**
 * Adds an address to a customer, or edits one (§9.2). Validated with the API's own schema. An edit
 * sends only the fields that changed (and nothing at all if none did). The API answers with the
 * whole customer, which replaces the cached one, so the list of addresses and the default update.
 */
export function AddressForm({
  customerId,
  address,
  offerDefault,
  prefill,
  onDone,
}: {
  customerId: string;
  /** The address to edit; absent to add a new one. */
  address?: CustomerAddressView;
  /** Show "Use as the default address" (only when adding to a customer who has addresses). */
  offerDefault: boolean;
  /** Starting values for a new address, e.g. the customer's name and phone. */
  prefill?: Partial<Pick<AddressCreateRequest, 'recipientName' | 'phone'>>;
  onDone: () => void;
}) {
  const api = useApi();
  const saved = useCustomerSaved();
  const headingId = useId();
  const editing = address !== undefined;
  const base = `/customers/${encodeURIComponent(customerId)}/addresses`;

  const form = useForm<AddressCreateRequest, unknown, AddressCreateInput>({
    resolver: zodResolver(addressCreateSchema),
    defaultValues:
      address === undefined ? { ...EMPTY, ...prefill, isDefault: false } : toFormValues(address),
  });
  const { errors, dirtyFields } = form.formState;

  const save = useMutation({
    mutationFn: (input: AddressCreateInput) => {
      const addressId = address?.id;
      if (addressId === undefined) return api.post<CustomerDetail>(base, input);
      const changes = Object.fromEntries(
        ADDRESS_FIELDS.filter((name) => dirtyFields[name]).map((name) => [name, input[name]]),
      );
      return api.patch<CustomerDetail>(`${base}/${encodeURIComponent(addressId)}`, changes);
    },
    onSuccess: (customer) => {
      saved(customer);
      onDone();
    },
    onError: (error) => applyServerFieldErrors(error, form.setError, ADDRESS_FIELDS),
  });

  const onSubmit = form.handleSubmit((input) => {
    // Nothing changed: there is nothing to save.
    if (editing && !ADDRESS_FIELDS.some((name) => dirtyFields[name])) {
      onDone();
      return;
    }
    save.mutate(input);
  });

  const fieldErrors: Partial<Record<AddressFieldName, string>> = Object.fromEntries(
    ADDRESS_FIELDS.flatMap((name) => {
      const message = errors[name]?.message;
      return message === undefined ? [] : [[name, message]];
    }),
  );

  return (
    <section
      aria-labelledby={headingId}
      className="space-y-4 rounded-xl border border-blue-200 bg-white p-4"
    >
      <h3 id={headingId} className="font-semibold">
        {editing ? s.editTitle : s.newTitle}
      </h3>
      {save.isError && !hasServerFieldError(save.error, ADDRESS_FIELDS) && (
        <FormAlert tone="error">
          <ApiErrorMessage error={save.error} />
        </FormAlert>
      )}
      <form noValidate onSubmit={(event) => void onSubmit(event)} className="space-y-4">
        <AddressFields
          field={(name) => form.register(name)}
          errors={fieldErrors}
          autoFocus
          savedDistrict={address?.district ?? null}
        />
        {!editing && offerDefault && (
          <CheckboxField label={s.fields.isDefault} {...form.register('isDefault')} />
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            className={buttonClass.secondary}
            onClick={onDone}
            disabled={save.isPending}
          >
            {strings.common.cancel}
          </button>
          <div className="sm:w-48">
            <SubmitButton pending={save.isPending} pendingLabel={strings.common.saving}>
              {editing ? s.submitEdit : s.submitNew}
            </SubmitButton>
          </div>
        </div>
      </form>
    </section>
  );
}
