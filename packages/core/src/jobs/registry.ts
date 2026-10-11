/**
 * @module jobs/registry
 *
 * The core job registry (Decisions 4, 40): every core job id with its
 * domain, its module path under `src/` and a lazy loader. Listing or
 * resolving jobs never imports a job module; {@link loadJob} imports one
 * and checks it declares the id it is registered under.
 *
 * Ids are the public contract (`jeeves-scripts run <id>`): the scheduled
 * jobs keep the ids of their manifests in `jobs/<domain>.json`; the
 * manual and event-driven jobs (drains, backfills, converters, X actions)
 * have no manifest.
 */

import { isJobModule, type JobModule } from './define-job.js';

/** One registered job. */
export interface RegistryEntry {
  /** Job id. */
  id: string;
  /** Domain (matches the manifest file and the job's `domain`). */
  domain: string;
  /** Module path under `src/` (and `dist/`), without extension. */
  module: string;
  /** Imports the job module. */
  load: () => Promise<{ default: unknown }>;
}

/** Every core job. */
export const coreJobs: readonly RegistryEntry[] = [
  // admin
  {
    id: 'collect-token-metrics',
    domain: 'admin',
    module: 'admin/collect-token-metrics',
    load: () => import('../admin/collect-token-metrics.js'),
  },
  {
    id: 'refresh-token-rates',
    domain: 'admin',
    module: 'admin/refresh-token-rates',
    load: () => import('../admin/refresh-token-rates.js'),
  },
  {
    id: 'regenerate-token-metrics',
    domain: 'admin',
    module: 'admin/regenerate-token-metrics',
    load: () => import('../admin/regenerate-token-metrics.js'),
  },
  {
    id: 'session-refresh',
    domain: 'admin',
    module: 'admin/session-refresh',
    load: () => import('../admin/session-refresh.js'),
  },
  // calendar
  {
    id: 'calendar-poll',
    domain: 'calendar',
    module: 'calendar/poll',
    load: () => import('../calendar/poll.js'),
  },
  // convert
  {
    id: 'convert-docx-to-md',
    domain: 'convert',
    module: 'convert/docx-to-md',
    load: () => import('../convert/docx-to-md.js'),
  },
  {
    id: 'convert-pdf-to-md',
    domain: 'convert',
    module: 'convert/pdf-to-md',
    load: () => import('../convert/pdf-to-md.js'),
  },
  // core
  {
    id: 'qdrant-health-check',
    domain: 'core',
    module: 'core/qdrant-health-check',
    load: () => import('../core/qdrant-health-check.js'),
  },
  {
    id: 'sweep-orphaned-tmp',
    domain: 'core',
    module: 'core/sweep-orphaned-tmp',
    load: () => import('../core/sweep-orphaned-tmp.js'),
  },
  // dispatchers
  {
    id: 'generate-daily-digest',
    domain: 'dispatchers',
    module: 'dispatchers/daily-digest',
    load: () => import('../dispatchers/daily-digest.js'),
  },
  // email
  {
    id: 'email-backfill-historical',
    domain: 'email',
    module: 'email/google-workspace/backfill-historical',
    load: () => import('../email/google-workspace/backfill-historical.js'),
  },
  {
    id: 'email-download',
    domain: 'email',
    module: 'email/google-workspace/download',
    load: () => import('../email/google-workspace/download.js'),
  },
  {
    id: 'email-drain-updates',
    domain: 'email',
    module: 'email/google-workspace/drain-updates',
    load: () => import('../email/google-workspace/drain-updates.js'),
  },
  {
    id: 'email-inventory',
    domain: 'email',
    module: 'email/google-workspace/inventory',
    load: () => import('../email/google-workspace/inventory.js'),
  },
  {
    id: 'email-poll',
    domain: 'email',
    module: 'email/poll',
    load: () => import('../email/poll.js'),
  },
  // github
  {
    id: 'github-build-registry',
    domain: 'github',
    module: 'github/build-registry',
    load: () => import('../github/build-registry.js'),
  },
  {
    id: 'github-drain-collabs',
    domain: 'github',
    module: 'github/drain-collabs',
    load: () => import('../github/drain-collabs.js'),
  },
  {
    id: 'github-poll-collabs',
    domain: 'github',
    module: 'github/poll-collabs',
    load: () => import('../github/poll-collabs.js'),
  },
  {
    id: 'github-sync-issues',
    domain: 'github',
    module: 'github/sync-issues',
    load: () => import('../github/sync-issues.js'),
  },
  {
    id: 'github-sync-repos',
    domain: 'github',
    module: 'github/sync-repos',
    load: () => import('../github/sync-repos.js'),
  },
  {
    id: 'github-watch',
    domain: 'github',
    module: 'github/watch',
    load: () => import('../github/watch.js'),
  },
  // google-drive
  {
    id: 'google-drive-sync',
    domain: 'google-drive',
    module: 'google-drive/sync',
    load: () => import('../google-drive/sync.js'),
  },
  // jira
  {
    id: 'jira-backfill',
    domain: 'jira',
    module: 'jira/backfill',
    load: () => import('../jira/backfill.js'),
  },
  {
    id: 'jira-drain',
    domain: 'jira',
    module: 'jira/drain',
    load: () => import('../jira/drain.js'),
  },
  {
    id: 'jira-refresh-fields',
    domain: 'jira',
    module: 'jira/refresh-fields',
    load: () => import('../jira/refresh-fields.js'),
  },
  {
    id: 'jira-sort-backlog',
    domain: 'jira',
    module: 'jira/sort-backlog',
    load: () => import('../jira/sort-backlog.js'),
  },
  // linear
  {
    id: 'linear-backfill',
    domain: 'linear',
    module: 'linear/backfill',
    load: () => import('../linear/backfill.js'),
  },
  {
    id: 'linear-drain',
    domain: 'linear',
    module: 'linear/drain',
    load: () => import('../linear/drain.js'),
  },
  {
    id: 'linear-sync-comments',
    domain: 'linear',
    module: 'linear/sync-comments',
    load: () => import('../linear/sync-comments.js'),
  },
  {
    id: 'linear-sync-issues',
    domain: 'linear',
    module: 'linear/sync-issues',
    load: () => import('../linear/sync-issues.js'),
  },
  // meetings
  {
    id: 'meetings-extract',
    domain: 'meetings',
    module: 'meetings/extract',
    load: () => import('../meetings/extract.js'),
  },
  {
    id: 'meetings-fetch-notes',
    domain: 'meetings',
    module: 'meetings/fetch-notes',
    load: () => import('../meetings/fetch-notes.js'),
  },
  {
    id: 'meetings-ingest-notion',
    domain: 'meetings',
    module: 'meetings/ingest-notion',
    load: () => import('../meetings/ingest-notion.js'),
  },
  // meta
  {
    id: 'meta-disable-old',
    domain: 'meta',
    module: 'meta/disable-old-meta',
    load: () => import('../meta/disable-old-meta.js'),
  },
  {
    id: 'meta-sweep-duplicates',
    domain: 'meta',
    module: 'meta/sweep-duplicates',
    load: () => import('../meta/sweep-duplicates.js'),
  },
  // slack
  {
    id: 'slack-poll',
    domain: 'slack',
    module: 'slack/poll',
    load: () => import('../slack/poll.js'),
  },
  // x
  {
    id: 'x-drain-queues',
    domain: 'x',
    module: 'x/drain-queues',
    load: () => import('../x/drain-queues.js'),
  },
  {
    id: 'x-like',
    domain: 'x',
    module: 'x/like',
    load: () => import('../x/like.js'),
  },
  {
    id: 'x-poll-bookmarks',
    domain: 'x',
    module: 'x/poll-bookmarks',
    load: () => import('../x/poll-bookmarks.js'),
  },
  {
    id: 'x-poll-feed',
    domain: 'x',
    module: 'x/poll-feed',
    load: () => import('../x/poll-feed.js'),
  },
  {
    id: 'x-poll-likes',
    domain: 'x',
    module: 'x/poll-likes',
    load: () => import('../x/poll-likes.js'),
  },
  {
    id: 'x-poll-mentions',
    domain: 'x',
    module: 'x/poll-mentions',
    load: () => import('../x/poll-mentions.js'),
  },
  {
    id: 'x-poll-posts',
    domain: 'x',
    module: 'x/poll-posts',
    load: () => import('../x/poll-posts.js'),
  },
  {
    id: 'x-post',
    domain: 'x',
    module: 'x/post',
    load: () => import('../x/post.js'),
  },
  {
    id: 'x-refresh-token',
    domain: 'x',
    module: 'x/refresh-token',
    load: () => import('../x/refresh-token.js'),
  },
  {
    id: 'x-repost',
    domain: 'x',
    module: 'x/repost',
    load: () => import('../x/repost.js'),
  },
];

