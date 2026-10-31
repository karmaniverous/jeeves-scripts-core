import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

const runScript = vi.hoisted(() => vi.fn());
vi.mock('@karmaniverous/jeeves', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  runScript,
}));

import { defineRunnable } from './define-runnable.js';
import { readCoreManifests } from './manifest.js';
import {
  coreDomains,
  coreJobs,
  loadJob,
  type RegistryEntry,
} from './registry.js';
import { onDemandJobs } from './registry-on-demand.js';
import { scheduledJobs } from './registry-scheduled.js';

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('core runnable registry', () => {
  it('has unique ids, each module under its domain', () => {
    const ids = coreJobs.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(coreJobs.filter((e) => e.module.split('/')[0] !== e.domain)).toEqual(
      [],
    );
    expect(
      coreJobs
        .map((e) => `${e.module}.ts`)
        .filter((f) => !fs.existsSync(path.join(srcDir, f))),
    ).toEqual([]);
  });

  it('names every top-level domain folder as a core domain, and only those', () => {
    const framework = new Set(['cli', 'config', 'lib', 'presets', 'runnables']);
    const folders = fs
      .readdirSync(srcDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !framework.has(d.name))
      .map((d) => d.name)
      .sort();
    expect([...coreDomains].sort()).toEqual(folders);
    expect(coreJobs.filter((e) => !coreDomains.includes(e.domain))).toEqual([]);
  });

  it('registers every scheduled job in core manifests under the same domain', () => {
    const manifests = readCoreManifests();
    expect(manifests).toHaveLength(38);
    expect(
      manifests
        .filter((m) => coreJobs.find((e) => e.id === m.id)?.domain !== m.domain)
        .map((m) => m.id),
    ).toEqual([]);
  });

  it('holds exactly the runnables with a core manifest in scheduledJobs', () => {
    const manifestIds = readCoreManifests()
      .map((m) => m.id)
      .sort();
    expect(scheduledJobs.map((e) => e.id).sort()).toEqual(manifestIds);
    expect(
      onDemandJobs.filter((e) => manifestIds.includes(e.id)).map((e) => e.id),
    ).toEqual([]);
    expect(coreJobs).toHaveLength(scheduledJobs.length + onDemandJobs.length);
  });

  it('loads every job module as defineRunnable(...) with its id, running nothing on import', async () => {
    const scheduled = new Set(readCoreManifests().map((m) => m.id));
    const undescribed: string[] = [];
    for (const e of coreJobs) {
      const job = await loadJob(e);
      expect(job.id).toBe(e.id);
      if (!scheduled.has(e.id) && !job.description) undescribed.push(e.id);
    }
    // A runnable without a manifest takes its `list` line from defineRunnable.
    expect(undescribed).toEqual([]);
    expect(runScript).not.toHaveBeenCalled();
  }, 120_000);
});

describe('loadJob', () => {
  const entry = (def: unknown): RegistryEntry => ({
    id: 'acme-report',
    domain: 'acme',
    module: 'acme/report',
    load: () => Promise.resolve({ default: def }),
  });

  it('rejects a module that does not default-export a job', async () => {
    await expect(loadJob(entry({ id: 'acme-report' }))).rejects.toThrow(
      /acme\/report does not default-export defineRunnable/,
    );
  });

  it('rejects a module that declares a different id or domain', async () => {
    const other = defineRunnable({
      id: 'acme-other',
      domain: 'acme',
      run: vi.fn(),
    });
    await expect(loadJob(entry(other))).rejects.toThrow(
      /Job "acme-report" \(acme\): acme\/report declares "acme-other" \(acme\)/,
    );
  });
});
