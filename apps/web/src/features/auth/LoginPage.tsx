import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import type { z } from 'zod';
import { FormAlert, SubmitButton, TextField, linkClass } from '../../components/form';
import { strings } from '../../lib/strings';
import { useAuth } from './AuthProvider';
import { authErrorCode, authErrorMessage } from './auth-errors';
import { loginSchema } from './schemas';
import type { LoginForm } from './schemas';

const s = strings.auth;

/**
 * Email + password log-in. On success the auth state changes and RedirectIfSignedIn sends the
 * seller to where they were going (or the dashboard); this page does not navigate by itself.
 */
export function LoginPage() {
  const { client } = useAuth();
  const [error, setError] = useState<{ message: string; unconfirmed: boolean } | null>(null);
  const [resent, setResent] = useState(false);
  const form = useForm<LoginForm, unknown, z.output<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async ({ email, password }) => {
    setError(null);
    setResent(false);
    try {
      const { error: authError } = await client.signInWithPassword({ email, password });
      if (authError) {
        setError({
          message: authErrorMessage(authError),
          unconfirmed: authErrorCode(authError) === 'email_not_confirmed',
        });
        form.resetField('password');
      }
    } catch (thrown) {
      setError({ message: authErrorMessage(thrown), unconfirmed: false });
    }
  });

  const resendConfirmation = async () => {
    const email = form.getValues('email').trim().toLowerCase();
    try {
      const { error: authError } = await client.resend({ type: 'signup', email });
      if (authError) {
        setError({ message: authErrorMessage(authError), unconfirmed: true });
        return;
      }
      setError(null);
      setResent(true);
    } catch (thrown) {
      setError({ message: authErrorMessage(thrown), unconfirmed: true });
    }
  };

  return (
    <>
      <h1 className="text-2xl font-semibold">{s.login.title}</h1>
      {error && (
        <FormAlert tone="error">
          <p>{error.message}</p>
          {error.unconfirmed && (
            <button type="button" onClick={() => void resendConfirmation()} className={`mt-1 ${linkClass}`}>
              {s.login.resendConfirmation}
            </button>
          )}
        </FormAlert>
      )}
      {resent && <FormAlert tone="success">{s.login.confirmationResent}</FormAlert>}
      <form noValidate onSubmit={(event) => void onSubmit(event)} className="space-y-4">
        <TextField
          label={s.fields.email}
          type="email"
          autoComplete="email"
          inputMode="email"
          error={errors.email?.message}
          {...form.register('email')}
        />
        <TextField
          label={s.fields.password}
          type="password"
          autoComplete="current-password"
          error={errors.password?.message}
          {...form.register('password')}
        />
        <SubmitButton pending={isSubmitting} pendingLabel={s.login.submitting}>
          {s.login.submit}
        </SubmitButton>
      </form>
      <div className="space-y-2 text-sm">
        <p>
          <Link to="/forgot-password" className={linkClass}>
            {s.login.forgotPassword}
          </Link>
        </p>
        <p>
          {s.login.noAccount}{' '}
          <Link to="/signup" className={linkClass}>
            {s.login.signUpLink}
          </Link>
        </p>
      </div>
    </>
  );
}
