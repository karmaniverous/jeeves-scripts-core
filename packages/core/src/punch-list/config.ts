/**
 * @module punch-list/config
 *
 * The resolved `punchList` block (spec 2.7): the configured values with
 * every derived path filled in (`{stateDir}/punch-list/...`, the default
 * silo's archive directories, the jeeves-server config), the notification
 * channel as a bare Slack id, and the path helpers both runnables use.
 * Reads the instance config only.
 */

import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';

import { loadConfig, type LoadConfigOptions } from '../config/loader.js';
import { derivePaths } from '../config/paths.js';
import type {
  PunchListBlock,
  PunchListInstallTarget,
} from '../config/punch-list-schema.js';
import type { Config } from '../config/schema.js';
import { resolveDefaultBasePath } from '../config/silo-router.js';
import { componentConfigPath } from '../lib/component-config.js';
import { requireSlackTarget } from '../lib/worker-slack/slack-target.js';

/** One released component and where its installed `package.json` lives. */
export type InstallTarget = PunchListInstallTarget;

/** The `punchList` block with every default resolved. */
export type PunchListConfig = Omit<
  PunchListBlock,
  'lockFile' | 'pendingFile' | 'cursorFile' | 'inboxDir' | 'inputRoots'
> & {
  /** Lock held by every runnable write. */
  lockFile: string;
  /** Notifications not yet posted. */
  pendingFile: string;
  /** Harvest window cursor. */
  cursorFile: string;
  /** Where the harvest worker writes its report. */
  inboxDir: string;
  /** What the harvester's pre-check watches for new input. */
  inputRoots: string[];
  /** The jeeves-server config, for its `publicUrl` and `roots`. */
  serverConfig: string;
};

/** The archive directories under the default silo the harvester watches by default. */
export const DEFAULT_INPUT_DIRS = [
  'email',
  'slack',
  'meetings',
  'google-drive',
] as const;

/**
 * Resolve a validated config's `punchList` block, or `undefined` when it
 * has none (both runnables skip).
 */
export const derivePunchList = (
  config: Config,
): PunchListConfig | undefined => {
  const block = config.punchList;
  if (!block) return undefined;
  const { stateDir, configDir } = derivePaths(config);
  const silo = resolveDefaultBasePath(config);
  const state = (file: string): string =>
    path.join(stateDir, 'punch-list', file);
  return {
    ...block,
    slack: {
      ...block.slack,
      channel: slackChannelId(block.slack.channel),
    },
    lockFile: block.lockFile ?? state('punch-list.lock'),
    pendingFile: block.pendingFile ?? state('status-pending.json'),
    cursorFile: block.cursorFile ?? state('harvest-cursor.json'),
    inboxDir: block.inboxDir ?? state('inbox'),
    inputRoots: block.inputRoots?.map((root) => expandPath(root)) ?? [
      ...DEFAULT_INPUT_DIRS.map((dir) => path.join(silo, dir)),
      path.join(stateDir, 'jeeves-watcher', 'issues.json'),
    ],
    serverConfig: componentConfigPath('server', configDir),
  };
};

/** The loaded instance config's resolved `punchList` block, if any. */
export const punchListConfig = (
  options: LoadConfigOptions = {},
): PunchListConfig | undefined => derivePunchList(loadConfig(options));

/** The bare Slack id of a configured channel or user (`channel:C…` → `C…`). */
export const slackChannelId = (raw: string): string => {
  const target = requireSlackTarget(raw);
  return target.slice(target.indexOf(':') + 1);
};

/** Every repo the status checker scans: the scripts repo and the install map's. */
export const scannedRepos = (config: PunchListConfig): string[] => [
  config.scriptsRepo.repo,
  ...Object.keys(config.installMap),
];

/** What {@link npmGlobalPrefix} reads; injectable for tests. */
export interface NpmPrefixEnv {
  /** The environment (`npm_config_prefix`, set by npm for its scripts or by the user). */
  env: Readonly<Record<string, string | undefined>>;
  /** The Node binary (`process.execPath`), for npm's built-in default. */
  execPath: string;
  /** `process.platform`. */
  platform: NodeJS.Platform;
  /** `npm prefix -g`'s output; throws when npm cannot be run. */
  npmPrefix: () => string;
}

const liveNpmPrefixEnv = (): NpmPrefixEnv => ({
  env: process.env,
  execPath: process.execPath,
  platform: process.platform,
  // A fixed command through the shell: npm is `npm.cmd` on Windows.
  npmPrefix: () =>
    execSync('npm prefix -g', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15_000,
    }),
});

/**
 * npm's global prefix: `npm_config_prefix` when set, else what
 * `npm prefix -g` prints (which honours every npmrc, e.g. the standard
 * Windows installer's `%APPDATA%\npm`), else npm's built-in default
 * (`node.exe`'s directory on Windows, the directory above `bin/node`
 * elsewhere) when npm cannot be run.
 */
export const npmGlobalPrefix = (
  env: NpmPrefixEnv = liveNpmPrefixEnv(),
): string => {
  const configured = env.env.npm_config_prefix ?? env.env.NPM_CONFIG_PREFIX;
  if (configured) return configured;
  try {
    const printed = env.npmPrefix().trim();
    if (printed) return printed;
  } catch {
    // npm not runnable: fall back to its built-in default below.
  }
  const p = env.platform === 'win32' ? path.win32 : path.posix;
  const nodeDir = p.dirname(env.execPath);
  return env.platform === 'win32' ? nodeDir : p.dirname(nodeDir);
};

let livePrefix: string | undefined;

/** Where {@link expandPath} finds npm's global prefix and the home directory. */
export interface ExpandEnv {
  /** npm's global prefix; called only when the pattern holds `{npmGlobal}`. */
  npmPrefix: () => string;
  /** The home directory. */
  home: string;
  /** `process.platform`: Windows keeps global modules at `<prefix>/node_modules`. */
  platform: NodeJS.Platform;
}

/**
 * Expand `{npmGlobal}` (npm's global `node_modules`:
 * `<prefix>/lib/node_modules`, or `<prefix>/node_modules` on Windows,
 * with the prefix from {@link npmGlobalPrefix}, read once per process)
 * and `{home}`.
 */
export const expandPath = (
  pattern: string,
  env: ExpandEnv = {
    npmPrefix: () => (livePrefix ??= npmGlobalPrefix()),
    home: homedir(),
    platform: process.platform,
  },
): string => {
  if (!pattern.includes('{npmGlobal}'))
    return pattern.replaceAll('{home}', env.home);
  const p = env.platform === 'win32' ? path.win32 : path.posix;
  const prefix = env.npmPrefix();
  const npmGlobal =
    env.platform === 'win32'
      ? p.join(prefix, 'node_modules')
      : p.join(prefix, 'lib', 'node_modules');
  return pattern
    .replaceAll('{npmGlobal}', npmGlobal)
    .replaceAll('{home}', env.home);
};
