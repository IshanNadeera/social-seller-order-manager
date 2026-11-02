import { strings } from '../lib/strings';
import { buttonClass } from './form';

const s = strings.pagination;

/** "Showing 26–50 of 312" with Previous / Next (server-side paging, §6.3). Hidden when one page fits all. */
export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0 || (page === 1 && lastPage === 1)) return null;
  const from = Math.min(total, (page - 1) * pageSize + 1);
  const to = Math.min(total, page * pageSize);

  return (
    <nav aria-label={s.label} className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-slate-600">{s.summary(from, to, total)}</p>
      <div className="flex gap-2">
        <button
          type="button"
          className={buttonClass.secondary}
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          {s.previous}
        </button>
        <button
          type="button"
          className={buttonClass.secondary}
          disabled={page >= lastPage}
          onClick={() => onPage(page + 1)}
        >
          {s.next}
        </button>
      </div>
    </nav>
  );
}
