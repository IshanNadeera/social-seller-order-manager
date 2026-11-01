// Form rules for the auth screens. These stay in the web app: the API never handles passwords
// (docs/DEVELOPMENT.md §9.1, §11.2). Supabase Auth applies the same minimum on its side.
import { z } from 'zod';
import { strings } from '../../lib/strings';

const v = strings.auth.validation;

/** Supabase's minimum (supabase/config.toml) and bcrypt's maximum of 72 bytes. */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;

const email = z
  .string()
  .trim()
  .min(1, { message: v.emailRequired, abort: true }) // empty: say only this
  .pipe(z.email(v.emailInvalid))
  .transform((value) => value.toLowerCase());

/** Passwords are never trimmed: spaces are allowed characters. */
const newPassword = z
  .string()
  .min(PASSWORD_MIN, v.passwordTooShort)
  .refine((value) => new TextEncoder().encode(value).length <= PASSWORD_MAX, v.passwordTooLong);

export const loginSchema = z.object({
  email,
  password: z.string().min(1, v.passwordRequired),
});

export const signUpSchema = z
  .object({ email, password: newPassword, confirmPassword: z.string() })
  .refine((form) => form.password === form.confirmPassword, {
    path: ['confirmPassword'],
    message: v.passwordsDontMatch,
  });

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z
  .object({ password: newPassword, confirmPassword: z.string() })
  .refine((form) => form.password === form.confirmPassword, {
    path: ['confirmPassword'],
    message: v.passwordsDontMatch,
  });

export type LoginForm = z.input<typeof loginSchema>;
export type SignUpForm = z.input<typeof signUpSchema>;
export type ForgotPasswordForm = z.input<typeof forgotPasswordSchema>;
export type ResetPasswordForm = z.input<typeof resetPasswordSchema>;
