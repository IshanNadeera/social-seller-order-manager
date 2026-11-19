// /settings (docs/DEVELOPMENT.md §6.8): the business profile (owner only), the seller's account
// (change password, sign out of all devices), data export and closure, and the message templates.
// The API validates and scopes every change; the form shows the same rules first.
import { zodResolver } from '@hookform/resolvers/zod';
import { ORDER_PREFIX_PATTERN, businessUpdateSchema, formatOrderNumber } from '@ssom/shared';
import type { BusinessUpdateInput, BusinessUpdateRequest, BusinessView } from '@ssom/shared';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import type { Control, Resolver } from 'react-hook-form';
import { Link } from 'react-router';
import type { z } from 'zod';
import { ApiErrorMessage } from '../../components/ApiErrorMessage';
import {
  FormAlert,
  SelectField,
  SubmitButton,
  TextField,
  buttonClass,
  linkClass,
} from '../../components/form';
import { applyServerFieldErrors, hasServerFieldError } from '../../lib/form-errors';
import { strings } from '../../lib/strings';
import { useMe } from '../account/use-me';
import { useAuth } from '../auth/AuthProvider';
import { authErrorMessage } from '../auth/auth-errors';
import { resetPasswordSchema } from '../auth/schemas';
import type { ResetPasswordForm } from '../auth/schemas';
import { useBusinessProfile, useUpdateBusiness } from './api';

const s = strings.settings;
const FIELDS = ['name', 'contactPhone', 'orderPrefix', 'defaultDeliveryFee', 'timezone'] as const;

/** Every time zone the browser knows, with the business's own first if it is missing. */
function timeZones(current: string): string[] {
  const known =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return known.includes(current) ? known : [current, ...known];
}

