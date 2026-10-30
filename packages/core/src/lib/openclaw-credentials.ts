/**
 * @module lib/openclaw-credentials
 *
 * Resolve OpenClaw credential strings the way OpenClaw does: env
 * references (`${VAR}`, a whole-string `$VAR`) against the process env,
 * the `.env` beside the config file and the config's `env.vars`. Used by
 * `openclaw-config`; not exported from the package root.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';

import { getErrorMessage } from '@karmaniverous/jeeves';

import { isEnoent } from './fs-errors.js';

/** Environment for env references: name to value. */
export type CredentialEnv = Readonly<Record<string, string | undefined>>;

/** OpenClaw's env reference names (`[A-Z_][A-Z0-9_]*`); `$${...}` is an escape. */
const ENV_REF = /\$\$\{[A-Z_][A-Z0-9_]*\}|\$\{([A-Z_][A-Z0-9_]*)\}/g;
const BARE_ENV_REF = /^\$([A-Z_][A-Z0-9_]*)$/;

/**
 * The plain value of a credential: `${VAR}` anywhere in the string, or a
 * whole-string `$VAR`, from `env`; `$${VAR}` is a literal `${VAR}`.
 * `undefined` when unset, a SecretRef object (core doesn't resolve those)
 * or a reference to a missing or empty variable (OpenClaw leaves those
 * unresolved); such names are added to `missing`.
 */
export const resolveCredential = (
  value: unknown,
  env: CredentialEnv,
  missing: string[] = [],
): string | undefined => {
  if (typeof value !== 'string' || value === '') return undefined;
  const unresolved: string[] = [];
  const lookup = (name: string): string | undefined => {
    const v = env[name];
    if (v !== undefined && v !== '') return v;
    unresolved.push(name);
    return undefined;
  };
  const bare = BARE_ENV_REF.exec(value);
  const out = bare
    ? lookup(bare[1] ?? '')
    : value.replace(ENV_REF, (match: string, name?: string) =>
        name === undefined ? match.slice(1) : (lookup(name) ?? ''),
      );
  missing.push(...unresolved);
  return unresolved.length > 0 ? undefined : out;
};

/**
 * The environment OpenClaw resolves env references in `configFile`
 * against, highest precedence first, each filling only names still unset:
 * `processEnv`, the `.env` beside the config file (`~/.openclaw/.env`),
 * then the config's `env.vars` (non-strings ignored). The gateway's
 * working-directory `.env` and login-shell import are not visible to core.
 *
 * @throws When that `.env` exists but can't be read.
 */
export const credentialEnv = (
  vars: Readonly<Record<string, unknown>> | undefined,
  configFile: string,
  processEnv: CredentialEnv = process.env,
): CredentialEnv => {
  const env: Record<string, string> = {};
  const fill = (source: Readonly<Record<string, unknown>>) => {
    for (const [k, v] of Object.entries(source))
      if (typeof v === 'string' && v !== '' && !(k in env)) env[k] = v;
  };
  fill(processEnv);
  const dotenv = path.join(path.dirname(configFile), '.env');
  try {
    fill(parseEnv(fs.readFileSync(dotenv, 'utf8')));
  } catch (e) {
    if (!isEnoent(e))
      throw new Error(`Cannot read ${dotenv}: ${getErrorMessage(e)}`, {
        cause: e,
      });
  }
  fill(vars ?? {});
  return env;
};
