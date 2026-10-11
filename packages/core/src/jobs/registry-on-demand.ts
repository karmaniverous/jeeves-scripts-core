/**
 * @module jobs/registry-on-demand
 *
 * Core's on-demand runnables: core runnables without a manifest, run by a
 * person, the assistant or a jeeves-server webhook (drains, backfills,
 * X actions, `people-propose`, conversions; Decisions 49, 50, 51). Each
 * describes itself in `defineJob`. Entries only; importing this module
 * imports no runnable.
 */

import type { RegistryEntry } from './registry.js';

/** Core runnables without a manifest, by domain then id. */
export const onDemandJobs: readonly RegistryEntry[] = [
  {
    id: 'admin-regenerate-token-metrics',
    domain: 'admin',
    module: 'admin/regenerate-token-metrics',
    load: () => import('../admin/regenerate-token-metrics.js'),
  },
  {
    id: 'convert-docx-to-md',
    domain: 'convert',
    module: 'convert/convert-docx-to-md',
    load: () => import('../convert/convert-docx-to-md.js'),
  },
  {
    id: 'convert-pdf-to-md',
    domain: 'convert',
    module: 'convert/convert-pdf-to-md',
    load: () => import('../convert/convert-pdf-to-md.js'),
  },
  {
    id: 'email-inventory',
    domain: 'email',
    module: 'email/google-workspace/inventory',
    load: () => import('../email/google-workspace/inventory.js'),
  },
  {
    id: 'email-apply-labels',
    domain: 'email',
    module: 'email/email-apply-labels',
    load: () => import('../email/email-apply-labels.js'),
  },
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
    id: 'people-propose',
    domain: 'people',
    module: 'people/people-propose',
    load: () => import('../people/people-propose.js'),
  },
  {
    id: 'x-like',
    domain: 'x',
    module: 'x/like',
    load: () => import('../x/like.js'),
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
