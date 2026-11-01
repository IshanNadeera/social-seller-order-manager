// A stand-in for PrismaService in HTTP tests that must not need a database.
// Only what those tests touch is implemented; anything else fails loudly.

export type QueryOutcome = 'ok' | 'fail' | 'hang';

export function fakePrisma(outcome: QueryOutcome = 'ok') {
  return {
    $queryRaw(): Promise<unknown> {
      if (outcome === 'ok') return Promise.resolve([{ '?column?': 1 }]);
      if (outcome === 'fail') {
        return Promise.reject(
          new Error('password authentication failed for user "postgres" at 10.0.0.5:5432'),
        );
      }
      return new Promise<never>(() => undefined); // never answers
    },
    $disconnect(): Promise<void> {
      return Promise.resolve();
    },
  };
}
