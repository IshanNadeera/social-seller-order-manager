import { Link } from 'react-router';
import { strings } from '../lib/strings';

export function NotFoundPage() {
  return (
    <section className="space-y-3">
      <h1 className="text-2xl font-semibold">{strings.notFound.title}</h1>
      <p className="text-slate-600">{strings.notFound.body}</p>
      <Link
        to="/"
        className="inline-block font-medium text-blue-700 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
      >
        {strings.notFound.backHome}
      </Link>
    </section>
  );
}
