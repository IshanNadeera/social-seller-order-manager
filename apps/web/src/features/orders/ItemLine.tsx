// One order line (docs/DEVELOPMENT.md §6.4 step 5): a catalogue product or a one-off item, quantity
// and unit price (pre-filled from the product, editable), with its line total as a preview.
import type { OrderCreateInput, ProductView } from '@ssom/shared';
import { useState } from 'react';
import { useWatch } from 'react-hook-form';
import type { UseFormReturn } from 'react-hook-form';
import { TextField, buttonClass } from '../../components/form';
import { formatMoney } from '../../lib/money';
import { strings } from '../../lib/strings';
import { useProductSearch } from './api';
import { keepEnterFromSubmitting } from './CustomerPicker';
import type { OrderFormValues } from './order-form';
import { QuickProductSheet } from './QuickAddSheets';

const f = strings.orders.form.item;

export function ItemLine({
  form,
  index,
  currency,
  lineTotal,
  onRemove,
}: {
  form: UseFormReturn<OrderFormValues, unknown, OrderCreateInput>;
  index: number;
  currency: string;
  /** The line's total for the preview, or null while it can't be worked out. */
  lineTotal: string | null;
  /** Absent for the only line: an order needs at least one item. */
  onRemove?: () => void;
}) {
  const productId = useWatch({ control: form.control, name: `items.${index}.productId` });
  const name = useWatch({ control: form.control, name: `items.${index}.name` });
  const [adding, setAdding] = useState(false);
  const search = useProductSearch(productId === '' ? name : '');
  const errors = form.formState.errors.items?.[index];
  const revalidate = form.formState.isSubmitted;

  const choose = (product: ProductView) => {
    const options = { shouldDirty: true, shouldValidate: revalidate };
    form.setValue(`items.${index}.productId`, product.id, options);
    form.setValue(`items.${index}.name`, product.name, options);
    form.setValue(`items.${index}.unitPrice`, product.sellingPrice, options);
  };
  const results = productId === '' && name.trim() !== '' ? search.data?.items : undefined;

  return (
    <fieldset className="space-y-3 rounded-xl border border-slate-200 p-4">
      <legend className="px-1 text-sm font-semibold">{f.legend(index + 1)}</legend>
      {productId === '' ? (
        <div className="space-y-2">
          <TextField
            label={f.search}
            hint={f.searchHint}
            autoComplete="off"
            error={errors?.name?.message ?? errors?.productId?.message}
            onKeyDown={keepEnterFromSubmitting}
            {...form.register(`items.${index}.name`)}
          />
          {results !== undefined && results.length > 0 && (
            <ul
              aria-label={f.results}
              className="divide-y divide-slate-200 rounded-lg border border-slate-200"
            >
              {results.map((product) => (
                <li key={product.id}>
                  <button
                    type="button"
                    className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-blue-700"
                    onClick={() => choose(product)}
                  >
                    <span className="font-medium">{product.name}</span>
                    <span className="text-sm text-slate-600">
                      {formatMoney(product.sellingPrice, currency)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className={buttonClass.quiet} onClick={() => setAdding(true)}>
            {f.newProduct}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="font-medium">{f.chosen(name)}</p>
          <button
            type="button"
            className={buttonClass.quiet}
            onClick={() => {
              form.setValue(`items.${index}.productId`, '', { shouldDirty: true });
              form.setValue(`items.${index}.name`, '', { shouldDirty: true });
            }}
          >
            {f.change}
          </button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <TextField
          label={f.quantity}
          inputMode="numeric"
          autoComplete="off"
          error={errors?.quantity?.message}
          {...form.register(`items.${index}.quantity`)}
        />
        <TextField
          label={f.unitPrice}
          inputMode="decimal"
          autoComplete="off"
          error={errors?.unitPrice?.message}
          {...form.register(`items.${index}.unitPrice`)}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-700">
          {f.lineTotal(lineTotal === null ? strings.common.none : formatMoney(lineTotal, currency))}
        </p>
        {onRemove !== undefined && (
          <button type="button" className={buttonClass.quiet} onClick={onRemove}>
            {f.remove}
          </button>
        )}
      </div>
      <QuickProductSheet
        open={adding}
        initialName={name}
        onClose={() => setAdding(false)}
        onCreated={(product) => {
          setAdding(false);
          choose(product);
        }}
      />
    </fieldset>
  );
}
