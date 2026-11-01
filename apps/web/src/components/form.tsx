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
