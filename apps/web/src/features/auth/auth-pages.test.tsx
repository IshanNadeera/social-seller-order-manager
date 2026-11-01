import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { strings } from '../../lib/strings';
import { authError, createFakeAuth, fakeSession } from '../../test/fake-auth';
import { renderApp } from '../../test/render-app';

const s = strings.auth;
const type = (label: string, text: string) => userEvent.type(screen.getByLabelText(label), text);
const click = (name: string) => userEvent.click(screen.getByRole('button', { name }));

describe('log in', () => {
  it('signs in with the trimmed, lower-cased email and lands on the dashboard', async () => {
    const auth = createFakeAuth(null);
    const router = renderApp('/login', auth);
    await screen.findByRole('heading', { name: s.login.title });
    await type(s.fields.email, '  Seller@Example.TEST ');
    await type(s.fields.password, 'correct horse');
    await click(s.login.submit);
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'seller@example.test',
      password: 'correct horse',
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('checks the form before calling Supabase', async () => {
    const auth = createFakeAuth(null);
    renderApp('/login', auth);
    await screen.findByRole('heading', { name: s.login.title });
    await type(s.fields.email, 'not-an-email');
    await click(s.login.submit);
    expect(await screen.findByText(s.validation.emailInvalid)).toBeInTheDocument();
    expect(screen.getByText(s.validation.passwordRequired)).toBeInTheDocument();
    expect(screen.getByLabelText(s.fields.email)).toHaveAttribute('aria-invalid', 'true');
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('explains wrong credentials in plain language and clears the password', async () => {
    const auth = createFakeAuth(null);
    auth.signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: authError('invalid_credentials') as never,
    } as never);
    renderApp('/login', auth);
    await screen.findByRole('heading', { name: s.login.title });
    await type(s.fields.email, 'seller@example.test');
    await type(s.fields.password, 'wrong password');
    await click(s.login.submit);
    expect(await screen.findByRole('alert')).toHaveTextContent(s.errors.invalidCredentials);
    expect(screen.getByLabelText(s.fields.password)).toHaveValue('');
    expect(screen.getByLabelText(s.fields.email)).toHaveValue('seller@example.test');
  });

  it('offers to resend the confirmation email when the email is not confirmed', async () => {
    const auth = createFakeAuth(null);
    auth.signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: authError('email_not_confirmed') as never,
    } as never);
    renderApp('/login', auth);
    await screen.findByRole('heading', { name: s.login.title });
    await type(s.fields.email, 'Seller@example.test');
    await type(s.fields.password, 'correct horse');
    await click(s.login.submit);
    expect(await screen.findByRole('alert')).toHaveTextContent(s.errors.emailNotConfirmed);
    await click(s.login.resendConfirmation);
    expect(auth.resend).toHaveBeenCalledWith({ type: 'signup', email: 'seller@example.test' });
    expect(await screen.findByText(s.login.confirmationResent)).toBeInTheDocument();
  });

  it('says when the server cannot be reached', async () => {
    const auth = createFakeAuth(null);
    auth.signInWithPassword.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    renderApp('/login', auth);
    await screen.findByRole('heading', { name: s.login.title });
    await type(s.fields.email, 'seller@example.test');
    await type(s.fields.password, 'correct horse');
    await click(s.login.submit);
    expect(await screen.findByRole('alert')).toHaveTextContent(s.errors.network);
  });
});

describe('sign up', () => {
  it('creates the account and asks the seller to check their email', async () => {
    const auth = createFakeAuth(null);
    renderApp('/signup', auth);
    await screen.findByRole('heading', { name: s.signUp.title });
    await type(s.fields.email, 'New.Seller@example.test');
    await type(s.fields.password, 'long enough');
    await type(s.fields.confirmPassword, 'long enough');
    await click(s.signUp.submit);
    expect(auth.signUp).toHaveBeenCalledWith({ email: 'new.seller@example.test', password: 'long enough' });
    expect(await screen.findByRole('heading', { name: s.checkEmail.title })).toBeInTheDocument();
    expect(screen.getByText(s.checkEmail.body('new.seller@example.test'))).toBeInTheDocument();

    await click(s.checkEmail.resend);
    expect(auth.resend).toHaveBeenCalledWith({ type: 'signup', email: 'new.seller@example.test' });
    expect(await screen.findByText(s.checkEmail.resent)).toBeInTheDocument();
  });

  it.each([
    ['short', 'short', s.validation.passwordTooShort],
    ['long enough', 'long enougH', s.validation.passwordsDontMatch],
  ])('refuses password %j / %j before calling Supabase', async (password, confirm, message) => {
    const auth = createFakeAuth(null);
    renderApp('/signup', auth);
    await screen.findByRole('heading', { name: s.signUp.title });
    await type(s.fields.email, 'seller@example.test');
    await type(s.fields.password, password);
    await type(s.fields.confirmPassword, confirm);
    await click(s.signUp.submit);
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it('shows Supabase rejections in plain language', async () => {
    const auth = createFakeAuth(null);
    auth.signUp.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: authError('weak_password', 422) as never,
    });
    renderApp('/signup', auth);
    await screen.findByRole('heading', { name: s.signUp.title });
    await type(s.fields.email, 'seller@example.test');
    await type(s.fields.password, 'password1');
    await type(s.fields.confirmPassword, 'password1');
    await click(s.signUp.submit);
    expect(await screen.findByRole('alert')).toHaveTextContent(s.errors.weakPassword);
    expect(screen.queryByRole('heading', { name: s.checkEmail.title })).not.toBeInTheDocument();
  });
});

