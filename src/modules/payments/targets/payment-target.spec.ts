import { PaymentTargetType } from '../../../../generated/prisma/enums.js';
import { type PaymentTarget, paymentTargetRegistry } from './payment-target.js';

const target = (type: PaymentTargetType) => ({ type }) as PaymentTarget;
const ALL = Object.values(PaymentTargetType);

describe('paymentTargetRegistry', () => {
  it('maps every type to its target', () => {
    const registry = paymentTargetRegistry(ALL, ALL.map(target));
    for (const type of ALL) expect(registry[type].type).toBe(type);
  });

  it('refuses at boot when a type has no target', () => {
    // Otherwise the first member to pay for it would find out instead.
    expect(() => paymentTargetRegistry(ALL, ALL.slice(1).map(target))).toThrow(
      `No payment target is registered for ${ALL[0]}`,
    );
  });

  it('refuses a type registered twice, which would make one of them unreachable', () => {
    const first = ALL[0] as PaymentTargetType;
    expect(() => paymentTargetRegistry(ALL, [...ALL.map(target), target(first)])).toThrow(
      'registered twice',
    );
  });
});
