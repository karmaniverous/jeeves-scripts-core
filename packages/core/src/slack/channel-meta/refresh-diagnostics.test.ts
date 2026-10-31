/**
 * Tests that diagnostics can't carry channel text past the text scope:
 * a worker result that is missing, not JSON (whose parser message would
 * quote it) or off the contract (whose issue paths would name other
 * workspaces' channels) is reported with fixed wording and counts, in
 * the live report, the dry-run preview and the Slack summary alike, also
 * when `slack.channelMeta.reportTextAccounts` is `[]`; the full
 * diagnostic goes only to `worker-problem.txt` in the run directory and
 * the job's stderr. A history read that fails with something other than
 * a Slack error code is reported as an unexpected error, its message on
 * stderr only.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from 'vitest';

import type { BlockInput } from './fakes.test-helper.js';
import { refreshChannelMeta } from './refresh.js';
import { DRY, LIVE } from './refresh.test-helper.js';
import { UNEXPECTED } from './report-safe.js';
import {
  onlyRunDir,
  readPreview,
  scopeHarness,
  VC_TEXT,
} from './scope.test-helper.js';
import { WORKER_PROBLEM_FILE } from './worker-batch.js';

let runsRoot = '';
let stderr: MockInstance<typeof console.error>;

beforeEach(() => {
  runsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'channel-meta-runs-'));
  stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  stderr.mockRestore();
  fs.rmSync(runsRoot, { recursive: true, force: true });
});

/** What must never reach a report or summary: every channel's text, and
 * the hidden channels' ids and names. */
const HIDDEN = [
  ...VC_TEXT,
  'Generated one text',
  'Now one',
  'CV1',
  'CV2',
  'alpha',
  'beta',
];

/** Worker results that break the contract, each quoting hidden text. */
const BAD_RESULTS: [string, string | undefined, string, string][] = [
  [
    'not JSON',
    'Now alpha',
    "the worker's result is not valid JSON",
    '"Now alpha" is not valid JSON',
  ],
  [
    'off the contract',
    JSON.stringify({ channels: { CV1: 'Now alpha', CV2: 7, C1: 'Now one' } }),
    "the worker's result does not match the contract (3 issues)",
    'channels.CV1',
  ],
  [
    'missing',
    undefined,
    'the worker wrote no result',
    'the worker wrote no result',
  ],
];

const RUNS: [string, typeof LIVE, Partial<BlockInput>][] = [
  ['live', LIVE, {}],
  ['live, reportTextAccounts []', LIVE, { reportTextAccounts: [] }],
  ['preview', DRY, {}],
  ['preview, reportTextAccounts []', DRY, { reportTextAccounts: [] }],
];

const expectNoHidden = (text: string): void => {
  for (const s of HIDDEN) expect(text).not.toContain(s);
};

describe('refreshChannelMeta: worker diagnostics stay out of the report', () => {
  describe.each(BAD_RESULTS)(
    'a result %s',
    (_name, result, summary, detail) => {
      it.each(RUNS)('%s', async (_run, flags, block) => {
        const h = scopeHarness(runsRoot, ['default'], block, {
          result: () => result,
        });
        const outcome = await refreshChannelMeta(flags, h.deps);
        expect(outcome).toBe(!flags.live ? 'previewed' : 'partial');
        const report = !flags.live
          ? readPreview(runsRoot)
          : (h.delivered[0]?.text ?? '');
        const run = path.basename(onlyRunDir(runsRoot));
        expect(report).toContain(
          `## Worker\n\nNo values set: ${summary}; details in ${WORKER_PROBLEM_FILE} in run directory ${run}`,
        );
        expectNoHidden(report);
        expectNoHidden(h.posts.map((p) => p.text).join('\n'));
        expectNoHidden(h.logs.join('\n'));
        expect(h.apply).not.toHaveBeenCalled();
        const file = path.join(onlyRunDir(runsRoot), WORKER_PROBLEM_FILE);
        expect(fs.readFileSync(file, 'utf8')).toContain(detail);
        expect(stderr).toHaveBeenCalledWith(expect.stringContaining(detail));
      });
    },
  );
});

describe('refreshChannelMeta: other errors stay out of the report', () => {
  it('reports a result that could not be read at all with fixed wording', async () => {
    const h = scopeHarness(
      runsRoot,
      ['default'],
      {},
      {
        result: () => {
          throw new Error('EIO reading Now alpha');
        },
      },
    );
    expect(await refreshChannelMeta(LIVE, h.deps)).toBe('partial');
    const report = h.delivered[0]?.text ?? '';
    expect(report).toContain(
      `No values set: the worker's result could not be used; details in ${WORKER_PROBLEM_FILE}`,
    );
    expectNoHidden(report);
    expect(
      fs.readFileSync(
        path.join(onlyRunDir(runsRoot), WORKER_PROBLEM_FILE),
        'utf8',
      ),
    ).toBe('EIO reading Now alpha\n');
  });

  it('reports a history read that failed oddly as unexpected, its message on stderr only', async () => {
    const h = scopeHarness(
      runsRoot,
      ['default'],
      {},
      {
        files: {},
        history: () =>
          Promise.reject(new Error('Now alpha leaked by a parser')),
      },
    );
    await refreshChannelMeta(LIVE, h.deps);
    const report = h.delivered[0]?.text ?? '';
    expect(report).toContain(`#one (\`C1\`): \`${UNEXPECTED}\``);
    expect(report).not.toContain('Now alpha');
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining('Now alpha leaked by a parser'),
    );
  });
});
