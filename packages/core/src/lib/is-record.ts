/**
 * @module lib/is-record
 *
 * The one `isRecord` type guard for unknown JSON.
 */

/** Whether `v` is a non-null object (indexable by string keys). */
export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;
