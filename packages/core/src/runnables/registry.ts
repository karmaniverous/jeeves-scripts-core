/**
 * @module runnables/registry
 *
 * The core runnable registry (Decisions 4, 40, 49): every core runnable id
 * with its domain, its module path under `src/` and a lazy loader, with or
 * without a manifest, plus core's domain names. Resolving a runnable never
 * imports its module; {@link loadJob} imports one and checks it declares
 * the id it is registered under.
 *
 * Ids are the public contract (`jeeves-scripts run <id>`): the scheduled
 * runnables (`runnables/registry-scheduled`) have manifests in
 * `jobs/<domain>.json`; the on-demand ones (`runnables/registry-on-demand`:
 * drains, backfills, X actions, `people-propose`, ...) have none and
 * describe themselves in `defineRunnable`.
 */

import { isJobModule, type JobModule } from './define-runnable.js';
import { onDemandJobs } from './registry-on-demand.js';
import { scheduledJobs } from './registry-scheduled.js';

/** One registered runnable. */
export interface RegistryEntry {
  /** Runnable id. */
  id: string;
  /** Domain (matches the manifest file and the runnable's `domain`). */
  domain: string;
  /** Module path under `src/` (and `dist/`), without extension. */
  module: string;
  /** Imports the runnable's module. */
  load: () => Promise<{ default: unknown }>;
}

/**
 * Core's domains: its top-level domain source folders (R45). An instance
 * domain never reuses one. `cli`, `config`, `lib`, `presets` and `runnables`
 * are framework folders, not domains.
 */
export const coreDomains: readonly string[] = [
  'admin',
  'calendar',
  'convert',
  'dispatchers',
  'email',
  'github',
  'google-drive',
  'jira',
  'library',
  'linear',
  'meetings',
  'meta',
  'people',
  'slack',
  'x',
];

/** Every core runnable: the scheduled ones, then the on-demand ones. */
export const coreJobs: readonly RegistryEntry[] = [
  ...scheduledJobs,
  ...onDemandJobs,
];

/**
 * Import a registered runnable and check it is a `defineRunnable` module with the
 * registered id and domain.
 *
 * @throws When the module's default export is not a `defineRunnable` module, or declares a
 *   different id or domain.
 */
export const loadJob = async (entry: RegistryEntry): Promise<JobModule> => {
  const job = (await entry.load()).default;
  if (!isJobModule(job))
    throw new Error(
      `Job "${entry.id}": ${entry.module} does not default-export defineRunnable(...).`,
    );
  if (job.id !== entry.id || job.domain !== entry.domain)
    throw new Error(
      `Job "${entry.id}" (${entry.domain}): ${entry.module} declares "${job.id}" (${job.domain}).`,
    );
  return job;
};
