import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import type { z } from 'zod';
import { FormAlert, SubmitButton, TextField, linkClass } from '../../components/form';
import { strings } from '../../lib/strings';
import { useAuth } from './AuthProvider';
import { authErrorMessage } from './auth-errors';
import { HOME_PATH } from './redirect';
import { resetPasswordSchema } from './schemas';
import type { ResetPasswordForm } from './schemas';

const s = strings.auth;

/** Router state read by the app layout to show a one-off confirmation message. */
export interface NoticeState {
  notice?: 'passwordChanged';
}

/**
 * Sets a new password. Reached from a reset link via /auth/confirm, which has already signed the
 * seller in for this purpose. Without a session (expired link, opened directly) it offers a new link.
 */
export function ResetPasswordPage() {
  const { client, status } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<ResetPasswordForm, unknown, z.output<typeof resetPasswordSchema>>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '', confirmPassword: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async ({ password }) => {
    setError(null);
    try {
      const { error: authError } = await client.updateUser({ password });
      if (authError) {
        setError(authErrorMessage(authError));
        return;
      }
      const state: NoticeState = { notice: 'passwordChanged' };
      void navigate(HOME_PATH, { replace: true, state });
    } catch (thrown) {
      setError(authErrorMessage(thrown));
    }
  });

  if (status === 'loading') {
    return (
      <p role="status" aria-live="polite">
        {strings.common.loading}
      </p>
    );
  }

  if (status === 'signedOut') {
    return (
      <>
        <h1 className="text-2xl font-semibold">{s.reset.noSessionTitle}</h1>
        <p>{s.reset.noSessionBody}</p>
        <p className="text-sm">
          <Link to="/forgot-password" className={linkClass}>
            {s.reset.requestNew}
          </Link>
        </p>
      </>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-semibold">{s.reset.title}</h1>
      {error && <FormAlert tone="error">{error}</FormAlert>}
      <form noValidate onSubmit={(event) => void onSubmit(event)} className="space-y-4">
        <TextField
          label={s.fields.newPassword}
          type="password"
          autoComplete="new-password"
          hint={s.fields.passwordHint}
          error={errors.password?.message}
          {...form.register('password')}
        />
        <TextField
          label={s.fields.confirmPassword}
          type="password"
          autoComplete="new-password"
          error={errors.confirmPassword?.message}
          {...form.register('confirmPassword')}
        />
        <SubmitButton pending={isSubmitting} pendingLabel={s.reset.submitting}>
          {s.reset.submit}
        </SubmitButton>
      </form>
    </>
  );
}
