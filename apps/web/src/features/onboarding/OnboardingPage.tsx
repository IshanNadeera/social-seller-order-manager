import { zodResolver } from '@hookform/resolvers/zod';
import {
  DEFAULT_ORDER_PREFIX,
  ORDER_PREFIX_PATTERN,
  formatOrderNumber,
  onboardingRequestSchema,
  suggestOrderPrefix,
} from '@ssom/shared';
import type { MeResponse, OnboardingInput, OnboardingRequest } from '@ssom/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import type { Control } from 'react-hook-form';
import { Navigate, useNavigate } from 'react-router';
import { ApiErrorMessage } from '../../components/ApiErrorMessage';
import { FormAlert, SubmitButton, TextField } from '../../components/form';
import { isApiError } from '../../lib/api-client';
import { useApi } from '../../lib/api-context';
import { strings } from '../../lib/strings';
import { WithMe } from '../account/AccountGate';
import { meQueryKey } from '../account/use-me';
import { useAuth } from '../auth/AuthProvider';
import { LogOutButton } from '../auth/LogOutButton';
import { HOME_PATH } from '../auth/redirect';

const s = strings.onboarding;
const FIELDS = ['businessName', 'contactPhone', 'orderPrefix'] as const;

/**
 * First screen after sign-up (US-001, §6.8, §9.1): creates the seller's business. Someone who
 * already has one is sent straight to the dashboard.
 */
export function OnboardingPage() {
  return (
    <WithMe>
      {(me) => (me.needsOnboarding ? <OnboardingForm /> : <Navigate to={HOME_PATH} replace />)}
    </WithMe>
  );
}

/** What the API expects: the phone is left out when empty (the schema maps "" to "no phone"). */
export function toOnboardingRequest(input: OnboardingInput): OnboardingRequest {
  return {
    businessName: input.businessName,
    orderPrefix: input.orderPrefix,
    ...(input.contactPhone === null ? {} : { contactPhone: input.contactPhone }),
  };
}

/** True when the API blamed one of this form's fields (shown next to it instead of in the alert). */
function hasFieldError(error: unknown): boolean {
  if (!isApiError(error)) return false;
  const { fieldErrors } = error;
  return FIELDS.some((field) => fieldErrors[field] !== undefined);
}

function OnboardingForm() {
  const api = useApi();
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // The prefix follows the business name until the seller edits it themselves.
  const prefixEdited = useRef(false);

  // Same schema and messages as the API (packages/shared), so both sides agree on every rule.
  const form = useForm<OnboardingRequest, unknown, OnboardingInput>({
    resolver: zodResolver(onboardingRequestSchema),
    defaultValues: { businessName: '', contactPhone: '', orderPrefix: DEFAULT_ORDER_PREFIX },
  });
  const { errors } = form.formState;

  const onboarding = useMutation({
    mutationFn: (body: OnboardingRequest) => api.post<MeResponse>('/onboarding', body),
    onSuccess: (me) => {
      // The response is the new GET /me, so the dashboard opens without another request.
      queryClient.setQueryData(meQueryKey(session?.user.id), me);
      void navigate(HOME_PATH, { replace: true });
    },
    onError: (error) => {
      if (!isApiError(error)) return;
      for (const field of FIELDS) {
        const message = error.fieldErrors[field];
        if (message !== undefined) form.setError(field, { type: 'server', message });
      }
    },
  });

  // Field errors are shown next to their fields; anything else goes in the alert.
  const showAlert = onboarding.isError && !hasFieldError(onboarding.error);

  const onSubmit = form.handleSubmit((input) => {
    onboarding.mutate(toOnboardingRequest(input));
  });

  const nameField = form.register('businessName', {
    onChange: (event: { target: { value: string } }) => {
      if (!prefixEdited.current) {
        form.setValue('orderPrefix', suggestOrderPrefix(event.target.value), {
          shouldValidate: form.formState.isSubmitted,
        });
      }
    },
  });
  const prefixField = form.register('orderPrefix', {
    onChange: () => {
      prefixEdited.current = true;
    },
  });

  return (
    <div className="min-h-dvh bg-slate-50 px-4 py-10 text-slate-900">
      <div className="mx-auto w-full max-w-md space-y-6">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm font-semibold tracking-wide text-slate-600">{strings.appName}</p>
          <LogOutButton />
        </div>
        <main className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h1 className="text-2xl font-semibold">{s.title}</h1>
          <p className="text-slate-700">{s.intro}</p>
          {showAlert && (
            <FormAlert tone="error">
              <ApiErrorMessage error={onboarding.error} />
            </FormAlert>
          )}
          <form noValidate onSubmit={(event) => void onSubmit(event)} className="space-y-4">
            <TextField
              label={s.businessName}
              hint={s.businessNameHint}
              autoComplete="organization"
              error={errors.businessName?.message}
              {...nameField}
            />
            <TextField
              label={s.contactPhone}
              hint={s.contactPhoneHint}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              error={errors.contactPhone?.message}
              {...form.register('contactPhone')}
            />
            <TextField
              label={s.orderPrefix}
              hint={s.orderPrefixHint}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={6}
              className="uppercase"
              error={errors.orderPrefix?.message}
              {...prefixField}
            />
            <PrefixPreview control={form.control} />
            <SubmitButton pending={onboarding.isPending} pendingLabel={s.submitting}>
              {s.submit}
            </SubmitButton>
          </form>
        </main>
      </div>
    </div>
  );
}

/** Live example of the seller's order numbers (§6.8), e.g. "NIM-0001, then NIM-0002". */
function PrefixPreview({
  control,
}: {
  control: Control<OnboardingRequest, unknown, OnboardingInput>;
}) {
  const raw = useWatch({ control, name: 'orderPrefix' }) ?? '';
  const prefix = raw.trim().toUpperCase();
  const valid = ORDER_PREFIX_PATTERN.test(prefix);
  // The live region stays in the page so screen readers announce each change; it is empty
  // while the prefix is invalid (the field's own error says why).
  return (
    <p
      aria-live="polite"
      data-testid="prefix-preview"
      className={valid ? 'rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700' : 'sr-only'}
    >
      {valid ? s.prefixPreview(formatOrderNumber(prefix, 1), formatOrderNumber(prefix, 2)) : ''}
    </p>
  );
}
