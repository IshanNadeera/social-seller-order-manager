import { ConflictException, Injectable } from '@nestjs/common';
import type { AuthContext } from '../auth/auth-context';
import { PrismaService } from '../common/prisma.service';
import type { Prisma } from '../generated/prisma/client';
import { requestHash } from './canonical-json';

/** How long a stored response is kept (§8.2: rows older than 48 hours are deleted). */
export const IDEMPOTENCY_RETENTION_HOURS = 48;

export interface IdempotentRequest {
  /** From @IdempotencyKey(). */
  key: string;
  /** e.g. "POST /orders" or "POST /orders/:id/payments" with the real ID, so a key can't cross orders. */
  endpoint: string;
  /** The validated body (and anything else that defines the request). */
  payload: unknown;
}

export interface IdempotentResult<Body> {
  status: number;
  body: Body;
  /** True when this is the stored response of an earlier attempt. */
  replayed: boolean;
}

/**
 * Runs a create request at most once per Idempotency-Key (docs/DEVELOPMENT.md §9.8, ADR-017).
 *
 * The key row is inserted at the start of the SAME transaction as the work, and the response is
 * stored in it before commit, so the order (or payment) and its key are saved together or not at all:
 * - a retry with the same key and the same request gets the stored response, and nothing runs again;
 * - the same key with a different request (or endpoint, or user) is refused with 409;
 * - two attempts at once: the second waits on the first's key row, then replays its response;
 * - if the work fails, everything rolls back, the key included, so a retry runs it fresh.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async execute<Body>(
    auth: Pick<AuthContext, 'businessId' | 'userId'>,
    request: IdempotentRequest,
    work: (tx: Prisma.TransactionClient) => Promise<Body>,
    status = 201,
  ): Promise<IdempotentResult<Body>> {
    const hash = requestHash(request.endpoint, request.payload);
    const id = { businessId_key: { businessId: auth.businessId, key: request.key } };

    return this.prisma.$transaction(async (tx) => {
      // Waits here if another transaction holds the same key, until it commits or rolls back.
      const claimed = await tx.$queryRaw<{ key: string }[]>`
        INSERT INTO app.idempotency_keys (business_id, key, user_id, endpoint, request_hash)
        VALUES (${auth.businessId}::uuid, ${request.key}, ${auth.userId}::uuid, ${request.endpoint}, ${hash})
        ON CONFLICT (business_id, key) DO NOTHING
        RETURNING key`;

      if (claimed.length === 0) {
        const stored = await tx.idempotencyKey.findUniqueOrThrow({ where: id });
        const sameRequest =
          stored.requestHash === hash &&
          stored.endpoint === request.endpoint &&
          stored.userId === auth.userId;
        if (!sameRequest) throw keyReusedError();
        if (stored.responseStatus === null) throw keyReusedError(); // cannot happen after commit
        return { status: stored.responseStatus, body: stored.responseBody as Body, replayed: true };
      }

      // Stored and returned as JSON, so the first answer and every replay are identical.
      const body = JSON.parse(JSON.stringify(await work(tx))) as Body;
      await tx.idempotencyKey.update({
        where: id,
        data: { responseStatus: status, responseBody: body as Prisma.InputJsonValue },
      });
      return { status, body, replayed: false };
    });
  }

  /** Deletes stored responses older than the retention period (for the scheduled clean-up job). */
  async deleteExpired(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - IDEMPOTENCY_RETENTION_HOURS * 3_600_000);
    const { count } = await this.prisma.idempotencyKey.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return count;
  }
}

function keyReusedError(): ConflictException {
  return new ConflictException({
    code: 'IDEMPOTENCY_KEY_REUSED',
    message:
      'This request key was already used for a different request. Please reload and try again.',
  });
}
