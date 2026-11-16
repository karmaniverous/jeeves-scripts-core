/**
 * Registration of a job that runs another runnable (Decision 80): each
 * rule fails `config check`, `list` and `run` alike, naming the job id
 * and its manifest file; so does an invalid merged config (Decision 81).
 */

import { describe, expect, it } from 'vitest';

import { instanceConfigCheck } from './config-check.js';
import {
  acmeManifest,
  baseJobs,
  entryFields,
  options,
  root,
  runs,
  useJobInstancesSandbox,
  writeConfig,
  writeManifests,
} from './job-instances.test-helper.js';
import { listRunnables } from './list.js';
import { runJob } from './run.js';

useJobInstancesSandbox();

describe('registration of a job entry', () => {
  const bad = (entry: Record<string, unknown>, id = 'acme-brief-x') => ({
    [id]: {
      ...entryFields,
      name: 'X',
      description: 'X.',
      schedule: '@daily',
      ...entry,
    },
  });

  it.each([
    [
      'an unknown runnable',
      bad({ runnable: 'acme-gone' }),
      '- jobs/extra.json: job "acme-brief-x" runs "acme-gone", which is not a registered runnable',
    ],
    [
      'a job id outside the runnable domain',
      bad({ runnable: 'email-inventory' }),
      '- jobs/extra.json: job "acme-brief-x" must start with "email-", the domain of runnable "email-inventory"',
    ],
    [
      'a runnable without a configSchema',
      bad({ runnable: 'acme-plain' }, 'acme-plain-x'),
      '- jobs/extra.json: job "acme-plain-x" runs "acme-plain", which declares no configSchema',
    ],
  ])(
    'fails config check, list and run on %s, naming the job and file',
    async (_label, entries, problem) => {
      writeManifests({ acme: acmeManifest(), extra: entries });
      const [jobId = ''] = Object.keys(entries);
      const check = await instanceConfigCheck(root(), undefined, options);
      expect(check.ok).toBe(false);
      expect(check.errors.join('\n')).toContain(problem);
      await expect(listRunnables(root(), '*', options)).rejects.toThrow(
        problem,
      );
      await expect(runJob(root(), jobId, [], options)).rejects.toThrow(problem);
    },
  );

  it('fails config check and list on a job id that is a runnable id (run runs the runnable)', async () => {
    writeManifests({
      acme: acmeManifest(),
      extra: bad({ runnable: 'acme-brief' }, 'acme-plain'),
    });
    const problem =
      '- jobs/extra.json: job "acme-plain" collides with the runnable of that id';
    const check = await instanceConfigCheck(root(), undefined, options);
    expect(check.errors.join('\n')).toContain(problem);
    await expect(listRunnables(root(), '*', options)).rejects.toThrow(problem);
  });

  it('fails on another job id', async () => {
    writeManifests({
      acme: acmeManifest(),
      extra: bad({ runnable: 'acme-brief' }, 'acme-brief-clinical'),
    });
    await expect(listRunnables(root(), '*', options)).rejects.toThrow(
      /acme-brief-clinical.*is in both/,
    );
  });

  it('fails when a core manifest sets runnable', async () => {
    await expect(
      listRunnables(root(), '*', {
        ...options,
        coreManifests: [
          {
            id: 'email-inventory',
            domain: 'email',
            runnable: 'email-inventory',
            name: 'X',
            description: 'X.',
            schedule: '@daily',
            ...entryFields,
          },
        ],
      }),
    ).rejects.toThrow(
      '- core manifest "email-inventory" sets runnable; only instance manifests may',
    );
  });

  it('fails config check, list and run on an invalid merged config, by job id', async () => {
    writeConfig({
      ...baseJobs,
      'acme-brief-clinical': { config: { recipients: 'john@example.com' } },
    });
    const problem =
      '- job "acme-brief-clinical": invalid config (jobs.acme-brief.config merged with jobs.acme-brief-clinical.config): ';
    const check = await instanceConfigCheck(root(), undefined, options);
    expect(check.errors.join('\n')).toContain(problem);
    await expect(listRunnables(root(), '*', options)).rejects.toThrow(problem);
    await expect(
      runJob(root(), 'acme-brief-clinical', [], options),
    ).rejects.toThrow(problem);
    expect(runs).toEqual([]);
  });
});
