import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import type { z } from 'zod';
import { FormAlert, SubmitButton, TextField, linkClass } from '../../components/form';
import { strings } from '../../lib/strings';
import { useAuth } from './AuthProvider';
import { authErrorMessage } from './auth-errors';
import { forgotPasswordSchema } from './schemas';
import type { ForgotPasswordForm } from './schemas';

const s = strings.auth;

/**
 * Requests a password-reset email. The emailed link opens /auth/confirm (type=recovery), which
 * signs the seller in for this purpose and moves on to /auth/reset-password.
 */
export function ForgotPasswordPage() {
  const { client } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useForm<ForgotPasswordForm, unknown, z.output<typeof forgotPasswordSchema>>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async ({ email }) => {
    setError(null);
    try {
      const { error: authError } = await client.resetPasswordForEmail(email);
      if (authError) {
        setError(authErrorMessage(authError));
        return;
      }
      setSentTo(email);
    } catch (thrown) {
      setError(authErrorMessage(thrown));
    }
  });

  if (sentTo !== null) {
    return (
      <>
        <h1 className="text-2xl font-semibold">{s.forgot.sentTitle}</h1>
        <p>{s.forgot.sent(sentTo)}</p>
        <p className="text-sm">
          <Link to="/login" className={linkClass}>
            {s.forgot.backToLogin}
          </Link>
        </p>
      </>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-semibold">{s.forgot.title}</h1>
      <p className="text-slate-700">{s.forgot.intro}</p>
      {error && <FormAlert tone="error">{error}</FormAlert>}
      <form noValidate onSubmit={(event) => void onSubmit(event)} className="space-y-4">
        <TextField
          label={s.fields.email}
          type="email"
          autoComplete="email"
          inputMode="email"
          error={errors.email?.message}
          {...form.register('email')}
        />
        <SubmitButton pending={isSubmitting} pendingLabel={s.forgot.submitting}>
          {s.forgot.submit}
        </SubmitButton>
      </form>
      <p className="text-sm">
        <Link to="/login" className={linkClass}>
          {s.forgot.backToLogin}
        </Link>
      </p>
    </>
  );
}
