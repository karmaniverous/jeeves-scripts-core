/**
 * @module runnables/registry-scheduled
 *
 * Core's scheduled runnables: every core runnable with a manifest in
 * `jobs/<domain>.json`, which jeeves-runner runs (Decisions 4, 40, 49).
 * Entries only; {@link coreJobs} in `runnables/registry` joins them with the
 * on-demand runnables. Importing this module imports no runnable.
 */

import type { RegistryEntry } from './registry.js';

/** Core runnables with a manifest, by domain then id. */
export const scheduledJobs: readonly RegistryEntry[] = [
  {
    id: 'admin-collect-token-metrics',
    domain: 'admin',
    module: 'admin/collect-token-metrics',
    load: () => import('../admin/collect-token-metrics.js'),
  },
  {
    id: 'admin-refresh-token-rates',
    domain: 'admin',
    module: 'admin/refresh-token-rates',
    load: () => import('../admin/refresh-token-rates.js'),
  },
  {
    id: 'admin-refresh-sessions',
    domain: 'admin',
    module: 'admin/session-refresh',
    load: () => import('../admin/session-refresh.js'),
  },
  {
    id: 'admin-check-qdrant-health',
    domain: 'admin',
    module: 'admin/qdrant-health-check',
    load: () => import('../admin/qdrant-health-check.js'),
  },
  {
    id: 'admin-sweep-orphaned-tmp',
    domain: 'admin',
    module: 'admin/sweep-orphaned-tmp',
    load: () => import('../admin/sweep-orphaned-tmp.js'),
  },
  {
    id: 'calendar-poll',
    domain: 'calendar',
    module: 'calendar/poll',
    load: () => import('../calendar/poll.js'),
  },
  {
    id: 'email-backfill-historical',
    domain: 'email',
    module: 'email/google-workspace/backfill-historical',
    load: () => import('../email/google-workspace/backfill-historical.js'),
  },
  {
    id: 'email-respond',
    domain: 'email',
    module: 'email/google-workspace/respond',
    load: () => import('../email/google-workspace/respond.js'),
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
    id: 'email-poll',
    domain: 'email',
    module: 'email/poll',
    load: () => import('../email/poll.js'),
  },
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
    id: 'github-sync-files',
    domain: 'github',
    module: 'github/sync-files',
    load: () => import('../github/sync-files.js'),
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
  {
    id: 'google-drive-sync',
    domain: 'google-drive',
    module: 'google-drive/sync',
    load: () => import('../google-drive/sync.js'),
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
  {
    id: 'library-sync-mirrors',
    domain: 'library',
    module: 'library/sync-mirrors',
    load: () => import('../library/sync-mirrors.js'),
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
  {
    id: 'punch-list-harvest',
    domain: 'punch-list',
    module: 'punch-list/harvest/job',
    load: () => import('../punch-list/harvest/job.js'),
  },
  {
    id: 'punch-list-refresh-status',
    domain: 'punch-list',
    module: 'punch-list/status/job',
    load: () => import('../punch-list/status/job.js'),
  },
  {
    id: 'slack-poll',
    domain: 'slack',
    module: 'slack/poll',
    load: () => import('../slack/poll.js'),
  },
  {
    id: 'x-drain-queues',
    domain: 'x',
    module: 'x/drain-queues',
    load: () => import('../x/drain-queues.js'),
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
];
