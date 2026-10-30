/**
 * @module config/pointer
 *
 * The instance repo's `jeeves-scripts.json` pointer (#57, Decision 68):
 * `{ "$schema": "...", "config": "<absolute config directory>" }`. The
 * full config lives in `<config>/config.json`, outside the repo, so instance
 * data changes without a PR.
 */

import path from 'node:path';

import { z } from 'zod';

/** The full config's file name inside the config directory. */
export const CONFIG_FILE_NAME = 'config.json';

/**
 * Whether `dir` is a fully absolute directory on `platform`: a drive
 * (`J:/...`, `J:\\...`) or UNC path on Windows, where a drive-less `/x`
 * depends on the current drive; a `/` path elsewhere (#62 review).
 */
export const isAbsoluteDir = (
  dir: string,
  platform: NodeJS.Platform = process.platform,
): boolean =>
  platform === 'win32'
    ? /^[A-Za-z]:[\\/]/.test(dir) || /^[\\/]{2}[^\\/]/.test(dir)
    : dir.startsWith('/');

/** A `jeeves-scripts.json` that points at the config directory. */
export const pointerSchema = z.strictObject({
  /** Editor schema reference (`.../schema/pointer.schema.json`). */
  $schema: z.string().optional(),
  /** Absolute path of the config directory holding `config.json`. */
  config: z
    .string()
    .min(1)
    .refine((dir) => isAbsoluteDir(dir), {
      message: 'must be an absolute directory',
    }),
});

/** A parsed pointer. */
export type Pointer = z.infer<typeof pointerSchema>;

/** The full config file a pointer names. */
export const pointedConfigPath = (pointer: Pointer): string =>
  path.join(pointer.config, CONFIG_FILE_NAME);
