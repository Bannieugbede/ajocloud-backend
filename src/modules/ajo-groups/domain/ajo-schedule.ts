import { UnprocessableEntityException } from '@nestjs/common';

export type AjoFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY';

export interface SlotInput {
  readonly id: string;
  readonly position: number;
}

export interface RotationCycle {
  readonly sequence: number;
  readonly contributionDueAt: Date;
  readonly contributionOpensAt: Date;
  readonly contributionClosesAt: Date;
  readonly graceEndsAt: Date;
  readonly payoutEligibilityCutoffAt: Date;
  readonly payoutDueAt: Date;
  readonly payoutProcessingEndsAt: Date;
  readonly payoutSlotId: string;
  readonly contributionAmountMinor: bigint;
  readonly payoutUnitCount: number;
  readonly payoutAmountMinor: bigint;
}

const MAX_SLOTS = 1_000;

export function assertAjoGroupBounds(startDate: Date, endDate: Date, maxSlots: number): void {
  if (!Number.isInteger(maxSlots) || maxSlots < 2 || maxSlots > MAX_SLOTS) {
    throw new UnprocessableEntityException('Group capacity must be between 2 and 1,000 slots');
  }
  if (endDate <= startDate) {
    throw new UnprocessableEntityException('Group end date must be after its start date');
  }
  const maximumEnd = new Date(startDate);
  maximumEnd.setUTCFullYear(maximumEnd.getUTCFullYear() + 1);
  if (endDate > maximumEnd) {
    throw new UnprocessableEntityException('Ajo groups cannot last longer than 12 months');
  }
}

export function generateRotationSchedule(input: {
  readonly slots: readonly SlotInput[];
  readonly startDate: Date;
  readonly endDate: Date;
  readonly frequency: AjoFrequency;
  readonly contributionAmountMinor: bigint;
  readonly contributionOpenOffsetMinutes?: number;
  readonly contributionCloseOffsetMinutes?: number;
  readonly gracePeriodMinutes?: number;
  readonly payoutEligibilityCutoffMinutes?: number;
  readonly payoutOffsetMinutes?: number;
  readonly payoutProcessingWindowMinutes?: number;
}): readonly RotationCycle[] {
  if (input.slots.length < 2 || input.slots.length > MAX_SLOTS) {
    throw new UnprocessableEntityException('A locked group requires 2 to 1,000 slots');
  }
  if (input.contributionAmountMinor <= 0n) {
    throw new UnprocessableEntityException('Contribution amount must be positive');
  }
  const ordered = [...input.slots].sort((left, right) => left.position - right.position);
  const positions = new Set(ordered.map((slot) => slot.position));
  if (
    positions.size !== ordered.length ||
    ordered.some((slot, index) => slot.position !== index + 1)
  ) {
    throw new UnprocessableEntityException('Slot positions must be unique and contiguous');
  }

  const payoutAmountMinor = input.contributionAmountMinor * BigInt(ordered.length);
  return ordered.map((slot, index) => {
    const dueAt = addFrequency(input.startDate, input.frequency, index);
    if (dueAt > input.endDate) {
      throw new UnprocessableEntityException(
        'The rotation cannot complete within the configured dates',
      );
    }
    const contributionOpensAt = addMinutes(dueAt, -(input.contributionOpenOffsetMinutes ?? 0));
    const contributionClosesAt = addMinutes(dueAt, input.contributionCloseOffsetMinutes ?? 0);
    const graceEndsAt = addMinutes(contributionClosesAt, input.gracePeriodMinutes ?? 0);
    const payoutEligibilityCutoffAt = addMinutes(dueAt, input.payoutEligibilityCutoffMinutes ?? 0);
    const payoutDueAt = addMinutes(dueAt, input.payoutOffsetMinutes ?? 0);
    return {
      sequence: index + 1,
      contributionDueAt: dueAt,
      contributionOpensAt,
      contributionClosesAt,
      graceEndsAt,
      payoutEligibilityCutoffAt,
      payoutDueAt,
      payoutProcessingEndsAt: addMinutes(payoutDueAt, input.payoutProcessingWindowMinutes ?? 1_440),
      payoutSlotId: slot.id,
      payoutUnitCount: 1,
      contributionAmountMinor: input.contributionAmountMinor,
      payoutAmountMinor,
    };
  });
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function addFrequency(start: Date, frequency: AjoFrequency, offset: number): Date {
  const date = new Date(start);
  if (frequency === 'DAILY') date.setUTCDate(date.getUTCDate() + offset);
  if (frequency === 'WEEKLY') date.setUTCDate(date.getUTCDate() + offset * 7);
  if (frequency === 'MONTHLY') {
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + offset);
    const lastDay = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
    ).getUTCDate();
    date.setUTCDate(Math.min(day, lastDay));
  }
  return date;
}