export function SettingsPage() {
  return (
    <section className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">{s.title}</h1>
      <BusinessSettings />
      <Card title={s.password.title}>
        <ChangePassword />
      </Card>
      <Card title={s.signOutAll.title}>
        <SignOutEverywhere />
      </Card>
      <Card title={s.data.title}>
        <p className="text-slate-700">{s.data.exportBody}</p>
        <Link to="/orders" className={linkClass}>
          {s.data.exportLink}
        </Link>
        <h3 className="pt-2 font-semibold">{s.data.closureTitle}</h3>
        <p className="text-slate-700">{s.data.closureBody}</p>
      </Card>
      <Card title={s.templates.title}>
        <p className="text-slate-700">{s.templates.body}</p>
        <ul className="list-disc space-y-1 pl-6 text-slate-700">
          {Object.values(strings.orders.messages.titles).map((title) => (
            <li key={title}>{title}</li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

/** One section, named by its heading. */
function Card({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="space-y-3 rounded-xl border border-slate-200 bg-white p-4"
    >
      <h2 id={headingId} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function BusinessSettings() {
  const profile = useBusinessProfile();
  return (
    <Card title={s.business.title}>
      {profile.data !== undefined ? (
        <BusinessForm key={profile.data.id} business={profile.data} />
      ) : profile.isError ? (
        <div className="space-y-3">
          <FormAlert tone="error">
            <p className="font-semibold">{s.loadFailed}</p>
            <ApiErrorMessage error={profile.error} />
          </FormAlert>
          <button
            type="button"
            className={buttonClass.secondary}
            onClick={() => void profile.refetch()}
          >
            {strings.common.retry}
          </button>
        </div>
      ) : (
        <p role="status" className="text-slate-600">
          {strings.common.loading}
        </p>
      )}
    </Card>
  );
}

type BusinessFormValues = Required<{ [Key in keyof BusinessUpdateRequest]: string }>;

function BusinessForm({ business }: { business: BusinessView }) {
  const isOwner = useMe().data?.role === 'OWNER';
  const update = useUpdateBusiness();
  const form = useForm<BusinessFormValues, unknown, BusinessUpdateInput>({
    resolver: zodResolver(businessUpdateSchema) as Resolver<
      BusinessFormValues,
      unknown,
      BusinessUpdateInput
    >,
    defaultValues: {
      name: business.name,
      contactPhone: business.contactPhone ?? '',
      orderPrefix: business.orderPrefix,
      defaultDeliveryFee: business.defaultDeliveryFee,
      timezone: business.timezone,
    },
  });
  const [saved, setSaved] = useState(false);
  const { errors } = form.formState;
  const b = s.business;

  const onSubmit = form.handleSubmit((input) => {
    setSaved(false);
    update.mutate(input, {
      onSuccess: () => setSaved(true),
      onError: (error) => applyServerFieldErrors(error, form.setError, FIELDS),
    });
  });

  return (
    <form noValidate className="space-y-4" onSubmit={(event) => void onSubmit(event)}>
      {!isOwner && (
        <p className="rounded-lg bg-slate-100 px-3 py-2 text-slate-700">{b.ownerOnly}</p>
      )}
      {update.isError && !hasServerFieldError(update.error, FIELDS) && (
        <FormAlert tone="error">
          <p className="font-semibold">{b.saveFailed}</p>
          <ApiErrorMessage error={update.error} />
        </FormAlert>
      )}
      <fieldset disabled={!isOwner || update.isPending} className="space-y-4">
        <TextField
          label={b.name}
          autoComplete="organization"
          error={errors.name?.message}
          {...form.register('name')}
        />
        <TextField
          label={b.contactPhone}
          hint={b.contactPhoneHint}
          type="tel"
          autoComplete="tel"
          error={errors.contactPhone?.message}
          {...form.register('contactPhone')}
        />
        <TextField
          label={b.orderPrefix}
          hint={b.orderPrefixHint}
          autoComplete="off"
          autoCapitalize="characters"
          error={errors.orderPrefix?.message}
          {...form.register('orderPrefix')}
        />
        <PrefixPreview control={form.control} next={business.nextOrderSequence} />
        <TextField
          label={b.defaultDeliveryFee}
          hint={b.defaultDeliveryFeeHint}
          inputMode="decimal"
          error={errors.defaultDeliveryFee?.message}
          {...form.register('defaultDeliveryFee')}
        />
        <SelectField
          label={b.timezone}
          hint={b.timezoneHint}
          error={errors.timezone?.message}
          {...form.register('timezone')}
        >
          {timeZones(business.timezone).map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </SelectField>
        <p className="text-sm text-slate-700">
          <span className="font-medium">{b.currency}: </span>
          {b.currencyNote(business.currency)}
        </p>
        {isOwner && (
          <SubmitButton pending={update.isPending} pendingLabel={b.saving}>
            {b.save}
          </SubmitButton>
        )}
      </fieldset>
      <p role="status" className="text-sm text-green-800">
        {saved ? b.saved : ''}
      </p>
    </form>
  );
}

/** The next order number with the prefix being typed (§6.8: a preview such as NIM-0042). */
function PrefixPreview({
  control,
  next,
}: {
  control: Control<BusinessFormValues, unknown, BusinessUpdateInput>;
  next: number;
}) {
  const prefix = (useWatch({ control, name: 'orderPrefix' }) ?? '').trim().toUpperCase();
  const valid = ORDER_PREFIX_PATTERN.test(prefix);
  // Stays in the page so screen readers announce each change; empty while the prefix is invalid.
  return (
    <p
      aria-live="polite"
      data-testid="prefix-preview"
      className={valid ? 'rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700' : 'sr-only'}
    >
      {valid ? s.business.prefixPreview(formatOrderNumber(prefix, next)) : ''}
    </p>
  );
}

/** A new password, through Supabase Auth (the API has no password endpoints, §9.1). */
function ChangePassword() {
  const { client } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const form = useForm<ResetPasswordForm, unknown, z.output<typeof resetPasswordSchema>>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '', confirmPassword: '' },
  });
  const { errors, isSubmitting } = form.formState;
  const f = strings.auth.fields;

  const onSubmit = form.handleSubmit(async ({ password }) => {
    setError(null);
    setChanged(false);
    try {
      const { error: authError } = await client.updateUser({ password });
      if (authError) {
        setError(authErrorMessage(authError));
        return;
      }
      form.reset();
      setChanged(true);
    } catch (thrown) {
      setError(authErrorMessage(thrown));
    }
  });

  return (
    <form noValidate className="space-y-4" onSubmit={(event) => void onSubmit(event)}>
      {error !== null && <FormAlert tone="error">{error}</FormAlert>}
      <TextField
        label={f.newPassword}
        type="password"
        autoComplete="new-password"
        hint={f.passwordHint}
        error={errors.password?.message}
        {...form.register('password')}
      />
      <TextField
        label={f.confirmPassword}
        type="password"
        autoComplete="new-password"
        error={errors.confirmPassword?.message}
        {...form.register('confirmPassword')}
      />
      <SubmitButton pending={isSubmitting} pendingLabel={s.password.saving}>
        {s.password.save}
      </SubmitButton>
      <p role="status" className="text-sm text-green-800">
        {changed ? s.password.changed : ''}
      </p>
    </form>
  );
}

/**
 * Revokes every session of this user (Supabase "global" sign-out), this device's included. The
 * auth state change then sends the seller to the login page, like an ordinary log out.
 */
function SignOutEverywhere() {
  const { client } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const o = s.signOutAll;

  const signOut = async () => {
    setPending(true);
    setFailed(false);
    try {
      const { error } = await client.signOut({ scope: 'global' });
      if (error) setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-slate-700">{o.body}</p>
      {failed && <FormAlert tone="error">{o.failed}</FormAlert>}
      {confirming ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={buttonClass.danger}
            disabled={pending}
            aria-busy={pending || undefined}
            onClick={() => void signOut()}
          >
            {pending ? o.pending : o.confirm}
          </button>
          <button
            type="button"
            className={buttonClass.secondary}
            disabled={pending}
            onClick={() => setConfirming(false)}
          >
            {o.cancel}
          </button>
        </div>
      ) : (
        <button type="button" className={buttonClass.secondary} onClick={() => setConfirming(true)}>
          {o.start}
        </button>
      )}
    </div>
  );
}
