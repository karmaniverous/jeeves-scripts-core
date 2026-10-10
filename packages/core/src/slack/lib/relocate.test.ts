/**
 * Tests for relocating Slack archives between silos: planning, merging,
 * clashes, live moves and idempotence, on temp silos.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ChannelInfo } from './channel-info.js';
import {
  applyRelocation,
  formatPlan,
  planRelocation,
  planRoutes,
  targetTeam,
} from './relocate.js';

let dir: string;
let jgs: string;
let vc: string;

const teams = { default: 'Tjgs', vc: 'Tvc' };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relocate-'));
  jgs = path.join(dir, 'domains');
  vc = path.join(dir, 'veterancrowd');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const put = (base: string, dirName: string, file: string, body: string) => {
  const f = path.join(base, 'slack', dirName, file);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, body);
};

const plan = (channels: Record<string, ChannelInfo>) =>
  planRelocation({
    channels,
    accountTeams: teams,
    silos: [
      { name: '(default)', basePath: jgs },
      { name: 'veterancrowd', basePath: vc },
    ],
    basePathFor: (t) => (t === 'Tvc' ? vc : jgs),
  });

const vcDm: ChannelInfo = {
  name: 'dm-U1',
  type: 'dm',
  _account: 'vc',
  teamId: 'Tjgs',
};

describe('targetTeam', () => {
  it("is the account's workspace for DMs, else the cached one", () => {
    expect(targetTeam(vcDm, teams)).toBe('Tvc');
    expect(
      targetTeam(
        { name: 'c', type: 'channel', teamId: 'Tjgs', _account: 'vc' },
        teams,
      ),
    ).toBe('Tjgs');
    expect(targetTeam({ name: 'c', type: 'channel' }, teams)).toBeUndefined();
  });
});

describe('planRelocation', () => {
  it('plans a VC DM out of the default silo, merging identical files', () => {
    put(jgs, 'dm-U1 (D1)', '1.json', 'a');
    put(jgs, 'dm-U1 (D1)', '.meta/meta.json', 'm');
    put(jgs, 'dm-U1 (D1)', '2.json', 'same');
    put(vc, 'dm-U1 (D1)', '2.json', 'same');
    put(jgs, 'general (C1)', '1.json', 'x');
    put(jgs, 'ghost (C9)', '1.json', 'x');
    const p = plan({
      D1: vcDm,
      C1: { name: 'general', type: 'channel', teamId: 'Tjgs' },
    });
    expect(p.moves).toHaveLength(1);
    expect(p.moves[0]).toMatchObject({
      channelId: 'D1',
      fromSilo: '(default)',
      toSilo: 'veterancrowd',
      move: [path.join('.meta', 'meta.json'), '1.json'],
      merge: ['2.json'],
      clash: [],
    });
    expect(p.unknown).toEqual([path.join(jgs, 'slack', 'ghost (C9)')]);
    expect(planRoutes(p)).toEqual({ '(default) -> veterancrowd': 3 });
    expect(formatPlan(p, false)).toContain(
      'files to move: 2; identical (merge): 1; clashes: 0',
    );
  });

  it('moves into an existing target directory of the same channel under another name', () => {
    put(jgs, 'dm-U1 (D1)', '1.json', 'a');
    put(vc, 'old-name (D1)', '0.json', 'b');
    expect(plan({ D1: vcDm }).moves[0]?.to).toBe(
      path.join(vc, 'slack', 'old-name (D1)'),
    );
  });
});

describe('applyRelocation', () => {
  it('moves, merges, removes the emptied source, and is idempotent', () => {
    put(jgs, 'dm-U1 (D1)', '1.json', 'a');
    put(jgs, 'dm-U1 (D1)', '2.json', 'same');
    put(vc, 'dm-U1 (D1)', '2.json', 'same');
    applyRelocation(plan({ D1: vcDm }));
    expect(fs.readdirSync(path.join(vc, 'slack', 'dm-U1 (D1)')).sort()).toEqual(
      ['1.json', '2.json'],
    );
    expect(fs.existsSync(path.join(jgs, 'slack', 'dm-U1 (D1)'))).toBe(false);
    expect(plan({ D1: vcDm }).moves).toEqual([]);
  });

  it('stops on a clash before moving anything', () => {
    put(jgs, 'dm-U1 (D1)', '1.json', 'a');
    put(jgs, 'dm-U1 (D1)', '2.json', 'mine');
    put(vc, 'dm-U1 (D1)', '2.json', 'theirs');
    const p = plan({ D1: vcDm });
    expect(p.totals.clash).toBe(1);
    expect(formatPlan(p, true)).toContain('CLASH 2.json');
    expect(() => {
      applyRelocation(p);
    }).toThrow(/1 clash/);
    expect(fs.existsSync(path.join(jgs, 'slack', 'dm-U1 (D1)', '1.json'))).toBe(
      true,
    );
  });

  it('never overwrites a file that appeared after planning', () => {
    put(jgs, 'dm-U1 (D1)', '1.json', 'a');
    const p = plan({ D1: vcDm });
    put(vc, 'dm-U1 (D1)', '1.json', 'late');
    expect(() => {
      applyRelocation(p);
    }).toThrow(/appeared since planning/);
    expect(
      fs.readFileSync(path.join(vc, 'slack', 'dm-U1 (D1)', '1.json'), 'utf8'),
    ).toBe('late');
  });
});
