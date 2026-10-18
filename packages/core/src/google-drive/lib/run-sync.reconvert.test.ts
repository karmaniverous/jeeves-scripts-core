import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { RECONVERT_KEY } from './content-key.js';
import { fakeRunner } from './fake-runner.test-helper.js';
import { emptyRecord, type LedgerRecord } from './ledger.js';
import { markImageBloat, syncOne } from './run-sync.js';
import {
  cfg,
  drive,
  opts,
  sandboxDir,
  target,
  tree,
  useSandbox,
} from './run-sync.test-helper.js';

useSandbox();

const BLOAT = 'x ![](data:image/png;base64,iVBORw0KGgo=) y';

describe('markImageBloat', () => {
  it('invalidates only written records whose copy holds an inline image', () => {
    fs.writeFileSync(path.join(sandboxDir(), 'bloated.md'), BLOAT);
    fs.writeFileSync(path.join(sandboxDir(), 'clean.md'), 'plain text');
    const written = (localPath: string): LedgerRecord => ({
      ...emptyRecord(),
      localPath,
      written: {
        contentKey: 'md5:a',
        modifiedTime: null,
        kind: 'text',
        at: 'now',
      },
    });
    const ledger = new Map<string, LedgerRecord>([
      ['b', written('bloated.md')],
      ['c', written('clean.md')],
      ['m', written('missing.md')],
      ['u', emptyRecord()],
    ]);
    expect(markImageBloat(ledger, sandboxDir())).toBe(1);
    expect(ledger.get('b')?.written?.contentKey).toBe(RECONVERT_KEY);
    expect(ledger.get('c')?.written?.contentKey).toBe('md5:a');
    expect(ledger.get('m')?.written?.contentKey).toBe('md5:a');
    expect(ledger.get('u')?.written).toBeNull();
  });
});

describe('markImageBloat: stays inside the target', () => {
  const written = (localPath: string): LedgerRecord => ({
    ...emptyRecord(),
    localPath,
    written: {
      contentKey: 'md5:a',
      modifiedTime: null,
      kind: 'text',
      at: 'now',
    },
  });

  it('never reads a ledger path that escapes the target', () => {
    const inner = path.join(sandboxDir(), 'inner');
    fs.mkdirSync(inner);
    fs.writeFileSync(path.join(sandboxDir(), 'outside.md'), BLOAT);
    const ledger = new Map([['x', written('../outside.md')]]);
    expect(markImageBloat(ledger, inner)).toBe(0);
    expect(ledger.get('x')?.written?.contentKey).toBe('md5:a');
  });

  it('never follows a linked directory out of the target', () => {
    const inner = path.join(sandboxDir(), 'inner');
    const outside = path.join(sandboxDir(), 'outside');
    fs.mkdirSync(inner);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'secret.md'), BLOAT);
    // A junction needs no privilege on Windows; elsewhere it is a dir symlink.
    fs.symlinkSync(outside, path.join(inner, 'dir'), 'junction');
    const ledger = new Map([['d', written('dir/secret.md')]]);
    expect(markImageBloat(ledger, inner)).toBe(0);
    expect(
      [...ledger.values()].map((r) => r.written?.contentKey),
    ).not.toContain(RECONVERT_KEY);
  });
});

describe('syncOne --reconvert (#20)', () => {
  it('re-converts copies that still hold inline images: reported in a dry run, rewritten live', async () => {
    const r = fakeRunner();
    await syncOne(cfg, r.client, opts(drive(true), true));
    const copy = tree().find((p) => p.endsWith('.txt'));
    if (!copy) throw new Error('no synced copy');
    const file = path.join(target(), copy);
    fs.writeFileSync(file, BLOAT);

    const plain = await syncOne(cfg, r.client, opts(drive(true), true));
    expect(plain.queueUpdates).toBe(0);

    const log: string[] = [];
    const dry = await syncOne(cfg, r.client, {
      ...opts(drive(true), false, log),
      reconvert: true,
    });
    expect(dry.queueUpdates).toBe(1);
    expect(log).toContain(
      'reconvert: 1 item(s) with inline images would be queued for re-conversion',
    );
    expect(fs.readFileSync(file, 'utf8')).toBe(BLOAT);

    const live = await syncOne(cfg, r.client, {
      ...opts(drive(true), true),
      reconvert: true,
    });
    expect(live).toMatchObject({ queueUpdates: 1, processed: 1, failed: 0 });
    expect(fs.readFileSync(file, 'utf8')).toBe('hello');

    const idle = await syncOne(cfg, r.client, {
      ...opts(drive(true), true),
      reconvert: true,
    });
    expect(idle.queueUpdates).toBe(0);
  });
});