/** The registry entry for `id`, if core has that job. */
export const findJob = (
  id: string,
  registry: readonly RegistryEntry[] = coreJobs,
): RegistryEntry | undefined => registry.find((e) => e.id === id);

/**
 * The registry entry whose module is `script` (an instance manifest's
 * `src/<domain>/<job>.ts` path), if any: the transitional alias for
 * instance runner jobs whose ids differ from core's (Decision 40).
 */
export const findJobByScript = (
  script: string,
  registry: readonly RegistryEntry[] = coreJobs,
): RegistryEntry | undefined => {
  const module = script
    .replace(/\\/g, '/')
    .replace(/^(\.\/)?src\//, '')
    .replace(/\.[cm]?[jt]s$/, '');
  return registry.find((e) => e.module === module);
};

/**
 * Import a registered job and check it is a `defineJob` module with the
 * registered id and domain.
 *
 * @throws When the module's default export is not a job, or declares a
 *   different id or domain.
 */
export const loadJob = async (entry: RegistryEntry): Promise<JobModule> => {
  const job = (await entry.load()).default;
  if (!isJobModule(job))
    throw new Error(
      `Job "${entry.id}": ${entry.module} does not default-export defineJob(...).`,
    );
  if (job.id !== entry.id || job.domain !== entry.domain)
    throw new Error(
      `Job "${entry.id}" (${entry.domain}): ${entry.module} declares "${job.id}" (${job.domain}).`,
    );
  return job;
};
