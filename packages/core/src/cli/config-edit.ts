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
import {
  CONFIG_PATH_ENV,
  resetConfig,
  resolveConfig,
} from '../config/loader.js';
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
  /** Wait between rename retries. Default: a timer. */
  sleep?: (ms: number) => Promise<void>;
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
  let original: string;
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
    original = fs.readFileSync(target, 'utf8');
    doc = JSON.parse(original) as unknown;
    applied = applyConfigEdit(doc, keys, request.edit);
  } catch (e) {
    return failed([e instanceof Error ? e.message : String(e)]);
  }
  const lines = [`${target}:`, ...describeConfigEdit(keys, applied)];

  if (JSON.stringify(applied.before) === JSON.stringify(applied.after))
    return {
      ok: true,
      lines: [...lines, 'unchanged: nothing written'],
      errors: [],
    };

  removeStaleTemps(target);
  const temp = `${target}.${String(process.pid)}.tmp`;
  const named = (text: string) => text.split(temp).join(target);
  fs.writeFileSync(temp, `${JSON.stringify(applied.doc, null, 2)}\n`);
  const savedEnv = process.env[CONFIG_PATH_ENV];
  let renamed = false;
  try {
    resetConfig();
    const check = await instanceConfigCheck(root, temp, {
      ...deps,
      loadPlugin: deps.loadPlugin ?? loadPlugin,
    });
    if (!check.ok)
      return failed(check.errors.map(named), [
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
    // Someone else changed the file since it was read: their edit would be lost.
    if (fs.readFileSync(target, 'utf8') !== original)
      return failed(
        [
          `${target} changed while this edit ran; nothing written. Run the command again.`,
        ],
        lines,
      );
    const backup = writeBackup(target, (deps.now ?? (() => new Date()))());
    const error = await renameWithRetry(temp, target, deps.sleep);
    if (error)
      return failed(
        [
          `Could not replace ${target} (${error}); nothing changed (backup ${backup} kept). Close whatever has it open and run the command again.`,
        ],
        lines,
      );
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
    if (savedEnv === undefined)
      Reflect.deleteProperty(process.env, CONFIG_PATH_ENV);
    else process.env[CONFIG_PATH_ENV] = savedEnv;
    resetConfig();
  }
};

/** Temp files older than this, left by a crashed edit, are removed. */
const STALE_TEMP_MS = 60 * 60 * 1000;

/** Remove `<config>.<pid>.tmp` files a crashed edit left behind. */
const removeStaleTemps = (target: string): void => {
  const dir = path.dirname(target);
  const prefix = `${path.basename(target)}.`;
  for (const name of fs.readdirSync(dir)) {
    if (
      !name.startsWith(prefix) ||
      !/^\d+\.tmp$/.test(name.slice(prefix.length))
    )
      continue;
    const file = path.join(dir, name);
    if (Date.now() - fs.statSync(file).mtimeMs > STALE_TEMP_MS)
      fs.rmSync(file, { force: true });
  }
};

/** Copy `target` to a new dated backup, never overwriting one. */
const writeBackup = (target: string, at: Date): string => {
  for (let attempt = 1; ; attempt++) {
    const backup = configBackupName(target, at, attempt);
    try {
      fs.copyFileSync(target, backup, fs.constants.COPYFILE_EXCL);
      return backup;
    } catch (e) {
      if (!(e instanceof Error && 'code' in e && e.code === 'EEXIST')) throw e;
    }
  }
};

/** Codes Windows returns while another process briefly holds the file. */
const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RENAME_ATTEMPTS = 10;

/**
 * Rename `from` over `to`, retrying transient Windows sharing errors.
 * Resolves to `undefined` on success, else the last error's code.
 */
const renameWithRetry = async (
  from: string,
  to: string,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<string | undefined> => {
  for (let attempt = 1; ; attempt++) {
    try {
      fs.renameSync(from, to);
      return undefined;
    } catch (e) {
      const code =
        e instanceof Error && 'code' in e ? String(e.code) : String(e);
      if (!TRANSIENT.has(code) || attempt >= RENAME_ATTEMPTS) return code;
      await sleep(100);
    }
  }
};
