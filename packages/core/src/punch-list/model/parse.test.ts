import { describe, expect, it } from 'vitest';

import { samplePunchList } from '../punch-list.test-helper.js';
import { parsePunchList } from './parse.js';
import { renderPunchList } from './render.js';
import { emptyPunchList, PunchListParseError } from './types.js';

describe('parse/render', () => {
  it('round-trips', () => {
    expect(parsePunchList(renderPunchList(samplePunchList))).toEqual(
      samplePunchList,
    );
  });

  it('round-trips an empty list and renders placeholders', () => {
    const text = renderPunchList(emptyPunchList('2026-10-18'));
    expect(text).toContain('## Backlog\n\n_None._');
    expect(parsePunchList(text)).toEqual(emptyPunchList('2026-10-18'));
  });

  it('gives a typed entry without an id a fresh id', () => {
    const text = renderPunchList(emptyPunchList('2026-10-18')).replace(
      '## Tasks\n\n_None._',
      '## Tasks\n\n- [ ] **Upload the Acme logo** — Slack app · added 2026-10-18',
    );
    const task = parsePunchList(text).tasks[0] ?? { id: '', text: '' };
    expect(task.id).toMatch(/^t-[0-9a-f]{8}$/);
    expect(task.text).toBe(
      '**Upload the Acme logo** — Slack app · added 2026-10-18',
    );
  });

  it('renders Integrated with a ticked box and its date, and reads an untick', () => {
    const text = renderPunchList(samplePunchList);
    expect(text).toContain('- [x] Integrated 2026-09-01');
    const unticked = parsePunchList(
      text.replace(
        '- [x] Integrated 2026-09-01',
        '- [ ] Integrated 2026-09-01',
      ),
    );
    expect(unticked.integrated[0]).toMatchObject({
      integrated: false,
      integratedOn: '2026-09-01',
    });
  });

  it('reads a ticked Done box', () => {
    const text = renderPunchList(samplePunchList).replace(
      '- [ ] Integrated',
      '- [x] Integrated',
    );
    expect(parsePunchList(text).done[0]?.integrated).toBe(true);
  });

  it.each([
    ['no title', '## Tasks\n'],
    ['unknown section', '# Punch List — 2026-10-18\n\n## Ideas\n'],
    ['bad entry', '# Punch List — 2026-10-18\n\n## Tasks\n\nfree text\n'],
    [
      'wrong id prefix',
      '# Punch List — 2026-10-18\n\n## Tasks\n\n- [ ] x · `b-00000000`\n',
    ],
    [
      'integrated without date',
      '# Punch List — 2026-10-18\n\n## Integrated\n\n### acme-x — X\n',
    ],
  ])('rejects %s', (_, text) => {
    expect(() => parsePunchList(text)).toThrow(PunchListParseError);
  });
});

describe('parsePunchList structure errors', () => {
  const head = '# Punch List \u2014 2026-10-18\n\n';
  it.each([
    [
      'an unknown section',
      `${head}## Nope\n`,
      'punch list file: unknown section: "## Nope"',
    ],
    [
      'a duplicate section',
      `${head}## Tasks\n\n## Tasks\n`,
      'punch list file: duplicate section: "## Tasks"',
    ],
    [
      'text before the first section',
      `${head}stray\n## Tasks\n`,
      'punch list file: text before the first section: "stray"',
    ],
    [
      'text before the first milestone',
      `${head}## TODO\n\nstray\n`,
      'punch list TODO: text before the first milestone: "stray"',
    ],
  ])('rejects %s', (_, text, message) => {
    expect(() => parsePunchList(text)).toThrow(message);
  });
});
