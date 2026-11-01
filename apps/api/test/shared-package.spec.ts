// Checks that the API can use @ssom/shared both at compile time and at run time.
// The compiled API is CommonJS and @ssom/shared is an ES module, so the run-time check uses a real
// Node process with require(), exactly as dist/main.js will.
import { execFileSync } from 'node:child_process';
import { ORDER_STATUSES, isSourceChannel } from '@ssom/shared';
import type { OrderStatus } from '@ssom/shared';
import { describe, expect, it } from 'vitest';

describe('@ssom/shared in the API', () => {
  it('provides typed enums', () => {
    const first: OrderStatus = ORDER_STATUSES[0];
    expect(first).toBe('NEW');
    expect(isSourceChannel('WHATSAPP')).toBe(true);
  });

  it('loads with require() in plain Node, as the compiled API does', () => {
    const output = execFileSync(
      process.execPath,
      ['-e', "process.stdout.write(require('@ssom/shared').ORDER_STATUSES.join(','))"],
      { cwd: process.cwd(), encoding: 'utf8' },
    );
    expect(output.split(',')).toEqual([...ORDER_STATUSES]);
  });
});
