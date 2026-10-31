/**
 * Tests for the daily-briefing family (#33): the core templates fill with
 * the briefing values, share the carry-forward and checkbox rules, ship
 * the standing-orders seed and `.meta/` steer, and the Slack summary
 * shape is job-script config.
 */

import fs from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  coreTaskTemplatePath,
  fillTaskTemplate,
} from '../../lib/task-template.js';
import { slackPostTargetSchema } from '../../lib/worker-slack/worker-slack-config.js';
import {
  BRIEFING_NOT_ENABLED,
  BRIEFING_TEMPLATES,
  briefingSummaryPurpose,
  briefingVars,
} from './briefing.js';

const read = (name: string): string =>
  fs.readFileSync(coreTaskTemplatePath(name), 'utf8');

const input = {
  org: 'Acme',
  principal: 'Ana',
  delegates: 'Bo (ops)',
  timeZone: 'America/Chicago',
  deliveryChannel: '#brief',
  briefingDir: '/c/brief',
  eodDir: '/c/eod',
  marketIntelDir: '/c/intel',
};
const vars = briefingVars(input);

const RULES = '{{> daily-briefings/briefing-rules.md}}';

/** A template filled as the dispatcher fills it (it adds `runMode`). */
const fill = (
  name: string,
  values: Readonly<Record<string, string>> = vars,
  runMode = 'scheduled',
): string => fillTaskTemplate(read(name), { runMode, ...values });

const withoutCompanions = briefingVars({
  org: 'Acme',
  principal: 'Ana',
  delegates: 'none',
  timeZone: 'UTC',
  deliveryChannel: '#b',
  briefingDir: '/c/b',
});

describe('briefingVars', () => {
  it('leaves unset companion directories out, and the morning briefing reads them as not enabled', () => {
    expect(withoutCompanions).toEqual({
      org: 'Acme',
      principal: 'Ana',
      delegates: 'none',
      timeZone: 'UTC',
      deliveryChannel: '#b',
      briefingDir: '/c/b',
      eodSource: BRIEFING_NOT_ENABLED,
      marketIntelSource: BRIEFING_NOT_ENABLED,
    });
    expect(BRIEFING_NOT_ENABLED).toBe('not enabled');
  });

  it('keeps configured companion directories and reads them as such', () => {
    expect(vars).toMatchObject({
      eodDir: '/c/eod',
      eodSource: '/c/eod',
      marketIntelDir: '/c/intel',
      marketIntelSource: '/c/intel',
    });
  });

  it.each(['briefingDir', 'eodDir', 'marketIntelDir'])(
    'requires %s to be absolute',
    (key) => {
      expect(() => briefingVars({ ...input, [key]: 'rel/dir' })).toThrow(
        `${key} must be an absolute path`,
      );
    },
  );

  it('rejects an unknown time zone and an empty value, naming both', () => {
    expect(() =>
      briefingVars({ ...input, timeZone: 'Mars/Base', org: ' ' }),
    ).toThrow(
      /^Invalid briefing values: [\s\S]*org[\s\S]*timeZone must be an IANA time zone/,
    );
  });
});

