// A sheet: a small form over the page, sliding up from the bottom on phones (docs/DEVELOPMENT.md
// §6.4: quick-add customer/product). The page underneath stays mounted, so nothing typed there is lost.
import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { FormEvent, KeyboardEvent, ReactNode } from 'react';
import { strings } from '../lib/strings';
import { buttonClass } from './form';

const FOCUSABLE = 'input, select, textarea, button, a[href]';

/**
 * A modal dialog (role="dialog"), accessible like ConfirmDialog: focus moves to its first field when
 * it opens and back when it closes, Tab stays inside, Escape closes (unless `busy`).
 * Rendered into <body>, so a form inside it is never nested in the page's form. React still bubbles
 * its events through the page, so a form in a sheet must stop its submit event (see stopSubmit).
 */
export function Sheet({
  open,
  title,
  busy = false,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  /** While saving: Escape and Close do nothing. */
  busy?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sheetRef.current?.querySelector<HTMLElement>('input, select, textarea')?.focus();
    return () => previous?.focus();
  }, [open]);

  if (!open) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (!busy) onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(
      sheetRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
    ).filter((element) => !element.hasAttribute('disabled'));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (first === undefined || last === undefined) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-40 grid place-items-end bg-slate-900/40 sm:place-items-center sm:p-4">
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        className="max-h-[90vh] w-full space-y-4 overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:max-w-md sm:rounded-2xl"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          <button type="button" className={buttonClass.quiet} onClick={onClose} disabled={busy}>
            {strings.common.close}
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/**
 * For a form inside a sheet: keeps its submit from reaching the page's form (React bubbles events
 * through portals), then runs `submit`.
 */
export function stopSubmit(submit: (event: FormEvent<HTMLFormElement>) => Promise<void>) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.stopPropagation();
    void submit(event);
  };
}
