// §7.2 transition tables. The expected pairs are written out here from the blueprint, independently
// of ORDER_TRANSITIONS & co., and every from × to pair is checked both ways (allowed and refused).
import { describe, expect, it } from 'vitest';
import {
  COD_STATUSES,
  DELIVERY_STATUSES,
  ORDER_STATUSES,
  allowedDeliveryTransitions,
  allowedOrderTransitions,
  checkDeliveryTransition,
  checkOrderTransition,
  isCodTransitionAllowed,
  nextCodStatus,
} from './index.js';
import type { CodStatus, DeliveryStatus, OrderStatus } from './index.js';

/** Every pair, labelled allowed or not, from a list of the allowed ones. */
function pairs<S extends string>(statuses: readonly S[], allowed: Record<S, readonly S[]>) {
  return statuses.flatMap((from) =>
    statuses.map((to) => [from, to, allowed[from].includes(to)] as const),
  );
}

// ---------- Order (seller actions) ----------

const ORDER_ALLOWED: Record<OrderStatus, readonly OrderStatus[]> = {
  NEW: ['PENDING_CONFIRMATION', 'CONFIRMED', 'CANCELLED'],
  PENDING_CONFIRMATION: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PREPARING', 'READY', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['COMPLETED', 'CANCELLED'],
  COMPLETED: ['RETURNED'],
  CANCELLED: [],
  RETURNED: [],
};

/** The most permissive context: an owner's pickup order, not dispatched, with a reason. */
const permissive = {
  fulfilmentType: 'PICKUP',
  deliveryStatus: null,
  role: 'OWNER',
  reason: 'r',
} as const;

describe('order transitions: every pair', () => {
  it.each(pairs(ORDER_STATUSES, ORDER_ALLOWED))('%s → %s allowed: %s', (from, to, allowed) => {
    const check = checkOrderTransition(from, to, permissive);
    expect(check.ok).toBe(allowed);
    if (!allowed) expect(check).toMatchObject({ code: 'INVALID_TRANSITION' });
  });
});

