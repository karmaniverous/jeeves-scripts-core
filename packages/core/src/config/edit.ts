/**
 * @module config/edit
 *
 * Pure pieces of `config set` / `config unset` (#57, spec 2.2): parse a
 * config path and value, apply the edit to the raw JSON document, describe
 * the change, and name and prune backups. The command itself
 * (`cli/config-edit`) does the file work and validation.
 */

/** Keys that would reach an object's prototype; never config keys. */
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** A parsed config path: the keys from the root down. */
export type ConfigPath = readonly string[];

/**
 * Parse a config path: dot-separated keys (`slack.channels.C0123.homeDir`),
 * with a key that contains dots written as a bracketed JSON string
 * (`paths["a.b"].c`).
 *
 * @throws On an empty path, an empty key or a malformed bracket.
 */
export const parseConfigPath = (text: string): ConfigPath => {
  const keys: string[] = [];
  let i = 0;
  const fail = (why: string): never => {
    throw new Error(`Invalid config path "${text}": ${why}.`);
  };
  while (i < text.length) {
    if (text[i] === '[') {
      const end = text.indexOf('"]', i + 2);
      if (text[i + 1] !== '"' || end < 0)
        fail(`expected ["..."] at ${String(i)}`);
      let key: unknown;
      try {
        key = JSON.parse(text.slice(i + 1, end + 1));
      } catch {
        fail(`bad quoted key at ${String(i)}`);
      }
      if (typeof key !== 'string' || key === '') fail('empty key');
      keys.push(key as string);
      i = end + 2;
    } else {
      let end = i;
      while (end < text.length && text[end] !== '.' && text[end] !== '[') end++;
      if (end === i) fail(`empty key at ${String(i)}`);
      keys.push(text.slice(i, end));
      i = end;
    }
    if (i < text.length) {
      if (text[i] === '.') {
        i++;
        if (i === text.length) fail('trailing "."');
      } else if (text[i] !== '[')
        fail(`unexpected "${text[i] ?? ''}" at ${String(i)}`);
    }
  }
  if (keys.length === 0) fail('empty');
  const reserved = keys.find((k) => RESERVED_KEYS.has(k));
  if (reserved !== undefined) fail(`"${reserved}" is not a config key`);
  return keys;
};

/** Format a config path for messages, bracketing keys that need it. */
export const formatConfigPath = (keys: ConfigPath): string =>
  keys
    .map((key, i) =>
      /^[^.[\]"]+$/.test(key)
        ? `${i ? '.' : ''}${key}`
        : `[${JSON.stringify(key)}]`,
    )
    .join('');

/** A value argument: JSON when it parses, else the string itself. */
export const parseConfigValue = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

/** A plain JSON object (not an array or null). */
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** One edit: set a value, or remove the key. */
export type ConfigEdit = { set: unknown } | { unset: true };

/** Result of {@link applyConfigEdit}. */
export interface AppliedEdit {
  /** The edited document (the input is not modified). */
  doc: unknown;
  /** The value at the path before; `undefined` when it was absent. */
  before: unknown;
  /** The value at the path after; `undefined` when removed. */
  after: unknown;
}

/**
 * Apply an edit to a raw config document. `set` creates missing parent
 * objects; `unset` removes the key and requires it to exist.
 *
 * @throws When a parent on the path is not an object, or `unset` names a
 *   missing key.
 */
export const applyConfigEdit = (
  doc: unknown,
  keys: ConfigPath,
  edit: ConfigEdit,
): AppliedEdit => {
  const root = structuredClone(doc);
  if (!isRecord(root)) throw new Error('The config is not a JSON object.');
  let node: Record<string, unknown> = root;
  for (const [i, key] of keys.slice(0, -1).entries()) {
    const next = Object.hasOwn(node, key) ? node[key] : undefined;
    if (next === undefined && 'set' in edit) node[key] = {};
    else if (!isRecord(next))
      throw new Error(
        `${formatConfigPath(keys.slice(0, i + 1))} is ${next === undefined ? 'not set' : 'not an object'}, so ${formatConfigPath(keys)} can't be ${'set' in edit ? 'set' : 'removed'}.`,
      );
    node = node[key] as Record<string, unknown>;
  }
  const last = keys[keys.length - 1] ?? '';
  const before = Object.hasOwn(node, last) ? node[last] : undefined;
  if ('set' in edit) {
    node[last] = structuredClone(edit.set);
    return { doc: root, before, after: edit.set };
  }
  if (!Object.hasOwn(node, last))
    throw new Error(`${formatConfigPath(keys)} is not set; nothing to remove.`);
  Reflect.deleteProperty(node, last);
  return { doc: root, before, after: undefined };
};

/** The change at a path as `-` / `+` lines (JSON values). */
export const describeConfigEdit = (
  keys: ConfigPath,
  { before, after }: Pick<AppliedEdit, 'before' | 'after'>,
): string[] => {
  const where = formatConfigPath(keys);
  const show = (v: unknown) => JSON.stringify(v);
  if (JSON.stringify(before) === JSON.stringify(after))
    return [`  ${where}: ${show(after)} (unchanged)`];
  return [
    ...(before === undefined ? [] : [`- ${where}: ${show(before)}`]),
    ...(after === undefined ? [] : [`+ ${where}: ${show(after)}`]),
  ];
};

/** How many backups `config set` / `unset` keep. */
export const CONFIG_BACKUPS_KEPT = 20;

/**
 * `config.json.<UTC yyyymmddTHHMMSSZ>.bak` for a moment; an `attempt` above 1
 * adds `-<attempt>` for a second backup within the same second.
 */
export const configBackupName = (
  configFile: string,
  at: Date,
  attempt = 1,
): string =>
  `${configFile}.${at
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')}${attempt > 1 ? `-${String(attempt)}` : ''}.bak`;

/**
 * The backups of `configFileName` to delete so the newest `keep` remain,
 * given a directory listing; ordered by time, then by `-<n>` suffix.
 */
export const backupsToPrune = (
  names: readonly string[],
  configFileName: string,
  keep: number = CONFIG_BACKUPS_KEPT,
): string[] => {
  const pattern = new RegExp(
    `^${configFileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(\\d{8}T\\d{6}Z)(?:-(\\d+))?\\.bak$`,
  );
  const backups = names
    .map((name) => ({ name, m: pattern.exec(name) }))
    .filter((b): b is { name: string; m: RegExpExecArray } => b.m !== null)
    .map(({ name, m }) => ({ name, stamp: m[1] ?? '', n: Number(m[2] ?? 1) }))
    .sort((x, y) => x.stamp.localeCompare(y.stamp) || x.n - y.n)
    .map((b) => b.name);
  return backups.slice(0, Math.max(0, backups.length - keep));
};
