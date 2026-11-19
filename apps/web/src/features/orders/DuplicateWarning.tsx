// The order form's duplicate-order warning (docs/DEVELOPMENT.md §2.2): a similar order for the same
// customer phone in the last 30 minutes. It never blocks saving, and if the check fails it simply
// says nothing: the seller can always save.
import { linkClass } from '../../components/form';
import { formatMoney } from '../../lib/money';
import { strings } from '../../lib/strings';
import { useBusinessCurrency } from '../account/use-business';
import { usePossibleDuplicates } from './api';

const d = strings.orders.form.duplicate;

const minutesSince = (instant: string, now: number) =>
  Math.max(1, Math.round((now - new Date(instant).getTime()) / 60_000));

export function DuplicateWarning({
  customerId,
  total,
}: {
  customerId: string;
  total: string | null;
}) {
  const currency = useBusinessCurrency();
  const check = usePossibleDuplicates(customerId, total);
  const found = check.data ?? [];
  const now = Date.now();

  return (
    // Always in the page, so screen readers announce the warning when it appears.
    <div role="status" aria-live="polite">
      {found.length > 0 && (
        <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
          <p className="font-semibold">{d.title}</p>
          <p className="text-sm">{d.body}</p>
          <ul aria-label={d.listLabel} className="space-y-1 text-sm">
            {found.map((order) => (
              <li key={order.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>
                  {d.item(
                    order.orderNumber,
                    formatMoney(order.totalAmount, currency),
                    minutesSince(order.createdAt, now),
                  )}
                </span>
                {/* A new tab, so nothing typed into this form is lost. */}
                <a
                  href={`/orders/${encodeURIComponent(order.id)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${linkClass} text-sm`}
                >
                  {d.open(order.orderNumber)}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
