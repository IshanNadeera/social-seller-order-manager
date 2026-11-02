// Small accessible form pieces (docs/DEVELOPMENT.md §6.9): every input has a visible label, and its
// hint and error are linked with aria-describedby so screen readers announce them.
import { useId } from 'react';
import type { ComponentPropsWithRef, ReactNode } from 'react';

type TextFieldProps = ComponentPropsWithRef<'input'> & {
  label: string;
  hint?: string;
  error?: string;
};

export function TextField({ label, hint, error, id, className, ...input }: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  return (
    <div className="space-y-1">
      <label htmlFor={inputId} className="block text-sm font-medium text-slate-800">
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={[
          'block w-full rounded-lg border bg-white px-3 py-2.5 text-base text-slate-900',
          'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-700',
          error ? 'border-red-600' : 'border-slate-300',
          className ?? '',
        ].join(' ')}
        {...input}
      />
      {hint && (
        <p id={hintId} className="text-sm text-slate-600">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

type TextAreaFieldProps = ComponentPropsWithRef<'textarea'> & {
  label: string;
  hint?: string;
  error?: string;
};

export function TextAreaField({
  label,
  hint,
  error,
  id,
  className,
  ...textarea
}: TextAreaFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  return (
    <div className="space-y-1">
      <label htmlFor={inputId} className="block text-sm font-medium text-slate-800">
        {label}
      </label>
      <textarea
        id={inputId}
        rows={3}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={[
          'block w-full rounded-lg border bg-white px-3 py-2.5 text-base text-slate-900',
          'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-700',
          error ? 'border-red-600' : 'border-slate-300',
          className ?? '',
        ].join(' ')}
        {...textarea}
      />
      {hint && (
        <p id={hintId} className="text-sm text-slate-600">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

type CheckboxFieldProps = Omit<ComponentPropsWithRef<'input'>, 'type'> & { label: string };

/** A checkbox with its label to the right; the whole row is clickable (44px tall target). */
export function CheckboxField({ label, id, ...input }: CheckboxFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <div className="flex min-h-11 items-center gap-3">
      <input
        id={inputId}
        type="checkbox"
        className="size-5 shrink-0 rounded border-slate-400 accent-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
        {...input}
      />
      <label htmlFor={inputId} className="text-sm font-medium text-slate-800">
        {label}
      </label>
    </div>
  );
}

const buttonBase =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-70';

/** Button and button-like link styles. */
export const buttonClass = {
  primary: `${buttonBase} bg-blue-700 text-white hover:bg-blue-800`,
  secondary: `${buttonBase} border border-slate-300 bg-white text-slate-800 hover:bg-slate-50`,
  danger: `${buttonBase} bg-red-700 text-white hover:bg-red-800`,
  /** Small text-style button inside cards. */
  quiet: `${buttonBase} min-h-9 px-2 py-1 text-sm text-blue-800 hover:bg-blue-50`,
} as const;

export function SubmitButton({
  pending,
  pendingLabel,
  children,
}: {
  pending: boolean;
  pendingLabel: string;
  children: ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      className="w-full rounded-lg bg-blue-700 px-4 py-2.5 font-semibold text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

/** A message for the whole form. Errors are announced immediately (role="alert"). */
export function FormAlert({ tone, children }: { tone: 'error' | 'success'; children: ReactNode }) {
  const styles =
    tone === 'error'
      ? 'border-red-200 bg-red-50 text-red-800'
      : 'border-green-200 bg-green-50 text-green-800';
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-lg border px-3 py-2 text-sm ${styles}`}
    >
      {children}
    </div>
  );
}

export const linkClass =
  'font-medium text-blue-700 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';
