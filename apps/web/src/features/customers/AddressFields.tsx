import { SRI_LANKA_DISTRICTS, isSriLankaDistrict } from '@ssom/shared';
import type { UseFormRegisterReturn } from 'react-hook-form';
import { SelectField, TextField } from '../../components/form';
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
  savedDistrict = null,
  showLabel = true,
}: {
  field: (name: AddressFieldName) => UseFormRegisterReturn;
  errors: Partial<Record<AddressFieldName, string>>;
  autoFocus?: boolean;
  /** The district already saved on an address being edited (it may predate the fixed list). */
  savedDistrict?: string | null;
  /** Off for an order's copy of an address, which has no label (§7.11). */
  showLabel?: boolean;
}) {
  // A district saved before the fixed list (§7.11) stays selectable, so editing never clears it.
  const legacyDistrict =
    savedDistrict !== null && !isSriLankaDistrict(savedDistrict) ? savedDistrict : null;

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
        <SelectField label={f.district} error={errors.district} {...field('district')}>
          <option value="">{f.chooseDistrict}</option>
          {legacyDistrict !== null && <option value={legacyDistrict}>{legacyDistrict}</option>}
          {SRI_LANKA_DISTRICTS.map((district) => (
            <option key={district} value={district}>
              {strings.district[district]}
            </option>
          ))}
        </SelectField>
        <TextField
          label={f.postalCode}
          autoComplete="off"
          inputMode="numeric"
          error={errors.postalCode}
          {...field('postalCode')}
        />
      </div>
      {showLabel && (
        <TextField
          label={f.label}
          hint={f.labelHint}
          autoComplete="off"
          error={errors.label}
          {...field('label')}
        />
      )}
    </div>
  );
}