describe.each(Object.entries(BRIEFING_TEMPLATES))('%s template', (_, name) => {
  it('fills completely from the briefing values', () => {
    const task = fill(name);
    expect(task).not.toMatch(/\{\{/);
    expect(task).toContain('Acme');
    expect(task).toContain('#brief');
    expect(task).toContain('America/Chicago');
  });

  it('never tells the worker to post, and sends status to the operator only', () => {
    const text = read(name);
    expect(text).toContain('you never post anything yourself');
    expect(text).toContain('go to the operator only');
    expect(text).not.toMatch(/message tool/i);
  });
});

describe('the briefing rules', () => {
  it('are shared by the morning briefing and the end-of-day list, not market intel', () => {
    expect(read(BRIEFING_TEMPLATES.morning)).toContain(RULES);
    expect(read(BRIEFING_TEMPLATES.eod)).toContain(RULES);
    expect(read(BRIEFING_TEMPLATES.marketIntel)).not.toContain(RULES);
  });

  it('state carry-forward across both artifacts and checkbox reconciliation', () => {
    const rules = read('daily-briefings/briefing-rules.md');
    expect(rules).toContain('The more recent of the two is the baseline.');
    expect(rules).toContain(
      'Items in the older one that are missing from the newer one carry forward too',
    );
    expect(rules).toContain(
      'Checkbox state beats chat feedback when they conflict.',
    );
    expect(rules).toContain(
      'When both artifacts hold the same item, the more recent checkbox state wins.',
    );
  });

  it('use the dispatcher date and the delivery channel as the feedback channel', () => {
    const task = fill(BRIEFING_TEMPLATES.morning);
    expect(task).toContain(
      'Use the date line at the top of this task, in America/Chicago.',
    );
    expect(task).toContain(
      'Feedback in #brief that states a lasting preference',
    );
  });
});

describe('the morning briefing', () => {
  it('writes the dated file in the reference shape with checkbox items', () => {
    const task = fill(BRIEFING_TEMPLATES.morning);
    expect(task).toContain('`/c/brief/YYYY-MM-DD-daily-briefing.md`');
    for (const heading of [
      '## BLUF (Bottom Line Up Front)',
      '## Market Intel Highlights',
      '### 🔴 Urgent / Time-Sensitive',
      "### 🟡 Open — Awaiting Ana's Action",
      '### 🔵 Open — Awaiting Others',
      '### ✅ Completed Since Last Briefing',
      '## Upcoming Calendar',
      '## Sources',
    ])
      expect(task).toContain(heading);
    expect(task).toContain(
      '- [ ] **[<Status> — <Source>] <One-line headline>**',
    );
  });

  it('reads the companion reports from their directories, or works without them', () => {
    const task = fill(BRIEFING_TEMPLATES.morning);
    expect(task).toContain('the latest end-of-day list in `/c/eod`');
    expect(task).toContain("Today's market intel in `/c/intel`");
    expect(task).toContain(
      'If either says `not enabled`, use the other alone.',
    );
  });

  it('says without companions that they are not enabled, in reading context only', () => {
    const task = fill(BRIEFING_TEMPLATES.morning, withoutCompanions);
    expect(task).toContain('the latest end-of-day list in `not enabled`');
    expect(task).toContain("Today's market intel in `not enabled`");
    expect(task).not.toContain('not enabled/');
  });

  it.each([
    [BRIEFING_TEMPLATES.morning, 'briefing'],
    [BRIEFING_TEMPLATES.eod, 'list'],
  ])(
    '%s tells the worker how it was started, so its on-demand rule applies',
    (name, artifact) => {
      expect(fill(name, vars, 'on-demand')).toContain(
        `This run is on-demand: on an on-demand run, read everything since the latest ${artifact} instead.`,
      );
      expect(fill(name, vars, 'scheduled')).toContain('This run is scheduled:');
      expect(() => fillTaskTemplate(read(name), vars)).toThrow(
        'task template needs a value for {{runMode}}',
      );
    },
  );

  it('has the format reference heading and market-intel block, line for line', () => {
    const lines = fill(BRIEFING_TEMPLATES.morning).split('\n');
    expect(lines).toContain('# Acme CEO Daily Briefing \u2014 YYYY-MM-DD');
    const at = lines.indexOf('## Market Intel Highlights');
    expect(lines.slice(at, at + 5)).toEqual([
      '## Market Intel Highlights',
      '',
      "- 3-4 headlines from today's market intel report",
      'Full report: [<title> \u2014 YYYY-MM-DD](<insider link>)',
      '',
    ]);
  });
});

describe('the end-of-day list and market intel', () => {
  it('write their own dated files', () => {
    expect(fill(BRIEFING_TEMPLATES.eod)).toContain(
      '`/c/eod/YYYY-MM-DD-eod-follow-up.md`',
    );
    expect(fill(BRIEFING_TEMPLATES.marketIntel)).toContain(
      '`/c/intel/YYYY-MM-DD-market-intel.md`',
    );
  });

  it.each([
    [BRIEFING_TEMPLATES.eod, 'eodDir'],
    [BRIEFING_TEMPLATES.marketIntel, 'marketIntelDir'],
  ])(
    '%s fails the run without its own directory, never writing to a made-up path',
    (name, key) => {
      expect(() => fill(name, withoutCompanions)).toThrow(
        `task template needs a value for {{${key}}}`,
      );
    },
  );

  it('market intel validates every URL and keeps internal items out', () => {
    const text = read(BRIEFING_TEMPLATES.marketIntel);
    expect(text).toContain('Validate every external URL before you cite it');
    expect(text).toContain('never include internal action items');
  });
});

describe('the standing-orders seed and the .meta steer', () => {
  it('seed has the reference sections, with Cleared Items as permanent suppressions', () => {
    const seed = read('daily-briefings/standing-orders.seed.md');
    for (const heading of [
      '## Report structure',
      '## Content focus',
      '## Handling rules for recurring noise',
      '## Cleared Items',
    ])
      expect(seed).toContain(heading);
    expect(seed).toContain('Append-only.');
  });

  it('steer asks for conformance auditing and the size trend', () => {
    const steer = read('daily-briefings/meta-steer.md');
    expect(steer).toContain('audit conformance');
    expect(steer).toContain('how report size is trending');
  });
});

describe('briefingSummaryPurpose', () => {
  it('fixes the summary shape with the default bullets', () => {
    expect(
      briefingSummaryPurpose({ emoji: '📋', title: 'Acme CEO Daily Briefing' }),
    ).toBe(
      'the Acme CEO Daily Briefing summary, never the full document. Exactly: the line "📋 *Acme CEO Daily Briefing — YYYY-MM-DD*", a blank line, 3-5 BLUF bullets as "• " lines with *bold* key phrases, a blank line, then the jeeves-server link to today\'s full report.',
    );
  });

  it('takes other bullets and is a valid post purpose', () => {
    const purpose = briefingSummaryPurpose({
      emoji: '🌐',
      title: 'Acme Market Intel',
      bullets: '3-4 highlights',
    });
    expect(purpose).toContain(', 3-4 highlights as "• " lines');
    expect(
      slackPostTargetSchema.parse({ target: 'C000EXAMPLE1', purpose }).purpose,
    ).toBe(purpose);
  });
});
