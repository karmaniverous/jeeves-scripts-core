/**
 * @module slack/channel-meta/owner
 *
 * The OpenClaw command owner on Slack, the report's default target. OpenClaw
 * lists its owners in `commands.ownerAllowFrom` as `<channel>:<id>` entries
 * (e.g. `slack:U12345678`); the CLI writes the first one when the first DM
 * pairing is approved, so every paired instance has one. The first `slack:`
 * entry with a Slack user id wins (OpenClaw documents no other form; legacy
 * `channel:user:id` entries are rewritten by `openclaw doctor --fix` and
 * are not read). The config file is found the way core finds it
 * (`findInOpenclawConfig`).
 */

import { z } from 'zod';

import { findInOpenclawConfig } from '../../lib/openclaw-config.js';

const ENTRY = /^slack:([UW][A-Z0-9]{2,})$/i;

const ownersSchema = z
  .object({
    commands: z
      .object({ ownerAllowFrom: z.array(z.unknown()).optional() })
      .loose()
      .optional(),
  })
  .loose();

/**
 * The first Slack user among OpenClaw owner entries.
 *
 * @param entries - `commands.ownerAllowFrom`.
 * @returns The user id (upper case), or `undefined` when no entry is a
 *   Slack user.
 */
export function slackOwnerFrom(
  entries: readonly unknown[] | undefined,
): string | undefined {
  for (const entry of entries ?? []) {
    if (typeof entry !== 'string') continue;
    const id = ENTRY.exec(entry.trim())?.[1];
    if (id !== undefined) return id.toUpperCase();
  }
  return undefined;
}

/**
 * The OpenClaw command owner's Slack user id, from the first config file
 * that names one.
 *
 * @returns The user id, or `undefined`.
 */
export const readSlackOwner = (): string | undefined =>
  findInOpenclawConfig((config) =>
    slackOwnerFrom(
      ownersSchema.safeParse(config).data?.commands?.ownerAllowFrom,
    ),
  );
