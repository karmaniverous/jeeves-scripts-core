/**
 * @module cli/list
 *
 * `jeeves-scripts list [glob] [--json]` (Decision 49, R43; design §6):
 * every registered runnable, core and instance, whose id matches `glob`
 * (shell-style `*`, `?` and `[...]` against the id; default `*`), sorted by
 * id. Each shows its source (`core`, `instance` or `override`), its
 * effective schedule and `enabled` after the instance's deltas when it has
 * a manifest, and one line of description: the manifest's, else the one
 * in `defineRunnable`. `--json` adds `domain` and the effective `manifest`
 * (or `null`); jeeves-tools registers runner jobs from it.
 *
 * Reads the instance config, its plugin and its `jobs/*.json`; loads the
 * modules of runnables without a manifest to read their descriptions.
 */

import { loadConfig } from '../config/loader.js';
import { scheduleText } from '../config/schedule-schema.js';
import { formatJobHelp } from '../runnables/job-help.js';
import { type JobManifest, readCoreManifests } from '../runnables/manifest.js';
import { loadJob } from '../runnables/registry.js';
import {
  readInstanceManifests,
  registeredManifests,
  type Runnable,
  type RunnableSource,
} from '../runnables/runnables.js';
import {
  registerInstance,
  type RegisterOptions,
  resolveRunnable,
} from './run.js';

/** One `list` entry (a `--json` element). */
export interface ListEntry {
  /** Runnable id. */
  id: string;
  /** Where its code comes from. */
  source: RunnableSource;
  /** Its domain. */
  domain: string;
  /** Effective schedule, or `null` without a manifest. */
  schedule: JobManifest['schedule'] | null;
  /** Effective `enabled`, or `null` without a manifest. */
  enabled: boolean | null;
  /** The manifest's description, else the `defineRunnable` one. */
  description: string;
  /** The effective manifest after deltas, or `null`. */
  manifest: JobManifest | null;
}

/** Seams for tests. */
export interface ListOptions extends RegisterOptions {
  /** Core's manifests. Default: core's shipped `jobs/`. */
  coreManifests?: readonly JobManifest[];
}

/**
 * Register an instance (plugin load and registration, {@link registerInstance})
 * and resolve every runnable's effective manifest: what `list` and
 * `config check` validate.
 *
 * @throws On a plugin load or registration error, an invalid manifest or
 *   an invalid delta.
 */
export const registerWithManifests = async (
  root: string,
  options: ListOptions = {},
): Promise<{ runnables: Runnable[]; manifests: Map<string, JobManifest> }> => {
  const runnables = await registerInstance(root, options);
  const manifests = registeredManifests({
    runnables,
    coreManifests: options.coreManifests ?? readCoreManifests(),
    instanceManifests: readInstanceManifests(root),
    deltas: loadConfig().jobs,
  });
  return { runnables, manifests };
};

/**
 * The `run <id> --help` text: usage, description, declared flags and the
 * effective manifest. Loads the runnable's module but runs nothing. When
 * the manifests cannot be resolved (e.g. no instance config), the help
 * still prints, without the manifest.
 *
 * @throws On a plugin load or registration error, or an unknown id.
 */
export const jobHelp = async (
  root: string,
  id: string,
  options: ListOptions = {},
): Promise<string> => {
  let runnables: Runnable[];
  let manifest: JobManifest | undefined;
  try {
    const registered = await registerWithManifests(root, options);
    runnables = registered.runnables;
    manifest = registered.manifests.get(id);
  } catch {
    runnables = await registerInstance(root, options);
  }
  const job = await resolveRunnable(runnables, id).load();
  return formatJobHelp(job, manifest);
};

/** A shell-style glob (`*`, `?`, `[...]`) as an anchored RegExp. */
export const globToRegExp = (glob: string): RegExp => {
  let source = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob.charAt(i);
    const close = c === '[' ? glob.indexOf(']', i + 2) : -1;
    if (c === '*') source += '.*';
    else if (c === '?') source += '.';
    else if (close > 0) {
      const body = glob.slice(i + 1, close);
      source += `[${body.startsWith('!') ? `^${body.slice(1)}` : body}]`;
      i = close;
    } else source += c.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
};

const describe = async (r: Runnable): Promise<string> => {
  const job =
    r.source === 'override' && r.core ? await loadJob(r.core) : await r.load();
  return job.description ?? '';
};

/**
 * The `list` entries for an instance root.
 *
 * @throws On a registration error, an invalid manifest or an invalid delta.
 */
export const listRunnables = async (
  root: string,
  glob = '*',
  options: ListOptions = {},
): Promise<ListEntry[]> => {
  const { runnables, manifests } = await registerWithManifests(root, options);
  const match = globToRegExp(glob);
  const entries: ListEntry[] = [];
  for (const r of runnables.filter((x) => match.test(x.id))) {
    const manifest = manifests.get(r.id) ?? null;
    entries.push({
      id: r.id,
      source: r.source,
      domain: r.domain,
      schedule: manifest?.schedule ?? null,
      enabled: manifest?.enabled ?? null,
      description: manifest?.description ?? (await describe(r)),
      manifest,
    });
  }
  return entries;
};

/** The `list` table: a header and one aligned row per entry. */
export const formatList = (entries: readonly ListEntry[]): string[] => {
  const rows = [
    ['id', 'source', 'schedule', 'enabled', 'description'],
    ...entries.map((e) => [
      e.id,
      e.source,
      e.schedule === null ? '' : scheduleText(e.schedule),
      e.enabled === null ? '' : String(e.enabled),
      e.description,
    ]),
  ];
  const widths = [0, 1, 2, 3].map((i) =>
    Math.max(...rows.map((row) => (row[i] ?? '').length)),
  );
  return rows.map((row) =>
    row
      .map((cell, i) => (i < 4 ? cell.padEnd(widths[i] ?? 0) : cell))
      .join('  ')
      .trimEnd(),
  );
};
