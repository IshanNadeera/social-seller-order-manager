import { zodResolver } from '@hookform/resolvers/zod';
import { productCreateSchema } from '@ssom/shared';
import type { ProductCreateInput, ProductCreateRequest, ProductView } from '@ssom/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import type { UseFormRegisterReturn } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import { ApiErrorMessage } from '../../components/ApiErrorMessage';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import {
  FormAlert,
  SubmitButton,
  TextAreaField,
  TextField,
  buttonClass,
  linkClass,
} from '../../components/form';
import { isApiError } from '../../lib/api-client';
import { useApi } from '../../lib/api-context';
import { applyServerFieldErrors, hasServerFieldError } from '../../lib/form-errors';
import { formatMoney } from '../../lib/money';
import { strings } from '../../lib/strings';
import { useBusinessCurrency } from '../account/use-business';
import { useProduct, useProductSaved } from './api';
import { productPaths } from './paths';

const s = strings.products;
/** Everything a product has (§6.7). No stock or inventory fields in the MVP. */
const PRODUCT_FIELDS = ['name', 'sku', 'sellingPrice', 'description'] as const;
type ProductFieldName = (typeof PRODUCT_FIELDS)[number];

function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="max-w-xl space-y-5">
      <p>
        <Link to={productPaths.list} className={linkClass}>
          {s.edit.back}
        </Link>
      </p>
      <h1 className="text-2xl font-semibold break-words">{title}</h1>
      {children}
    </section>
  );
}

/**
 * The product inputs. The price is a text input (decimal keypad on phones) holding a string such as
 * "1500.50": money is never a JavaScript number (§7.5). The shared moneySchema checks it.
 */
function ProductFields({
  field,
  errors,
}: {
  field: (name: ProductFieldName) => UseFormRegisterReturn;
  errors: Partial<Record<ProductFieldName, string>>;
}) {
  const currency = useBusinessCurrency();
  return (
    <>
      <TextField label={s.fields.name} autoComplete="off" error={errors.name} {...field('name')} />
      <TextField
        label={s.fields.sellingPrice}
        hint={s.fields.sellingPriceHint(currency)}
        inputMode="decimal"
        autoComplete="off"
        error={errors.sellingPrice}
        {...field('sellingPrice')}
      />
      <TextField
        label={s.fields.sku}
        hint={s.fields.skuHint}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        error={errors.sku}
        {...field('sku')}
      />
      <TextAreaField
        label={s.fields.description}
        error={errors.description}
        {...field('description')}
      />
    </>
  );
}

function useProductForm(defaultValues: ProductCreateRequest) {
  const form = useForm<ProductCreateRequest, unknown, ProductCreateInput>({
    resolver: zodResolver(productCreateSchema),
    defaultValues,
  });
  const { errors } = form.formState;
  const fieldErrors: Partial<Record<ProductFieldName, string>> = {};
  for (const name of PRODUCT_FIELDS) {
    const message = errors[name]?.message;
    if (message !== undefined) fieldErrors[name] = message;
  }
  return { form, fieldErrors };
}

/** /products/new (§6.7). */
export function ProductCreatePage() {
  const api = useApi();
  const navigate = useNavigate();
  const saved = useProductSaved();
  const { form, fieldErrors } = useProductForm({
    name: '',
    sku: '',
    sellingPrice: '',
    description: '',
  });

  const create = useMutation({
    mutationFn: (input: ProductCreateInput) => api.post<ProductView>('/products', input),
    onSuccess: (product) => {
      saved(product);
      void navigate(productPaths.list);
    },
    // A clash on the SKU (409 SKU_TAKEN) comes back as a field error on `sku`.
    onError: (error) => applyServerFieldErrors(error, form.setError, PRODUCT_FIELDS),
  });

  const onSubmit = form.handleSubmit((input) => create.mutate(input));

  return (
    <Page title={s.create.title}>
      {create.isError && !hasServerFieldError(create.error, PRODUCT_FIELDS) && (
        <FormAlert tone="error">
          <ApiErrorMessage error={create.error} />
        </FormAlert>
      )}
      <form noValidate onSubmit={(event) => void onSubmit(event)} className="space-y-4">
        <ProductFields field={(name) => form.register(name)} errors={fieldErrors} />
        <SubmitButton pending={create.isPending} pendingLabel={strings.common.saving}>
          {s.create.submit}
        </SubmitButton>
      </form>
    </Page>
  );
}

