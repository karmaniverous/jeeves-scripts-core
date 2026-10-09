/**
 * @module config/pipeline-accessors
 *
 * Typed accessors over `jeeves-scripts.json`'s `pipeline` block — ported
 * from `jeeves-scripts-template` `src/lib/pipeline-config.ts` (template
 * `main` at `322054c`) as functions of the loaded config instead of a
 * standalone cached file load.
 */

import { loadConfig, type LoadConfigOptions } from './loader.js';
import type { AccountConfig, PipelineConfig } from './schema.js';

const requirePipeline = (options: LoadConfigOptions): PipelineConfig => {
  const config = loadConfig(options);
  if (!config.pipeline) {
    throw new Error(
      'jeeves-scripts.json has no "pipeline" block, but a pipeline accessor was called.',
    );
  }
  return config.pipeline;
};

/** The loaded config's `pipeline` block. */
export const pipeline = (options: LoadConfigOptions = {}): PipelineConfig =>
  requirePipeline(options);

/** Get a ref value by dotted key, throws if missing. */
export const getRef = (
  key: string,
  options: LoadConfigOptions = {},
): string => {
  const config = requirePipeline(options);
  if (!Object.prototype.hasOwnProperty.call(config.refs, key)) {
    throw new Error(`Missing pipeline config ref: ${key}`);
  }
  return config.refs[key];
};

/**
 * Safe ref accessor — returns empty string instead of throwing when the
 * key is missing. Use in prerequisite guards where you need to check
 * whether a ref is configured without crashing.
 */
export const tryGetRef = (
  key: string,
  options: LoadConfigOptions = {},
): string => {
  try {
    return getRef(key, options);
  } catch {
    return '';
  }
};

/** Accounts that have calendar config. */
export const getCalendarAccounts = (
  options: LoadConfigOptions = {},
): AccountConfig[] =>
  requirePipeline(options).accounts.filter((a) => a.calendar);

/** Email addresses of accounts with emailPolling enabled. */
export const getEmailAccounts = (options: LoadConfigOptions = {}): string[] =>
  requirePipeline(options)
    .accounts.filter((a) => a.emailPolling)
    .map((a) => a.email);

/**
 * Email addresses served by gog (Gmail / Google Workspace), deduplicated:
 * emailPolling accounts without an `imap` block, plus
 * `emailConfig.backfill.accounts`. Backfill feeds the same `email-pending`
 * and `email-updates` queues, so the gog consumers must run for
 * backfill-only accounts too.
 */
export const getGmailAccounts = (options: LoadConfigOptions = {}): string[] => {
  const config = requirePipeline(options);
  const polled = config.accounts
    .filter((a) => a.emailPolling && !a.imap)
    .map((a) => a.email);
  return [
    ...new Set([...polled, ...(config.emailConfig.backfill?.accounts ?? [])]),
  ];
};

/**
 * Every configured bucket name, deduplicated: `buckets.priority` order
 * first, then any bucket that appears only in `buckets.domains`. Bucket
 * names double as Gmail labels.
 */
export const getBucketNames = (options: LoadConfigOptions = {}): string[] => {
  const { buckets } = requirePipeline(options);
  return [
    ...new Set([...buckets.priority, ...buckets.domains.map((d) => d.bucket)]),
  ];
};

/** Match a domain to a bucket name, or null if no match. */
export const getBucketForDomain = (
  domain: string,
  options: LoadConfigOptions = {},
): string | null => {
  const d = domain.toLowerCase();
  for (const entry of requirePipeline(options).buckets.domains) {
    if (entry.pattern.toLowerCase() === d) return entry.bucket;
  }
  return null;
};

/** Bucket name → priority index. Lower = higher priority. */
export const getBucketPriority = (
  options: LoadConfigOptions = {},
): Record<string, number> => {
  const { priority } = requirePipeline(options).buckets;
  const result: Record<string, number> = {};
  for (let i = 0; i < priority.length; i++) {
    result[priority[i]] = i;
  }
  return result;
};
