/**
 * @module cli/doctor
 *
 * `jeeves-scripts doctor` (R29, Decisions 27, 49; design §6): an
 * informational report on an instance repo. Lines for the installed core
 * version, the config location and whether it validates, the plugin load,
 * each effective manifest's prerequisite state, and override drift (an
 * override's `writtenFor` differing from the installed core). It reports
 * problems as lines and never throws, so the command always exits 0.
 *
 * A prerequisite's state (Decision 57): `met` or `not met: <reason>` from
 * the runnable's `defineRunnable` prerequisite check when it declares one, else
 * `met` when the manifest has no prerequisite, else `manual: <text>` (set
 * up by a person; no check can tell).
 *
 * Reads the instance config, loads its plugin (as `run` does), reads
 * core's and the instance's manifests, loads each manifest's module and
 * runs its prerequisite check. Runs no job body.
 */

import path from 'node:path';

import { configCheck } from '../config/check.js';
import { CONFIG_PATH_ENV, loadConfig } from '../config/loader.js';
import { jobContext, type JobModule } from '../runnables/define-runnable.js';
import { type JobManifest, readCoreManifests } from '../runnables/manifest.js';
import type { Plugin } from '../runnables/plugin.js';
import {
  buildRunnables,
  readInstanceManifests,
  registeredManifests,
  type Runnable,
} from '../runnables/runnables.js';
import type { ListOptions } from './list.js';
import { loadPlugin, PLUGIN_FILE } from './load-plugin.js';
import { CORE_PACKAGE, coreVersion } from './package-info.js';

/** Seams for tests. */
export interface DoctorOptions extends ListOptions {
  /** The installed core version. Default: the running core's. */
  version?: string;
}

const message = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

const indent = (text: string): string[] =>
  text.split('\n').map((line) => `  ${line}`);

const overrideLines = (plugin: Plugin | undefined, version: string) => {
  const overrides = plugin?.overrides ?? [];
  if (overrides.length === 0) return ['overrides: none'];
  const drifted = overrides.filter((o) => o.writtenFor !== version).length;
  return [
    `overrides: ${String(overrides.length)} (${String(drifted)} written for another core version)`,
    ...overrides.map(
      (o) =>
        `  ${o.job}: written for ${o.writtenFor}${
          o.writtenFor === version
            ? ''
            : `, installed ${version}: DRIFT (recheck ${o.issue})`
        }`,
    ),
  ];
};

/** A manifest's prerequisite state: `met`, `not met: …` or `manual: …`. */
const prerequisiteState = async (
  manifest: JobManifest,
  runnable: Runnable | undefined,
): Promise<string> => {
  let job: JobModule | undefined;
  try {
    job = await runnable?.load();
  } catch (e) {
    return `unknown (module failed to load: ${message(e)})`;
  }
  if (job?.prerequisite) {
    try {
      const ready = await job.prerequisite(
        jobContext(job, manifest.args ?? []),
      );
      return ready === true ? 'met' : `not met: ${ready}`;
    } catch (e) {
      return `unknown (check threw: ${message(e)})`;
    }
  }
  return manifest.prerequisite === null
    ? 'met'
    : `manual: ${manifest.prerequisite}`;
};

/** The manifests section: a count line, then one line per manifest. */
const manifestLines = async (
  manifests: JobManifest[],
  runnables: Runnable[],
): Promise<string[]> => {
  const byId = new Map(runnables.map((r) => [r.id, r]));
  const states = await Promise.all(
    manifests.map((m) => prerequisiteState(m, byId.get(m.id))),
  );
  const count = (prefix: string) =>
    String(states.filter((s) => s.startsWith(prefix)).length);
  return [
    `manifests: ${String(manifests.length)} (prerequisites: ${count('met')} met, ${count('not met')} not met, ${count('manual')} manual)`,
    ...manifests.map(
      (m, i) =>
        `  ${m.id}: ${m.enabled ? 'enabled' : 'disabled'}; prerequisite: ${states[i] ?? ''}`,
    ),
  ];
};

/**
 * The `doctor` report for an instance root, one string per line. Never
 * throws: each problem is a line.
 */
export const doctorReport = async (
  root: string,
  options: DoctorOptions = {},
): Promise<string[]> => {
  const lines: string[] = [];
  let version = options.version;
  try {
    version ??= coreVersion();
    lines.push(`core: ${CORE_PACKAGE} ${version}`);
  } catch (e) {
    lines.push(`core: version unreadable: ${message(e)}`);
  }

  process.env[CONFIG_PATH_ENV] ??= path.join(root, 'jeeves-scripts.json');
  const check = configCheck({ root });
  const where = check.configPath ?? process.env[CONFIG_PATH_ENV];
  lines.push(`config: ${where}: ${check.ok ? 'OK' : 'FAILED'}`);
  for (const error of check.errors) lines.push(...indent(error));

  let plugin: Plugin | undefined;
  let runnables;
  try {
    plugin = await (options.loadPlugin ?? loadPlugin)(root);
    runnables = buildRunnables({ plugin, registry: options.registry });
    lines.push(
      plugin
        ? `plugin: ${PLUGIN_FILE}: ${String(plugin.jobs?.length ?? 0)} runnables, ${String(plugin.overrides?.length ?? 0)} overrides`
        : `plugin: none (no ${PLUGIN_FILE})`,
    );
  } catch (e) {
    lines.push(`plugin: FAILED`, ...indent(message(e)));
  }

  if (runnables) {
    try {
      const manifests = [
        ...registeredManifests({
          runnables,
          coreManifests: options.coreManifests ?? readCoreManifests(),
          instanceManifests: readInstanceManifests(root),
          deltas: loadConfig().jobs,
        }).values(),
      ];
      lines.push(...(await manifestLines(manifests, runnables)));
    } catch (e) {
      lines.push('manifests: FAILED', ...indent(message(e)));
    }
  }

  if (version !== undefined) lines.push(...overrideLines(plugin, version));
  return lines;
};
