/**
 * Tests for the review flow with injected deps: settings failure,
 * previews, delivery (incl. the script-built Slack post with its skills
 * catalog budget lines and report section, and proposals discovered after
 * the review ran), and missing or invalid reports. The budget's failure
 * path: `review.budget.test.ts`; quiet days: `review.quiet-day.test.ts`.
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { LIST_LIMIT } from './proposals.js';
import { type ReviewDeps, reviewWorkshop } from './review.js';
import {
  DRY_RUN,
  LIVE,
  PRINT_TASK,
  proposal,
  useReviewFlow,
  validReport,
} from './review-flow.test-helper.js';

const { root, deps } = useReviewFlow();

describe('reviewWorkshop', () => {
  it('fails on incomplete settings before gathering', async () => {
    const gather = vi.fn<ReviewDeps['gatherProposals']>();
    const { d } = deps([], undefined, {
      settings: () => ({ problem: 'set it' }),
      gatherProposals: gather,
    });
    await expect(reviewWorkshop(LIVE, d)).rejects.toThrow('set it');
    expect(gather).not.toHaveBeenCalled();
  });

  it.each([
    ['dry run', DRY_RUN],
    ['print task', PRINT_TASK],
  ])(
    'previews on a %s: snapshot written, nothing delivered, no Slack post',
    async (_label, flags) => {
      const { d, lines, posts } = deps([proposal('a')], validReport);
      await expect(reviewWorkshop(flags, d)).resolves.toBe('previewed');
      const [task, passed] = vi.mocked(d.dispatch).mock.calls[0] ?? [];
      // Exactly these, so the runnable's own flags never reach the dispatch.
      expect(passed).toStrictEqual({
        dryRun: true,
        printTask: flags.printTask,
      });
      expect(task).toContain('2026-10-21');
      expect(fs.readdirSync(d.runsRoot)).toEqual(['20261020-233000']);
      expect(fs.existsSync(path.join(root(), 'out'))).toBe(false);
      expect(posts).toEqual([]);
      expect(lines.at(-1)).toContain(
        `the report would go to ${path.join(root(), 'out', '2026-10-21.md')} (homeDir)`,
      );
    },
  );

  it('prints the TASK on a live --print-task run, delivering and posting nothing', async () => {
    const flags = { live: true, printTask: true };
    const { d, posts } = deps([proposal('a')], validReport);
    await expect(reviewWorkshop(flags, d)).resolves.toBe('previewed');
    expect(vi.mocked(d.dispatch).mock.calls[0]?.[1]).toStrictEqual({
      dryRun: false,
      printTask: true,
    });
    expect(fs.existsSync(path.join(root(), 'out'))).toBe(false);
    expect(posts).toEqual([]);
  });

  it('validates the report, delivers it, and posts the script-built Slack summary', async () => {
    const { d, lines, posts } = deps(
      [proposal('a'), proposal('b')],
      validReport,
    );
    await expect(reviewWorkshop(LIVE, d)).resolves.toBe('delivered');
    const file = path.join(root(), 'out', '2026-10-21.md');
    const delivered = fs.readFileSync(file, 'utf8');
    expect(
      delivered.startsWith(
        `${validReport(['a', 'b']).trimEnd()}\n\n## Skills catalog budget\n\nAgent \`main\``,
      ),
    ).toBe(true);
    expect(delivered).toContain('| `jeeves-design` | 381 | jeeves |');
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ channel: 'C123', account: 'review-bot' });
    expect(vi.mocked(d.dispatch).mock.calls[0]?.[1]).toStrictEqual({
      dryRun: false,
      printTask: false,
    });
    expect(posts[0]?.text).toContain(`<link:${file}>`);
    expect(d.reportLink).toHaveBeenCalledWith(file, 'scripts');
    expect(posts[0]?.text).toContain('`a`');
    expect(posts[0]?.text).toContain('`b`');
    expect(posts[0]?.text).toContain(
      '*Skills catalog budget:* 17,100 / 18,000 chars (95.0%), full format; 900 chars (5.0%) to spare.',
    );
    expect(lines.at(-1)).toBe(
      `admin/review-skill-proposals: report ${file}: 0 approve as is, 1 approve with modifications, 1 reject, 0 not yet reviewed, 0 decided since; Slack post sent`,
    );
  });

  it('reconciles with the Workshop at posting time: decided omitted, revised and new under "not yet reviewed"', async () => {
    let calls = 0;
    const revisedB = { ...proposal('b'), updatedAt: '2026-10-21T00:00:00Z' };
    const { d, lines, posts } = deps(
      [proposal('a'), proposal('b'), proposal('c')],
      validReport,
      {
        gatherProposals: () => {
          calls += 1;
          return Promise.resolve(
            calls === 1
              ? [proposal('a'), proposal('b'), proposal('c')]
              : [proposal('a'), revisedB, proposal('d')],
          );
        },
      },
    );
    await expect(reviewWorkshop(LIVE, d)).resolves.toBe('delivered');
    expect(calls).toBe(2);
    const text = posts[0]?.text ?? '';
    expect(text).toContain(
      '_1 reviewed proposal(s) decided since the review ran are omitted._',
    );
    expect(text).not.toContain('`c`');
    expect(text).toContain('2. `b` (new): Revised after this review ran.');
    expect(text).toContain('3. `d` (new): Proposed after this review ran.');
    expect(lines.at(-1)).toMatch(/2 not yet reviewed, 1 decided since;/);
  });

  it('builds the report link before dispatching: a live run fails without spending a worker', async () => {
    const { d, posts } = deps([proposal('a')], validReport, {
      reportLink: () =>
        Promise.reject(
          new Error('jeeves-server could not resolve /abs/x.md (HTTP 404)'),
        ),
    });
    await expect(reviewWorkshop(LIVE, d)).rejects.toThrow(
      'jeeves-server could not resolve /abs/x.md',
    );
    expect(d.dispatch).not.toHaveBeenCalled();
    expect(posts).toEqual([]);
  });

  it('warns on a preview when the report link cannot be built', async () => {
    const { d, lines } = deps([proposal('a')], validReport, {
      reportLink: () => Promise.reject(new Error('no drive')),
    });
    await expect(reviewWorkshop(DRY_RUN, d)).resolves.toBe('previewed');
    expect(d.dispatch).toHaveBeenCalledOnce();
    expect(lines).toContain(
      `[warn] admin/review-skill-proposals: no insider link for ${path.join(root(), 'out', '2026-10-21.md')}; the live run would fail: no drive`,
    );
  });

  it('delivers and posts even when the post-delivery re-gather fails', async () => {
    const { d, lines, posts } = deps([proposal('a')], validReport, {
      gatherProposals: vi
        .fn<ReviewDeps['gatherProposals']>()
        .mockResolvedValueOnce([proposal('a')])
        .mockRejectedValueOnce(new Error('gateway down')),
    });
    await expect(reviewWorkshop(LIVE, d)).resolves.toBe('delivered');
    expect(posts).toHaveLength(1);
    expect(lines).toContain(
      "[warn] admin/review-skill-proposals: couldn't re-check the Workshop before posting; posting the review's snapshot: gateway down",
    );
    expect(posts[0]?.text).toContain("reflects the review's snapshot");
  });

  it('prunes old run directories, keeping the newest', async () => {
    const { d } = deps([proposal('a')]);
    const old = Array.from(
      { length: 14 },
      (_, i) => `202601${String(i + 10)}-000000`,
    );
    for (const n of old)
      fs.mkdirSync(path.join(d.runsRoot, n), { recursive: true });
    await reviewWorkshop(DRY_RUN, d);
    expect(fs.readdirSync(d.runsRoot).sort()).toEqual([
      ...old.slice(1),
      '20261020-233000',
    ]);
  });

  it('fails when the worker wrote no report', async () => {
    const { d } = deps([proposal('a')]);
    await expect(reviewWorkshop(LIVE, d)).rejects.toThrow(
      'The worker wrote no report',
    );
  });

  it('fails on an invalid report without delivering it or posting', async () => {
    const { d, posts } = deps([proposal('a'), proposal('b')], (ids) =>
      validReport(ids.slice(1)),
    );
    await expect(reviewWorkshop(LIVE, d)).rejects.toThrow('no "### a" section');
    expect(fs.existsSync(path.join(root(), 'out'))).toBe(false);
    expect(posts).toEqual([]);
  });

  it('warns when the list may be truncated', async () => {
    const many = Array.from({ length: LIST_LIMIT }, (_, i) =>
      proposal(`p${String(i)}`),
    );
    const { d, lines } = deps(many, undefined, {});
    await reviewWorkshop(DRY_RUN, d);
    expect(lines[0]).toContain(
      `[warn] admin/review-skill-proposals: ${String(LIST_LIMIT)} proposals listed`,
    );
  });
});
