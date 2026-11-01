import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import type { z } from 'zod';
import { FormAlert, SubmitButton, TextField, linkClass } from '../../components/form';
import { strings } from '../../lib/strings';
import { useAuth } from './AuthProvider';
import { authErrorMessage } from './auth-errors';
import { signUpSchema } from './schemas';
import type { SignUpForm } from './schemas';

const s = strings.auth;

/**
 * Sign-up (US-001). Supabase requires email confirmation, so success shows "check your email".
 * Supabase answers the same way when the email is already registered, so the page never reveals
 * whether an account exists.
 */
export function SignUpPage() {
  const { client } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useForm<SignUpForm, unknown, z.output<typeof signUpSchema>>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { email: '', password: '', confirmPassword: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async ({ email, password }) => {
    setError(null);
    try {
      const { data, error: authError } = await client.signUp({ email, password });
      if (authError) {
        setError(authErrorMessage(authError));
        return;
      }
      // With confirmations off (never in our config) Supabase signs in at once; the auth state
      // change then redirects. Otherwise the seller must open the emailed link.
      if (!data.session) setSentTo(email);
    } catch (thrown) {
      setError(authErrorMessage(thrown));
    }
  });

  if (sentTo !== null) {
    return <CheckEmail email={sentTo} onUseDifferentEmail={() => setSentTo(null)} />;
  }

  return (
    <>
      <h1 className="text-2xl font-semibold">{s.signUp.title}</h1>
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
        <TextField
          label={s.fields.password}
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
        <SubmitButton pending={isSubmitting} pendingLabel={s.signUp.submitting}>
          {s.signUp.submit}
        </SubmitButton>
      </form>
      <p className="text-sm">
        {s.signUp.haveAccount}{' '}
        <Link to="/login" className={linkClass}>
          {s.signUp.logInLink}
        </Link>
      </p>
    </>
  );
}

function CheckEmail({ email, onUseDifferentEmail }: { email: string; onUseDifferentEmail: () => void }) {
  const { client } = useAuth();
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  const resend = async () => {
    setState('sending');
    setError(null);
    try {
      const { error: authError } = await client.resend({ type: 'signup', email });
      if (authError) {
        setError(authErrorMessage(authError));
        setState('idle');
        return;
      }
      setState('sent');
    } catch (thrown) {
      setError(authErrorMessage(thrown));
      setState('idle');
    }
  };

  return (
    <>
      <h1 className="text-2xl font-semibold">{s.checkEmail.title}</h1>
      <p>{s.checkEmail.body(email)}</p>
      <p className="text-sm text-slate-600">{s.checkEmail.spamHint}</p>
      {error && <FormAlert tone="error">{error}</FormAlert>}
      {state === 'sent' && <FormAlert tone="success">{s.checkEmail.resent}</FormAlert>}
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <button
          type="button"
          disabled={state === 'sending'}
          onClick={() => void resend()}
          className={linkClass}
        >
          {state === 'sending' ? s.checkEmail.resending : s.checkEmail.resend}
        </button>
        <button type="button" onClick={onUseDifferentEmail} className={linkClass}>
          {s.checkEmail.useDifferentEmail}
        </button>
      </div>
    </>
  );
}
