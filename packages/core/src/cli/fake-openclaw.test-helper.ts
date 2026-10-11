/**
 * @module cli/fake-openclaw.test-helper
 *
 * Test helper: an in-memory `openclaw` (`config get`,
 * `config set --batch-file`, `config unset`, `skills list`) for the skills
 * tests, and dotted-path get/set over a JSON object. Not built or shipped.
 */

import fs from 'node:fs';

import type { CommandResult, RunCommand } from './openclaw.js';

export type Json = Record<string, unknown>;

export const getPath = (obj: unknown, dotted: string): unknown =>
  dotted
    .split('.')
    .reduce<unknown>(
      (o, k) =>
        o !== null && typeof o === 'object' ? (o as Json)[k] : undefined,
      obj,
    );

export const setPath = (obj: Json, dotted: string, value: unknown) => {
  const keys = dotted.split('.');
  const last = keys.pop() ?? '';
  let o = obj;
  for (const k of keys) {
    o[k] ??= {};
    o = o[k] as Json;
  }
  if (value === undefined) Reflect.deleteProperty(o, last);
  else o[last] = value;
};

/** An in-memory `openclaw`: config get/set --batch-file/unset, skills list. */
export const fakeOpenclaw = (config: Json = {}, sources: Json[] = []) => {
  const calls: string[][] = [];
  const ok = (stdout = ''): CommandResult => ({ code: 0, stdout, stderr: '' });
  const run: RunCommand = (command, args) => {
    calls.push([command, ...args]);
    const [a, b, c] = args;
    if (a === '--version') return Promise.resolve(ok('OpenClaw 2026.9.6'));
    if (a === 'skills' && b === 'list')
      return Promise.resolve(
        ok(`banner\n${JSON.stringify({ skills: sources })}`),
      );
    if (a === 'config' && b === 'get') {
      const v = getPath(config, c ?? '');
      return Promise.resolve(
        v === undefined
          ? {
              code: 1,
              stdout: `{"ok":false,"error":{"message":"Config path is valid but unset: ${c ?? ''}."}}`,
              stderr: '',
            }
          : ok(JSON.stringify(v)),
      );
    }
    if (a === 'config' && b === 'set' && c === '--batch-file') {
      const ops = JSON.parse(fs.readFileSync(args[3] ?? '', 'utf8')) as {
        path: string;
        value: unknown;
      }[];
      for (const op of ops) setPath(config, op.path, op.value);
      return Promise.resolve(ok());
    }
    if (a === 'config' && b === 'unset') {
      setPath(config, c ?? '', undefined);
      return Promise.resolve(ok());
    }
    return Promise.resolve({ code: 2, stdout: '', stderr: 'unknown command' });
  };
  return { config, calls, run };
};
