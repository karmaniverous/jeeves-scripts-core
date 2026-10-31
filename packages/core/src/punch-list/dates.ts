/**
 * @module punch-list/dates
 *
 * Calendar-day arithmetic for the punch list: today's date in the
 * configured zone and day differences between `YYYY-MM-DD`
 * dates. Pure.
 */

/** `YYYY-MM-DD` for `now` in `timeZone`. */
export const dayIn = (timeZone: string, now: Date = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

const toUtc = (day: string): number => Date.parse(`${day}T00:00:00Z`);

/** Whole days from `from` to `to` (both `YYYY-MM-DD`); negative when `to` is earlier. */
export const daysBetween = (from: string, to: string): number =>
  Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
