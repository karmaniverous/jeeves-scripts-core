/**
 * Jobs that run another runnable (Decision 80), through the CLI: one
 * runnable backs several runner jobs, each with its own manifest, deltas,
 * config, crash label and worker job id, while the runnable keeps its own
 * manifest and `run <runnableId>`.
 */

import { describe, expect, it, vi } from 'vitest';

import { doctorReport } from './doctor.js';
import {
  acmeManifest,
  baseJobs,
  dispatchDeps,
  entryFields,
  labels,
  options,
  root,
  runDeps,
  runs,
  useJobInstancesSandbox,
  writeConfig,
  writeManifests,
} from './job-instances.test-helper.js';
import { formatList, jobHelp, listRunnables } from './list.js';
import { runJob } from './run.js';

useJobInstancesSandbox();

describe('two jobs running one runnable', () => {
  it('list each as its own runner job, with its own fields and deltas', async () => {
    const entries = await listRunnables(root(), 'acme-brief*', options);
    expect(entries.map((e) => [e.id, e.runnable, e.source, e.domain])).toEqual([
      ['acme-brief', undefined, 'instance', 'acme'],
      ['acme-brief-clinical', 'acme-brief', 'instance', 'acme'],
      ['acme-brief-industry', 'acme-brief', 'instance', 'acme'],
    ]);
    expect(entries[2]?.manifest).toEqual({
      id: 'acme-brief-industry',
      domain: 'acme',
      runnable: 'acme-brief',
      name: 'Industry brief',
      description: 'The industry brief.',
      schedule: '0 7 * * 1-5',
      timeout_seconds: 600,
      on_failure: 'C000EXAMPLE2',
      env: { BRIEF: 'industry', EXTRA: '1' },
      args: ['--dry-run'],
      ...entryFields,
      enabled: false,
    });
    expect(formatList(entries)).toEqual([
      'id                                source    schedule                                          enabled  description',
      'acme-brief                        instance  0 6 * * *                                         true     The brief.',
      'acme-brief-clinical \u2192 acme-brief  instance  {"freq":"weekly","byweekday":0,"timezone":"UTC"}  true     The clinical brief.',
      'acme-brief-industry \u2192 acme-brief  instance  0 7 * * 1-5                                       false    The industry brief.',
    ]);
  });

  it('run under their own ids: crash labels, argv, config and worker job ids never shared', async () => {
    for (const id of [
      'acme-brief-industry',
      'acme-brief-clinical',
      'acme-brief',
    ])
      expect(await runJob(root(), id, [], { ...options, runDeps })).toBe(0);
    await vi.waitFor(() => {
      expect(dispatchDeps.runDispatcher).toHaveBeenCalledTimes(3);
    });
    expect(labels).toEqual([
      'acme-brief-industry',
      'acme-brief-clinical',
      'acme-brief',
    ]);
    expect(runs).toEqual([
      {
        jobId: 'acme-brief-industry',
        argv: 'acme-brief-industry',
        config: { channel: 'C000EXAMPLE1', recipients: ['jane@example.com'] },
      },
      {
        jobId: 'acme-brief-clinical',
        argv: 'acme-brief-clinical',
        // Arrays replace (Decision 81).
        config: { channel: 'C000EXAMPLE1', recipients: ['john@example.com'] },
      },
      {
        jobId: 'acme-brief',
        argv: 'acme-brief',
        config: { channel: 'C000EXAMPLE1', recipients: ['jane@example.com'] },
      },
    ]);
    expect(
      dispatchDeps.runDispatcher.mock.calls.map(([, o]) => o.jobId),
    ).toEqual(['acme-brief-industry', 'acme-brief-clinical', 'acme-brief']);
  });

  it('check flags as the job, naming its id', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    expect(
      await runJob(root(), 'acme-brief-clinical', ['--nope'], options),
    ).toBe(1);
    expect(error).toHaveBeenCalledWith(
      'Unknown option --nope for acme-brief-clinical (see run acme-brief-clinical --help)',
    );
  });

  it('show <jobId> \u2192 <runnable> in job help and doctor', async () => {
    const help = await jobHelp(root(), 'acme-brief-clinical', options);
    expect(help).toMatch(
      /^Usage: jeeves-scripts run acme-brief-clinical \[options\]\n\nacme-brief-clinical \u2192 acme-brief\n/,
    );
    expect(help).toContain('"runnable": "acme-brief"');
    expect(await jobHelp(root(), 'acme-brief', options)).toMatch(
      /^Usage: jeeves-scripts run acme-brief \[options\]\n\nOptions:/,
    );
    const lines = await doctorReport(root(), { ...options, version: '0.4.0' });
    expect(lines).toContain(
      '  acme-brief-clinical \u2192 acme-brief: enabled; prerequisite: met',
    );
    expect(lines).toContain(
      '  acme-brief-industry \u2192 acme-brief: disabled; prerequisite: met',
    );
    expect(lines).toContain('  acme-brief: enabled; prerequisite: met');
  });

  it('may run a manifest-less core runnable, with its config', async () => {
    writeManifests({
      acme: acmeManifest(),
      mail: {
        'email-inventory-archive': {
          ...entryFields,
          runnable: 'email-inventory',
          name: 'Archive inventory',
          description: 'Count archived threads.',
          schedule: '@daily',
        },
      },
    });
    writeConfig({
      ...baseJobs,
      'email-inventory-archive': { config: { folder: 'Archive' } },
    });
    const entries = await listRunnables(root(), 'email-*', options);
    expect(entries.map((e) => [e.id, e.runnable, e.source])).toEqual([
      ['email-inventory', undefined, 'core'],
      ['email-inventory-archive', 'email-inventory', 'core'],
    ]);
    expect(entries[1]?.manifest?.domain).toBe('email');
  });
});

describe('a removed job entry', () => {
  it('leaves the effective manifests, and is no longer a job', async () => {
    const { 'acme-brief-clinical': _gone, ...rest } = acmeManifest();
    writeManifests({ acme: rest });
    const { 'acme-brief-clinical': _delta, ...jobs } = baseJobs;
    writeConfig(jobs);
    const entries = await listRunnables(root(), '*', options);
    expect(entries.map((e) => e.id)).not.toContain('acme-brief-clinical');
    expect(entries.map((e) => e.id)).toContain('acme-brief-industry');
    await expect(
      runJob(root(), 'acme-brief-clinical', [], options),
    ).rejects.toThrow(/^Unknown runnable "acme-brief-clinical"/);
  });
});

describe('existing jobs', () => {
  it('list exactly as before when jobs running a runnable are added (snapshot)', async () => {
    const {
      'acme-brief-clinical': _c,
      'acme-brief-industry': _i,
      ...own
    } = acmeManifest();
    writeManifests({ acme: own });
    writeConfig({ 'acme-brief': baseJobs['acme-brief'] });
    const before = await listRunnables(root(), '*', options);
    expect(formatList(before)).toEqual([
      'id               source    schedule   enabled  description',
      'acme-brief       instance  0 6 * * *  true     The brief.',
      'acme-plain       instance                      No config.',
      'email-inventory  core                          Count threads.',
    ]);
    writeManifests({ acme: acmeManifest() });
    writeConfig();
    const after = await listRunnables(root(), '*', options);
    const existing = new Set(before.map((e) => e.id));
    expect(after.filter((e) => existing.has(e.id))).toEqual(before);
    expect(
      JSON.stringify(
        after.filter((e) => existing.has(e.id)),
        null,
        2,
      ),
    ).toBe(JSON.stringify(before, null, 2));
  });
});