/** /products/:productId (§6.7): edit, or archive. An archived product is shown read-only. */
export function ProductEditPage() {
  const { productId = '' } = useParams();
  const query = useProduct(productId);

  if (query.data !== undefined) {
    return query.data.archivedAt === null ? (
      <ProductEditForm product={query.data} />
    ) : (
      <ArchivedProduct product={query.data} />
    );
  }
  if (query.isPending) {
    return (
      <p role="status" className="text-slate-600">
        {strings.common.loading}
      </p>
    );
  }
  if (isApiError(query.error) && query.error.status === 404) {
    return (
      <Page title={s.edit.notFoundTitle}>
        <p className="text-slate-700">{s.edit.notFoundBody}</p>
      </Page>
    );
  }
  return (
    <section className="space-y-3">
      <FormAlert tone="error">
        <p className="font-semibold">{s.edit.loadFailed}</p>
        <ApiErrorMessage error={query.error} />
      </FormAlert>
      <button type="button" className={buttonClass.secondary} onClick={() => void query.refetch()}>
        {strings.common.retry}
      </button>
    </section>
  );
}

function ProductEditForm({ product }: { product: ProductView }) {
  const api = useApi();
  const navigate = useNavigate();
  const saved = useProductSaved();
  const [confirming, setConfirming] = useState(false);
  const path = `/products/${encodeURIComponent(product.id)}`;
  const { form, fieldErrors } = useProductForm({
    name: product.name,
    sku: product.sku ?? '',
    sellingPrice: product.sellingPrice,
    description: product.description ?? '',
  });
  const { dirtyFields } = form.formState;

  const update = useMutation({
    // Only the changed fields, already validated and cleaned by the shared schema.
    mutationFn: (changes: Record<string, unknown>) => api.patch<ProductView>(path, changes),
    onSuccess: (updated) => {
      saved(updated);
      void navigate(productPaths.list);
    },
    onError: (error) => applyServerFieldErrors(error, form.setError, PRODUCT_FIELDS),
  });

  const archive = useMutation({
    mutationFn: () => api.post<ProductView>(`${path}/archive`, undefined),
    onSuccess: (archived) => {
      saved(archived);
      setConfirming(false);
    },
  });

  const onSubmit = form.handleSubmit((input) => {
    const changes = Object.fromEntries(
      PRODUCT_FIELDS.filter((name) => dirtyFields[name]).map((name) => [name, input[name]]),
    );
    // Nothing changed: go back without a request.
    if (Object.keys(changes).length === 0) {
      void navigate(productPaths.list);
      return;
    }
    update.mutate(changes);
  });

  return (
    <Page title={s.edit.title}>
      {update.isError && !hasServerFieldError(update.error, PRODUCT_FIELDS) && (
        <FormAlert tone="error">
          <ApiErrorMessage error={update.error} />
        </FormAlert>
      )}
      <form noValidate onSubmit={(event) => void onSubmit(event)} className="space-y-4">
        <ProductFields field={(name) => form.register(name)} errors={fieldErrors} />
        <SubmitButton pending={update.isPending} pendingLabel={strings.common.saving}>
          {s.edit.submit}
        </SubmitButton>
      </form>

      <div className="border-t border-slate-200 pt-5">
        <button
          type="button"
          className={buttonClass.secondary}
          onClick={() => {
            archive.reset();
            setConfirming(true);
          }}
        >
          {s.edit.archive}
        </button>
      </div>

      <ConfirmDialog
        open={confirming}
        title={s.archiveDialog.title(product.name)}
        body={s.archiveDialog.body}
        confirmLabel={s.archiveDialog.confirm}
        pendingLabel={s.archiveDialog.pending}
        pending={archive.isPending}
        error={archive.error ?? undefined}
        onConfirm={() => archive.mutate()}
        onCancel={() => setConfirming(false)}
      />
    </Page>
  );
}

/** Read-only: the API refuses changes to an archived product (422 PRODUCT_ARCHIVED). */
function ArchivedProduct({ product }: { product: ProductView }) {
  const currency = useBusinessCurrency();
  const none = strings.common.none;
  return (
    <Page title={product.name}>
      <p className="w-fit rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
        {s.edit.archivedBadge}
      </p>
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        {s.edit.archivedBanner}
      </p>
      <dl className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <div>
          <dt className="text-sm font-medium text-slate-600">{s.list.columns.price}</dt>
          <dd className="mt-0.5 tabular-nums">{formatMoney(product.sellingPrice, currency)}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-slate-600">{s.list.columns.sku}</dt>
          <dd className="mt-0.5">{product.sku ?? none}</dd>
        </div>
        {product.description !== null && (
          <div className="sm:col-span-2">
            <dt className="text-sm font-medium text-slate-600">{s.fields.description}</dt>
            <dd className="mt-0.5 whitespace-pre-line">{product.description}</dd>
          </div>
        )}
      </dl>
    </Page>
  );
}
