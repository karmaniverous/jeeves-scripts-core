/**
 * @module lib/fs-errors
 *
 * Classify Node file-system errors.
 */

/** True for a Node error whose code is `ENOENT` (the path does not exist). */
export const isEnoent = (err: unknown): boolean =>
  err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT';
