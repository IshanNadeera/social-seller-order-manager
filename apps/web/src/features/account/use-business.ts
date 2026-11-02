// The signed-in seller's business, from GET /me (already loaded by RequireBusiness, so these read
// the cache). Shared by every business screen.
import { useMe } from './use-me';

/** For cache keys: one business's data can never be shown to another on the same device. */
export function useBusinessId(): string {
  return useMe().data?.business?.id ?? 'none';
}

/** The business's timezone, for showing dates on its calendar (§8.1). */
export function useBusinessTimeZone(): string {
  return useMe().data?.business?.timezone ?? 'Asia/Colombo';
}

/** The business's currency code (§6.8: LKR in the MVP). */
export function useBusinessCurrency(): string {
  return useMe().data?.business?.currency ?? 'LKR';
}
