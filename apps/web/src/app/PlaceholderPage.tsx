import { strings } from '../lib/strings';

/**
 * Stands in for a section that a later task builds (orders C13–C15, customers B6, products B7,
 * reports E3, settings E5), so every navigation link already leads somewhere sensible.
 */
export function PlaceholderPage({ title }: { title: string }) {
  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-slate-600">{strings.shell.comingSoon}</p>
    </section>
  );
}
