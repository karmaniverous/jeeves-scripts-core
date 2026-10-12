import { validateSchedule } from '@karmaniverous/jeeves-runner';
import { describe, expect, it } from 'vitest';

import { jobDeltaSchema } from './jobs-schema.js';
import { scheduleSchema, scheduleText } from './schedule-schema.js';

/**
 * The runner's schedule forms (its job skill, CLI reference and schedule
 * utilities), each with the verdict the runner gives it. Every case is
 * checked twice: against the pinned verdict, and against the runner's own
 * `validateSchedule`, so a runner change shows up here.
 */
const cases: [string, string | Record<string, unknown>, boolean][] = [
  ['cron, five fields', '*/5 * * * *', true],
  ['cron, fixed time', '0 23 * * *', true],
  ['cron, stepped hours', '17 */6 * * *', true],
  ['cron, six fields (seconds)', '0 0 9 * * 1', true],
  ['cron nickname', '@daily', true],
  ['not a cron expression', 'not a cron', false],
  ['flat RRStack', { freq: 'minutely', interval: 11, timezone: 'UTC' }, true],
  [
    'flat RRStack with weekdays',
    {
      freq: 'weekly',
      byweekday: [0, 2],
      byhour: 8,
      byminute: 30,
      timezone: 'America/Chicago',
    },
    true,
  ],
  ['flat RRStack without timezone', { freq: 'hourly', interval: 4 }, false],
  ['flat RRStack, bad zone', { freq: 'daily', timezone: 'Nope/Zone' }, false],
  ['flat RRStack, bad freq', { freq: 'sometimes', timezone: 'UTC' }, false],
  [
    'full RRStack',
    {
      timezone: 'Asia/Makassar',
      timeUnit: 'ms',
      rules: [{ effect: 'event', options: { freq: 'minutely', interval: 11 } }],
    },
    true,
  ],
  [
    'full RRStack without timezone',
    { rules: [{ effect: 'event', options: { freq: 'daily' } }] },
    false,
  ],
  ['RRStack as a JSON string', '{"freq":"daily","timezone":"UTC"}', true],
  ['empty object', {}, false],
];

describe('scheduleSchema (runner parity)', () => {
  it.each(cases)('%s', (_label, schedule, valid) => {
    expect(validateSchedule(scheduleText(schedule)).valid).toBe(valid);
    expect(scheduleSchema.safeParse(schedule).success).toBe(valid);
  });

  it("reports the runner's message", () => {
    const result = scheduleSchema.safeParse('not a cron');
    expect(result.error?.issues[0]?.message).toMatch(
      /^Invalid cron expression: /,
    );
  });

  it('rejects an array and an empty string', () => {
    expect(scheduleSchema.safeParse([]).success).toBe(false);
    expect(scheduleSchema.safeParse('').success).toBe(false);
  });

  it('applies to a delta schedule', () => {
    expect(jobDeltaSchema.safeParse({ schedule: '*/23 * * * *' }).success).toBe(
      true,
    );
    expect(
      jobDeltaSchema.safeParse({ schedule: { freq: 'hourly' } }).success,
    ).toBe(false);
  });
});

describe('scheduleText', () => {
  it('keeps a string and serialises an object', () => {
    expect(scheduleText('0 6 * * *')).toBe('0 6 * * *');
    expect(scheduleText({ freq: 'daily', timezone: 'UTC' })).toBe(
      '{"freq":"daily","timezone":"UTC"}',
    );
  });
});
