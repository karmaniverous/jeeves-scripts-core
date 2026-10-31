import { describe, expect, it } from 'vitest';

import {
  applyConfigEdit,
  backupsToPrune,
  configBackupName,
  describeConfigEdit,
  formatConfigPath,
  parseConfigPath,
  parseConfigValue,
} from './edit.js';

describe('parseConfigPath', () => {
  it.each([
    ['slack.channels.C0123.homeDir', ['slack', 'channels', 'C0123', 'homeDir']],
    ['paths["a.b"].c', ['paths', 'a.b', 'c']],
    ['["x.y"]', ['x.y']],
    ['a["b"]["c.d"]', ['a', 'b', 'c.d']],
  ])('parses %s', (text, keys) => {
    expect(parseConfigPath(text)).toEqual(keys);
    expect(parseConfigPath(formatConfigPath(keys))).toEqual(keys);
  });

  it.each([
    '',
    'a..b',
    'a.',
    '.a',
    'a[b]',
    'a["b"',
    'a[""]',
    'a["b"]c',
    'a["\\q"]',
  ])('rejects %j', (text) => {
    expect(() => parseConfigPath(text)).toThrow(/Invalid config path/);
  });
});

describe('formatConfigPath', () => {
  it('brackets only keys that need it', () => {
    expect(formatConfigPath(['slack', 'a.b', 'c'])).toBe('slack["a.b"].c');
  });
});

describe('parseConfigValue', () => {
  it.each([
    ['true', true],
    ['3', 3],
    ['{"a":1}', { a: 1 }],
    ['"quoted"', 'quoted'],
    ['D:/path/x', 'D:/path/x'],
  ])('parses %s', (text, value) => {
    expect(parseConfigValue(text)).toEqual(value);
  });
});

describe('applyConfigEdit', () => {
  const doc = {
    instance: { name: 'n' },
    slack: { channels: { C1: { homeDir: 'old' } } },
  };

  it('sets a value, creating parents, without touching the input', () => {
    const r = applyConfigEdit(doc, ['slack', 'channels', 'C2', 'homeDir'], {
      set: 'J:/x',
    });
    expect(r.doc).toMatchObject({
      slack: { channels: { C1: { homeDir: 'old' }, C2: { homeDir: 'J:/x' } } },
    });
    expect(r).toMatchObject({ before: undefined, after: 'J:/x' });
    expect(doc.slack.channels).not.toHaveProperty('C2');
  });

  it('replaces a value and reports the old one', () => {
    const r = applyConfigEdit(doc, ['slack', 'channels', 'C1', 'homeDir'], {
      set: 'new',
    });
    expect(r).toMatchObject({ before: 'old', after: 'new' });
  });

  it('removes a key', () => {
    const r = applyConfigEdit(doc, ['slack', 'channels', 'C1'], {
      unset: true,
    });
    expect(r.doc).toMatchObject({ slack: { channels: {} } });
    expect(r.before).toEqual({ homeDir: 'old' });
  });

  it('refuses to remove a missing key', () => {
    expect(() =>
      applyConfigEdit(doc, ['slack', 'nope'], { unset: true }),
    ).toThrow(/not set; nothing to remove/);
    expect(() => applyConfigEdit(doc, ['nope', 'x'], { unset: true })).toThrow(
      /nope is not set/,
    );
  });

  it('refuses to go through a non-object', () => {
    expect(() =>
      applyConfigEdit(doc, ['instance', 'name', 'x'], { set: 1 }),
    ).toThrow(/instance\.name is not an object/);
  });

  it('rejects a document that is not an object', () => {
    expect(() => applyConfigEdit([], ['a'], { set: 1 })).toThrow(
      /not a JSON object/,
    );
  });
});

describe('describeConfigEdit', () => {
  it('shows removed, added and unchanged values', () => {
    expect(describeConfigEdit(['a', 'b'], { before: 1, after: 2 })).toEqual([
      '- a.b: 1',
      '+ a.b: 2',
    ]);
    expect(
      describeConfigEdit(['a'], { before: undefined, after: 'x' }),
    ).toEqual(['+ a: "x"']);
    expect(
      describeConfigEdit(['a'], { before: 'x', after: undefined }),
    ).toEqual(['- a: "x"']);
    expect(describeConfigEdit(['a'], { before: 1, after: 1 })).toEqual([
      '  a: 1 (unchanged)',
    ]);
  });
});

describe('backups', () => {
  it('names a backup by UTC time', () => {
    expect(
      configBackupName('/c/config.json', new Date('2026-10-30T11:05:09.123Z')),
    ).toBe('/c/config.json.20261030T110509Z.bak');
  });

  it('prunes all but the newest backups of that file', () => {
    const names = [
      ...Array.from(
        { length: 22 },
        (_, i) =>
          `config.json.202610${String(i + 1).padStart(2, '0')}T000000Z.bak`,
      ),
      'config.json',
      'other.json.20261001T000000Z.bak',
      'config.json.tmp',
    ];
    expect(backupsToPrune(names, 'config.json')).toEqual([
      'config.json.20261001T000000Z.bak',
      'config.json.20261002T000000Z.bak',
    ]);
    expect(backupsToPrune(names.slice(0, 3), 'config.json')).toEqual([]);
  });
});

describe('review fixes (#62)', () => {
  it('rejects keys that reach the prototype', () => {
    for (const key of ['__proto__', 'constructor', 'prototype'])
      expect(() => parseConfigPath(`a.${key}.b`)).toThrow(
        /is not a config key/,
      );
  });

  it('only sees own properties', () => {
    expect(() =>
      applyConfigEdit({ instance: {} }, ['instance', 'toString'], {
        unset: true,
      }),
    ).toThrow(/not set; nothing to remove/);
    const r = applyConfigEdit({ instance: {} }, ['instance', 'toString'], {
      set: 1,
    });
    expect(r.before).toBeUndefined();
  });

  it('names a second backup in the same second, and prunes in time order', () => {
    const at = new Date('2026-10-30T12:00:00Z');
    expect(configBackupName('c.json', at, 2)).toBe(
      'c.json.20261030T120000Z-2.bak',
    );
    expect(
      backupsToPrune(
        [
          'config.json.20261030T120000Z-2.bak',
          'config.json.20261030T120000Z.bak',
          'config.json.20261029T000000Z.bak',
        ],
        'config.json',
        1,
      ),
    ).toEqual([
      'config.json.20261029T000000Z.bak',
      'config.json.20261030T120000Z.bak',
    ]);
  });
});
