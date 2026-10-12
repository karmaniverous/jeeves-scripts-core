/**
 * @module config/schedule-schema
 *
 * The schedule of a job manifest or `jobs` delta, accepted exactly as
 * jeeves-runner accepts a job's schedule (Decision 54): validated by the
 * runner's own exported `validateSchedule`, so the forms, fields and time
 * zone handling are the runner's, not a copy of them. Pure; no IO.
 *
 * The runner's forms:
 *
 * - a cron expression (croner: five, six or seven fields, or a nickname
 *   such as `@daily`), evaluated in the runner host's time zone;
 * - an RRStack schedule in the runner's flat form: `freq` and `timezone`
 *   (an IANA zone) plus any RRule option (`interval`, `byhour`,
 *   `byminute`, `byweekday`, ...);
 * - an RRStack schedule in full: `timezone`, optional `timeUnit`, and a
 *   `rules` array (`{ effect, options }`, ...).
 *
 * An RRStack schedule may be written as an object or as its JSON string;
 * the runner stores either as the string ({@link scheduleText}).
 */

import { validateSchedule } from '@karmaniverous/jeeves-runner';
import { z } from 'zod';

/** A schedule as written: a string (cron, or RRStack JSON) or an RRStack object. */
export type ScheduleInput = string | Record<string, unknown>;

/**
 * The string the runner stores for a schedule: a string as written, an
 * object as its JSON (what the runner's job sync does with an object).
 */
export const scheduleText = (schedule: ScheduleInput): string =>
  typeof schedule === 'string' ? schedule : JSON.stringify(schedule);

/**
 * A jeeves-runner schedule (forms in the module doc). Invalid when the
 * runner's `validateSchedule` rejects it; the issue carries the runner's
 * message.
 */
export const scheduleSchema = z
  .union([z.string().min(1), z.record(z.string(), z.unknown())])
  .superRefine((schedule, ctx) => {
    const result = validateSchedule(scheduleText(schedule));
    if (!result.valid) ctx.addIssue({ code: 'custom', message: result.error });
  });
