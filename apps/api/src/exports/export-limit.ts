import { Injectable } from '@nestjs/common';
import { EXPORTS_PER_HOUR } from '@ssom/shared';

const HOUR_MS = 60 * 60 * 1000;

/**
 * At most EXPORTS_PER_HOUR exports per business in any hour (§11.4: rate limits on exports). An
 * export runs one large query, so this protects the database from a script or a stuck button.
 * Only exports that were made count; a refused or failed one doesn't use up the allowance.
 *
 * Kept in memory, like the per-user request limit (common/user-throttler.guard.ts): right for the
 * single API instance of the MVP. With several instances, move it to a shared store.
 */
@Injectable()
export class ExportLimit {
  private readonly made = new Map<string, number[]>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Seconds until `businessId` may export again, or null if it may now. */
  waitSeconds(businessId: string): number | null {
    const recent = this.recent(businessId);
    if (recent.length < EXPORTS_PER_HOUR) return null;
    const oldest = recent[0] ?? this.now();
    return Math.max(1, Math.ceil((oldest + HOUR_MS - this.now()) / 1000));
  }

  /** Counts an export that `businessId` just made. */
  record(businessId: string): void {
    this.made.set(businessId, [...this.recent(businessId), this.now()]);
  }

  /** This business's exports within the last hour, oldest first (older ones are forgotten). */
  private recent(businessId: string): number[] {
    const since = this.now() - HOUR_MS;
    const recent = (this.made.get(businessId) ?? []).filter((at) => at > since);
    if (recent.length === 0) this.made.delete(businessId);
    else this.made.set(businessId, recent);
    return recent;
  }
}
