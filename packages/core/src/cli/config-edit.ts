/**
 * @module cli/config-edit
 *
 * `jeeves-scripts config set <path> <value> [--live]` and
 * `config unset <path> [--live]` (#57, spec 2.2, row 23): the way to change
 * an instance's config, which lives outside the repo.
 *
 * The edit is applied to the raw JSON and the whole document is written to
 * a temporary file beside the config, then checked exactly as
 * `config check` checks (core schema with its secret-literal guard, silo
 * references, the plugin's `configSchema` on `local`). Invalid: the
 * temporary file is removed and the config is untouched. Dry run (the
 * default): the change is printed and the temporary file removed. `--live`:
 * the current file is copied to a dated backup (newest 20 kept), then the
 * temporary file is renamed over it, so a reader never sees a partial
 * write.
 *
 * A config still in the instance repo (`legacy`) is refused: move it first.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  applyConfigEdit,
  backupsToPrune,
  configBackupName,
  type ConfigEdit,
  describeConfigEdit,
  parseConfigPath,
} from '../config/edit.js';
import { resetConfig, resolveConfig } from '../config/loader.js';
import {
  instanceConfigCheck,
  type InstanceConfigCheckDeps,
} from './config-check.js';
import { loadPlugin } from './load-plugin.js';

/** What to change. */
export interface ConfigEditRequest {
  /** The config path (`slack.channels.C0123.homeDir`). */
  path: string;
  /** Set this value, or remove the key. */
  edit: ConfigEdit;
  /** Write the change; otherwise a dry run. */
  live?: boolean;
  /** Explicit config file (`--config`). */
  configPath?: string;
}

/** Outcome of {@link configEdit}. */
export interface ConfigEditResult {
  /** True when the edited config is valid (and, live, was written). */
  ok: boolean;
  /** Lines to print: the change, then what happened. */
  lines: string[];
  /** One message per problem; empty when `ok`. */
  errors: string[];
}

/** Seams for tests. */
export interface ConfigEditDeps extends Partial<InstanceConfigCheckDeps> {
  /** The clock for the backup name. Default: now. */
  now?: () => Date;
}

const failed = (errors: string[], lines: string[] = []): ConfigEditResult => ({
  ok: false,
  lines,
  errors,
});

/**
 * Apply one `config set` / `unset`. Never throws for a bad edit or an
 * invalid result; those come back as `errors`.
 *
 * @param root - Instance repo root.
 */
export const configEdit = async (
  root: string,
  request: ConfigEditRequest,
  deps: ConfigEditDeps = {},
): Promise<ConfigEditResult> => {
  let target: string;
  let doc: unknown;
  let applied: ReturnType<typeof applyConfigEdit>;
  let keys: readonly string[];
  try {
    keys = parseConfigPath(request.path);
    const resolved = resolveConfig({ root, configPath: request.configPath });
    if (resolved.source === 'legacy')
      return failed([
        `${resolved.path} is the config in the instance repo; move it first (guides/config.md#moving-the-config).`,
      ]);
    target = resolved.path;
    doc = JSON.parse(fs.readFileSync(target, 'utf8')) as unknown;
    applied = applyConfigEdit(doc, keys, request.edit);
  } catch (e) {
    return failed([e instanceof Error ? e.message : String(e)]);
  }
  const lines = [`${target}:`, ...describeConfigEdit(keys, applied)];

  const temp = `${target}.${String(process.pid)}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(applied.doc, null, 2)}\n`);
  let renamed = false;
  try {
    resetConfig();
    const check = await instanceConfigCheck(root, temp, {
      ...deps,
      loadPlugin: deps.loadPlugin ?? loadPlugin,
    });
    if (!check.ok)
      return failed(check.errors, [
        ...lines,
        'not written: the result is invalid',
      ]);
    if (!request.live)
      return {
        ok: true,
        lines: [
          ...lines,
          'dry run: nothing written; rerun with --live to write it',
        ],
        errors: [],
      };
    const backup = configBackupName(target, (deps.now ?? (() => new Date()))());
    fs.copyFileSync(target, backup);
    fs.renameSync(temp, target);
    renamed = true;
    const dir = path.dirname(target);
    for (const name of backupsToPrune(
      fs.readdirSync(dir),
      path.basename(target),
    ))
      fs.rmSync(path.join(dir, name), { force: true });
    return {
      ok: true,
      lines: [...lines, `written; backup ${backup}`],
      errors: [],
    };
  } finally {
    if (!renamed) fs.rmSync(temp, { force: true });
    resetConfig();
  }
};
