// Showing money (docs/DEVELOPMENT.md §7.5): amounts arrive from the API as strings such as "1500.00"
// and are formatted as text, never turned into a JavaScript number, so no rounding can creep in.
import { strings } from './strings';

const AMOUNT = /^(-?)(\d+)(?:\.(\d+))?$/;

/** "1500.00", "LKR" → "LKR 1,500.00". Anything that isn't a plain amount is shown as it came. */
export function formatMoney(amount: string, currency: string): string {
  const match = AMOUNT.exec(amount.trim());
  if (match === null) return strings.money(currency, amount);
  const [, sign = '', whole = '0', fraction = ''] = match;
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${strings.money(currency, `${grouped}.${fraction.padEnd(2, '0')}`)}`;
}
