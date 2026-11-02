// Asks before an action that can't simply be undone, e.g. archiving (docs/DEVELOPMENT.md §6.3, §6.9).
import { useEffect, useId, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { strings } from '../lib/strings';
import { ApiErrorMessage } from './ApiErrorMessage';
import { FormAlert, buttonClass } from './form';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  pendingLabel: string;
  pending: boolean;
  /** The failed attempt, shown inside the dialog so the seller can try again or cancel. */
  error?: unknown;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A modal confirmation (role="alertdialog"). Accessible by keyboard and screen reader:
 * - focus moves to Cancel when it opens (the safe choice), and returns to where it was when it closes;
 * - Tab stays inside the dialog; Escape cancels (unless the action is already running).
 * Not the native <dialog>: its showModal() is missing in the test DOM (jsdom).
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  pendingLabel,
  pending,
  error,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const bodyId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    return () => previous?.focus();
  }, [open]);

  if (!open) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !pending) {
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])');
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-40 grid place-items-end bg-slate-900/40 p-4 sm:place-items-center">
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onKeyDown={onKeyDown}
        className="w-full max-w-sm space-y-4 rounded-xl bg-white p-5 shadow-xl"
      >
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        <p id={bodyId} className="text-slate-700">
          {body}
        </p>
        {error !== undefined && error !== null && (
          <FormAlert tone="error">
            <ApiErrorMessage error={error} />
          </FormAlert>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={pending}
            className={buttonClass.secondary}
          >
            {strings.common.cancel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            aria-busy={pending || undefined}
            className={buttonClass.danger}
          >
            {pending ? pendingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