describe('forgot password', () => {
  it('sends the reset email and gives the same answer whether or not the account exists', async () => {
    const auth = createFakeAuth(null);
    renderApp('/forgot-password', auth);
    await screen.findByRole('heading', { name: s.forgot.title });
    await type(s.fields.email, 'Seller@example.test');
    await click(s.forgot.submit);
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('seller@example.test');
    expect(await screen.findByText(s.forgot.sent('seller@example.test'))).toBeInTheDocument();
  });
});

describe('email links (/auth/confirm)', () => {
  it('confirms a sign-up link once and lands on the dashboard', async () => {
    const auth = createFakeAuth(null);
    const router = renderApp('/auth/confirm?token_hash=abc123&type=email', auth);
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(await screen.findByRole('heading', { name: strings.dashboard.title })).toBeInTheDocument();
    expect(auth.verifyOtp).toHaveBeenCalledTimes(1);
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: 'abc123', type: 'email' });
    expect(router.state.location.search).toBe(''); // the token is gone from the address bar
  });

  it('accepts the older "signup" type name', async () => {
    const auth = createFakeAuth(null);
    renderApp('/auth/confirm?token_hash=abc123&type=signup', auth);
    await waitFor(() =>
      expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: 'abc123', type: 'email' }),
    );
  });

  it('explains an expired or used link and offers a way forward', async () => {
    const auth = createFakeAuth(null);
    auth.verifyOtp.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: authError('otp_expired', 403) as never,
    } as never);
    renderApp('/auth/confirm?token_hash=old&type=recovery', auth);
    expect(await screen.findByRole('heading', { name: s.confirm.expiredTitle })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: s.confirm.requestNewReset })).toHaveAttribute('href', '/forgot-password');
  });

  it.each(['/auth/confirm', '/auth/confirm?type=email', '/auth/confirm?token_hash=x&type=magiclink'])(
    'refuses an incomplete or unknown link %s without calling Supabase',
    async (path) => {
      const auth = createFakeAuth(null);
      renderApp(path, auth);
      expect(await screen.findByRole('heading', { name: s.confirm.invalidTitle })).toBeInTheDocument();
      expect(auth.verifyOtp).not.toHaveBeenCalled();
    },
  );
});

describe('reset password', () => {
  it('turns a reset link into the new-password form, saves it and confirms on the dashboard', async () => {
    const auth = createFakeAuth(null);
    const router = renderApp('/auth/confirm?token_hash=abc123&type=recovery', auth);
    expect(await screen.findByRole('heading', { name: s.reset.title })).toBeInTheDocument();
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: 'abc123', type: 'recovery' });

    await type(s.fields.newPassword, 'a brand new one');
    await type(s.fields.confirmPassword, 'a brand new one');
    await click(s.reset.submit);
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'a brand new one' });
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(await screen.findByText(strings.notices.passwordChanged)).toBeInTheDocument();
  });

  it('offers a new link when opened without a valid reset session', async () => {
    renderApp('/auth/reset-password', createFakeAuth(null));
    expect(await screen.findByRole('heading', { name: s.reset.noSessionTitle })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: s.reset.requestNew })).toHaveAttribute('href', '/forgot-password');
  });

  it('keeps the form and explains when the new password is the same as the old one', async () => {
    const auth = createFakeAuth(fakeSession());
    auth.updateUser.mockResolvedValueOnce({
      data: { user: null },
      error: authError('same_password', 422) as never,
    });
    renderApp('/auth/reset-password', auth);
    await screen.findByRole('heading', { name: s.reset.title });
    await type(s.fields.newPassword, 'same as before');
    await type(s.fields.confirmPassword, 'same as before');
    await click(s.reset.submit);
    expect(await screen.findByRole('alert')).toHaveTextContent(s.errors.samePassword);
    expect(screen.getByRole('heading', { name: s.reset.title })).toBeInTheDocument();
  });
});
