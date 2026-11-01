/**
 * @module slack/channel-meta/coverage
 *
 * Classifies gathered channels for the report (`channel-meta/report`) and the
 * summary (`channel-meta/summary`): no configured home directory, one missing on
 * disk, one without a seeded meta, and channels whose field was skipped
 * for a given reason. Pure.
 */

import type { ChannelFacts } from './gather.js';
import type { MetaField, SkipReason } from './plan.js';

/** No configured home directory. */
export const noHomeDir = (f: ChannelFacts): boolean => f.homeDir === undefined;

/** A configured home directory missing on disk. */
export const homeDirMissing = (f: ChannelFacts): boolean =>
  f.homeDir !== undefined && !f.homeDirExists;

/** A home directory without a seeded meta. */
export const unseeded = (f: ChannelFacts): boolean =>
  f.homeDir !== undefined && f.homeDirExists && f.meta === undefined;

/**
 * Channels whose field was skipped for a reason.
 *
 * @param facts - The channels.
 * @param field - Which field.
 * @param reason - The skip reason.
 * @returns How many.
 */
export const skipCount = (
  facts: readonly ChannelFacts[],
  field: MetaField,
  reason: SkipReason,
): number =>
  facts.filter(
    (f) => f.plans[field].action === 'skip' && f.plans[field].reason === reason,
  ).length;
