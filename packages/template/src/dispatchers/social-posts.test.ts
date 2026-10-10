/**
 * The social-posts dispatcher (template example): task built from `pipeline.refs`, posts
 * limited to the social channel and the operator DM, skipped when the
 * Notion database is not configured.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  run: { fn: undefined as undefined | (() => Promise<void>) },
  dispatchWithSlack: vi.fn(),
  refs: {} as Record<string, string>,
}));

vi.mock('@karmaniverous/jeeves', () => ({
  runScript: (_name: string, fn: () => Promise<void>) => {
    mocks.run.fn = fn;
  },
}));
vi.mock('@karmaniverous/jeeves-scripts-core', () => ({
  tryGetRef: (key: string) => mocks.refs[key],
}));
vi.mock('@karmaniverous/jeeves-scripts-core/lib/constants', () => ({
  constants: () => ({ CONTENT_DIR: '/content' }),
}));
vi.mock('@karmaniverous/jeeves-scripts-core/lib/worker-slack/run', () => ({
  dispatchWithSlack: mocks.dispatchWithSlack,
}));

const { buildTask } = await import('./social-posts.js');

const REFS = {
  'notion.socialPostsDatabaseId': 'db1',
  'slack.socialChannel': 'C0SOCIAL',
  'slack.operatorDm': 'D0OPS',
};

describe('generate-social-posts', () => {
  beforeEach(() => {
    mocks.refs = { ...REFS };
    mocks.dispatchWithSlack.mockReset();
  });

  it('builds the task from the refs and content paths', () => {
    const { task, slack } = buildTask();
    expect(task).toContain('Write to Notion DB db1.');
    expect(task).toContain('blotter.md');
    expect((slack.posts ?? []).map((p) => p.target)).toEqual(['C0SOCIAL', 'D0OPS']);
  });

  it('throws when a ref is missing', () => {
    delete mocks.refs['slack.operatorDm'];
    expect(() => buildTask()).toThrow(/Missing required pipeline.refs/);
  });

  it('dispatches with the two allowed posts, or skips when unconfigured', async () => {
    await mocks.run.fn?.();
    expect(mocks.dispatchWithSlack).toHaveBeenCalledWith(
      buildTask().task,
      { jobId: 'generate-social-posts', thinking: 'low' },
      buildTask().slack,
    );
    mocks.dispatchWithSlack.mockReset();
    mocks.refs = {};
    await mocks.run.fn?.();
    expect(mocks.dispatchWithSlack).not.toHaveBeenCalled();
  });
});
