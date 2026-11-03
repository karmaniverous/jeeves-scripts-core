/**
 * Tests for the worker TASK: the date line, the paths and proposals it
 * names, and that the report format it asks for passes validation.
 */

import { describe, expect, it } from 'vitest';

import { validateReport } from './report.js';
import { buildTask } from './task.js';

describe('buildTask', () => {
  const task = buildTask({
    indexFile: '/run/INDEX.md',
    runDir: '/run',
    reportFile: '/run/report.md',
    deliveredReport: '/out/2026-10-20.md',
    proposalIds: ['a-1', 'b-2'],
    now: new Date('2026-10-20T12:00:00Z'),
    timeZone: 'UTC',
  });

  it('starts with the date in the configured zone', () => {
    expect(task.startsWith('> **Today is Tuesday, 2026-10-20 (UTC).**')).toBe(
      true,
    );
  });

  it('names the snapshot, the report file, the delivered report and every proposal, and forbids posting', () => {
    for (const text of [
      '`/run/INDEX.md`',
      'Run directory: `/run`',
      'to `/run/report.md`',
      '`/out/2026-10-20.md`',
      'Pending proposals (2):',
      '- `a-1`\n- `b-2`',
      'never post to Slack',
    ])
      expect(task).toContain(text);
  });

  it('asks for a report format that validateReport accepts', () => {
    const template = /````markdown\n([\s\S]*?)````/.exec(task)?.[1] ?? '';
    const [head = '', section = ''] = template.split(/(?=### <proposal id>)/);
    const report =
      head +
      ['a-1', 'b-2']
        .map((id) =>
          section
            .replace('<proposal id>', id)
            .replace(
              /<Approve as is \| Approve with modifications \| Reject or decline \| Not reviewed>/,
              'Approve with modifications',
            )
            .replace('<one line, plain language>', 'Does a thing.')
            .replace('<one line, stands alone>', 'Apply it.'),
        )
        .join('\n');
    expect(validateReport(report, ['a-1', 'b-2']).counts).toEqual({
      'Approve as is': 0,
      'Approve with modifications': 2,
      'Reject or decline': 0,
      'Not reviewed': 0,
    });
  });
});
