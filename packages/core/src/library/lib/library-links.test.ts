import { describe, expect, it } from 'vitest';

import {
  indexLinkTargets,
  linkPattern,
  rewriteLinks,
} from './library-links.js';

const SITE = { pattern: '/skill/{name}', target: '{dir}/SKILL.md' };
const index = indexLinkTargets(
  [
    'author-a/writing-style/SKILL.md',
    'author-a/writing-style/references/notes.md',
    'author-a/scorecard/SKILL.md',
    'author-a/reporting/SKILL.md',
    'author-b/cold-email/SKILL.md',
    'author-b/shared-name/SKILL.md',
    'author-c/shared-name/SKILL.md',
    'README.md',
  ],
  SITE.target,
);
const pattern = linkPattern(SITE.pattern);
const rewrite = (text: string, file = 'author-a/reporting/SKILL.md') =>
  rewriteLinks(text, file, index, pattern);

describe('indexLinkTargets', () => {
  it('indexes only files matching the target, by the last {dir} segment', () => {
    expect(Object.fromEntries(index)).toEqual({
      'writing-style': ['author-a/writing-style/SKILL.md'],
      scorecard: ['author-a/scorecard/SKILL.md'],
      reporting: ['author-a/reporting/SKILL.md'],
      'cold-email': ['author-b/cold-email/SKILL.md'],
      'shared-name': [
        'author-b/shared-name/SKILL.md',
        'author-c/shared-name/SKILL.md',
      ],
    });
  });

  it('takes the placeholder anywhere in the target', () => {
    const docs = indexLinkTargets(
      ['docs/guides/setup.md', 'docs/a.txt', 'other/setup.md'],
      'docs/{dir}.md',
    );
    expect(Object.fromEntries(docs)).toEqual({
      setup: ['docs/guides/setup.md'],
    });
  });
});

describe('rewriteLinks', () => {
  it('rewrites a same-directory site link to a relative target link', () => {
    const r = rewrite('See [/skill/writing-style](/skill/writing-style).');
    expect(r).toEqual({
      text: 'See [/skill/writing-style](../writing-style/SKILL.md).',
      rewritten: 1,
    });
  });

  it('keeps anchors and tolerates a trailing slash', () => {
    expect(rewrite('[x](/skill/scorecard/#metrics)').text).toBe(
      '[x](../scorecard/SKILL.md#metrics)',
    );
  });

  it('resolves a unique name under another top-level directory', () => {
    expect(
      rewrite(
        '[c](/skill/cold-email)',
        'author-a/writing-style/references/notes.md',
      ).text,
    ).toBe('[c](../../../author-b/cold-email/SKILL.md)');
  });

  it('prefers the target under the same top-level directory when a name is shared', () => {
    expect(
      rewrite('[s](/skill/shared-name)', 'author-c/other/SKILL.md').text,
    ).toBe('[s](../shared-name/SKILL.md)');
  });

  it('leaves ambiguous and unknown names unchanged', () => {
    const text = '[s](/skill/shared-name) [u](/skill/nope)';
    expect(rewrite(text)).toEqual({ text, rewritten: 0 });
  });

  it('leaves relative, external and other site links unchanged', () => {
    const text =
      '[a](./references/x.md) [b](https://example.com/skill/scorecard) [c](/skills/scorecard)';
    expect(rewrite(text).text).toBe(text);
  });

  it('links from a root-level file without a leading ./', () => {
    expect(rewrite('[c](/skill/cold-email)', 'README.md').text).toBe(
      '[c](author-b/cold-email/SKILL.md)',
    );
  });

  it('matches a pattern with text after {name}, literally', () => {
    const html = linkPattern('/docs/{name}.html');
    const docs = indexLinkTargets(
      ['guides/setup/README.md'],
      '{dir}/README.md',
    );
    expect(
      rewriteLinks(
        '[s](/docs/setup.html#top) [t](/docs/setupxhtml)',
        'index.md',
        docs,
        html,
      ),
    ).toEqual({
      text: '[s](guides/setup/README.md#top) [t](/docs/setupxhtml)',
      rewritten: 1,
    });
  });
});