describe('order transition conditions', () => {
  const delivery = {
    fulfilmentType: 'DELIVERY',
    deliveryStatus: 'PENDING',
    role: 'OWNER',
  } as const;

  it('READY → COMPLETED is for pickup orders only (delivery orders complete through delivery)', () => {
    expect(checkOrderTransition('READY', 'COMPLETED', permissive).ok).toBe(true);
    expect(checkOrderTransition('READY', 'COMPLETED', delivery)).toMatchObject({
      code: 'INVALID_TRANSITION',
    });
  });

  it('READY → CANCELLED only before dispatch', () => {
    expect(checkOrderTransition('READY', 'CANCELLED', { ...delivery, reason: 'r' }).ok).toBe(true);
    for (const deliveryStatus of ['DISPATCHED', 'DELIVERED', 'FAILED', 'RETURNED'] as const) {
      expect(
        checkOrderTransition('READY', 'CANCELLED', { ...delivery, deliveryStatus, reason: 'r' }),
      ).toMatchObject({ code: 'ORDER_DISPATCHED' });
    }
  });

  it('cancelling needs a reason (blank does not count)', () => {
    for (const reason of [undefined, null, '', '   ']) {
      expect(checkOrderTransition('NEW', 'CANCELLED', { ...permissive, reason })).toMatchObject({
        code: 'REASON_REQUIRED',
      });
    }
  });

  it('COMPLETED → RETURNED is an owner correction with a reason, for pickup orders only', () => {
    expect(
      checkOrderTransition('COMPLETED', 'RETURNED', { ...permissive, role: 'STAFF' }),
    ).toMatchObject({
      code: 'OWNER_ONLY',
    });
    expect(
      checkOrderTransition('COMPLETED', 'RETURNED', { ...permissive, reason: '' }),
    ).toMatchObject({
      code: 'REASON_REQUIRED',
    });
    expect(
      checkOrderTransition('COMPLETED', 'RETURNED', {
        ...delivery,
        deliveryStatus: 'DELIVERED',
        reason: 'r',
      }),
    ).toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('other moves need no reason', () => {
    expect(checkOrderTransition('NEW', 'CONFIRMED', { ...delivery, reason: null }).ok).toBe(true);
  });

  it('lists the actions to show', () => {
    expect(allowedOrderTransitions('READY', delivery)).toEqual(['CANCELLED']);
    expect(allowedOrderTransitions('READY', { ...delivery, deliveryStatus: 'DISPATCHED' })).toEqual(
      [],
    );
    expect(allowedOrderTransitions('READY', permissive)).toEqual(['COMPLETED', 'CANCELLED']);
    expect(allowedOrderTransitions('COMPLETED', { ...permissive, role: 'STAFF' })).toEqual([]);
    expect(allowedOrderTransitions('CANCELLED', permissive)).toEqual([]);
  });
});

// ---------- Delivery ----------

const DELIVERY_ALLOWED: Record<DeliveryStatus, readonly DeliveryStatus[]> = {
  PENDING: ['DISPATCHED'],
  DISPATCHED: ['DELIVERED', 'FAILED'],
  FAILED: ['DISPATCHED', 'RETURNED'],
  DELIVERED: ['RETURNED'],
  RETURNED: [],
};

describe('delivery transitions: every pair', () => {
  it.each(pairs(DELIVERY_STATUSES, DELIVERY_ALLOWED))(
    '%s → %s allowed: %s',
    (from, to, allowed) => {
      const check = checkDeliveryTransition(from, to, {
        orderStatus: 'READY',
        role: 'OWNER',
        reason: 'r',
      });
      expect(check.ok).toBe(allowed);
      if (!allowed) expect(check).toMatchObject({ code: 'INVALID_TRANSITION' });
    },
  );
});

describe('delivery transition conditions', () => {
  const owner = { orderStatus: 'READY', role: 'OWNER' } as const;

  it('dispatch (first or again) needs a READY order', () => {
    for (const from of ['PENDING', 'FAILED'] as const) {
      expect(checkDeliveryTransition(from, 'DISPATCHED', owner).ok).toBe(true);
      expect(
        checkDeliveryTransition(from, 'DISPATCHED', { ...owner, orderStatus: 'PREPARING' }),
      ).toMatchObject({
        code: 'INVALID_TRANSITION',
      });
    }
  });

  it('FAILED needs a reason', () => {
    expect(checkDeliveryTransition('DISPATCHED', 'FAILED', owner)).toMatchObject({
      code: 'REASON_REQUIRED',
    });
    expect(
      checkDeliveryTransition('DISPATCHED', 'FAILED', { ...owner, reason: 'Not home' }).ok,
    ).toBe(true);
  });

  it('DELIVERED → RETURNED is an owner correction with a reason', () => {
    const completed = { orderStatus: 'COMPLETED', reason: 'Damaged' } as const;
    expect(
      checkDeliveryTransition('DELIVERED', 'RETURNED', { ...completed, role: 'OWNER' }).ok,
    ).toBe(true);
    expect(
      checkDeliveryTransition('DELIVERED', 'RETURNED', { ...completed, role: 'STAFF' }),
    ).toMatchObject({
      code: 'OWNER_ONLY',
    });
    expect(
      checkDeliveryTransition('DELIVERED', 'RETURNED', {
        ...completed,
        role: 'OWNER',
        reason: ' ',
      }),
    ).toMatchObject({ code: 'REASON_REQUIRED' });
  });

  it('FAILED → RETURNED needs no reason', () => {
    expect(checkDeliveryTransition('FAILED', 'RETURNED', owner).ok).toBe(true);
  });

  it('lists the actions to show', () => {
    expect(allowedDeliveryTransitions('DISPATCHED', owner)).toEqual(['DELIVERED', 'FAILED']);
    expect(allowedDeliveryTransitions('PENDING', { ...owner, orderStatus: 'CONFIRMED' })).toEqual(
      [],
    );
    expect(
      allowedDeliveryTransitions('DELIVERED', { orderStatus: 'COMPLETED', role: 'STAFF' }),
    ).toEqual([]);
  });
});

// ---------- COD ----------

const COD_ALLOWED: Record<CodStatus, readonly CodStatus[]> = {
  NOT_APPLICABLE: ['PENDING'],
  PENDING: ['COLLECTED', 'NOT_APPLICABLE'],
  COLLECTED: ['SETTLED', 'NOT_APPLICABLE'],
  SETTLED: [],
};

describe('COD transitions: every pair', () => {
  it.each(pairs(COD_STATUSES, COD_ALLOWED))('%s → %s allowed: %s', (from, to, allowed) => {
    expect(isCodTransitionAllowed(from, to)).toBe(allowed);
  });
});

describe('COD triggers', () => {
  it.each([
    ['NOT_APPLICABLE', 'ORDER_SAVED_AS_COD', 'PENDING'],
    ['PENDING', 'DELIVERED', 'COLLECTED'],
    ['COLLECTED', 'SETTLED', 'SETTLED'],
    ['PENDING', 'ORDER_CANCELLED_OR_RETURNED', 'NOT_APPLICABLE'],
    ['COLLECTED', 'ORDER_CANCELLED_OR_RETURNED', 'NOT_APPLICABLE'],
  ] as const)('%s + %s → %s', (from, trigger, to) => {
    expect(nextCodStatus(from, trigger)).toBe(to);
  });

  it.each([
    ['NOT_APPLICABLE', 'DELIVERED'],
    ['PENDING', 'SETTLED'], // can't settle before the courier has it
    ['COLLECTED', 'DELIVERED'],
    ['SETTLED', 'ORDER_CANCELLED_OR_RETURNED'], // settled money stays settled
    ['SETTLED', 'SETTLED'],
  ] as const)('%s + %s changes nothing', (from, trigger) => {
    expect(nextCodStatus(from, trigger)).toBeNull();
  });
});
