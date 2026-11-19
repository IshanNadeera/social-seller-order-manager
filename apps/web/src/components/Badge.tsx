// A small status label (docs/DEVELOPMENT.md §6.9): status badges use text and an icon, not colour
// alone, so they read the same for colour-blind sellers, on a grey screen, or when printed. The
// icon is decorative (hidden from screen readers); the text says it all.
import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'info' | 'good' | 'warning' | 'bad';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-800 ring-slate-300',
  info: 'bg-sky-50 text-sky-900 ring-sky-200',
  good: 'bg-green-50 text-green-900 ring-green-200',
  warning: 'bg-amber-50 text-amber-900 ring-amber-200',
  bad: 'bg-red-50 text-red-900 ring-red-200',
};

export function Badge({
  icon,
  tone = 'neutral',
  children,
}: {
  /** A short symbol such as ✓; shown, but not read aloud. */
  icon: string;
  tone?: BadgeTone;
  children: ReactNode;
}) {
  return (
    <span
      data-badge=""
      className={`inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${TONES[tone]}`}
    >
      <span aria-hidden="true">{icon}</span>
      {children}
    </span>
  );
}
