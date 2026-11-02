import type { UseFormRegisterReturn } from 'react-hook-form';
import { TextField } from '../../components/form';
import { strings } from '../../lib/strings';

const f = strings.customers.addresses.fields;

/** The fields of a delivery address, in the order sellers read them off a message (§6.4, §7.11). */
export const ADDRESS_FIELDS = [
  'recipientName',
  'phone',
  'addressLine1',
  'addressLine2',
  'city',
  'district',
  'postalCode',
  'label',
] as const;

export type AddressFieldName = (typeof ADDRESS_FIELDS)[number];

/**
 * The address inputs, for any form that holds an address (the address form, and "Add customer" with
 * a first address). Browser autofill is off: these are the customer's details, not the seller's.
 */
export function AddressFields({
  field,
  errors,
  autoFocus = false,
}: {
  field: (name: AddressFieldName) => UseFormRegisterReturn;
  errors: Partial<Record<AddressFieldName, string>>;
  autoFocus?: boolean;
}) {
  return (
    <div className="space-y-4">
      <TextField
        label={f.recipientName}
        autoComplete="off"
        autoFocus={autoFocus}
        error={errors.recipientName}
        {...field('recipientName')}
      />
      <TextField
        label={f.phone}
        type="tel"
        inputMode="tel"
        autoComplete="off"
        error={errors.phone}
        {...field('phone')}
      />
      <TextField
        label={f.addressLine1}
        autoComplete="off"
        error={errors.addressLine1}
        {...field('addressLine1')}
      />
      <TextField
        label={f.addressLine2}
        autoComplete="off"
        error={errors.addressLine2}
        {...field('addressLine2')}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField label={f.city} autoComplete="off" error={errors.city} {...field('city')} />
        <TextField
          label={f.district}
          autoComplete="off"
          error={errors.district}
          {...field('district')}
        />
        <TextField
          label={f.postalCode}
          autoComplete="off"
          inputMode="numeric"
          error={errors.postalCode}
          {...field('postalCode')}
        />
      </div>
      <TextField
        label={f.label}
        hint={f.labelHint}
        autoComplete="off"
        error={errors.label}
        {...field('label')}
      />
    </div>
  );
}
