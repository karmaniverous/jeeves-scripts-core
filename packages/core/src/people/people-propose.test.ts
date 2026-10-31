import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { argsError } from '../runnables/job-help.js';
import peopleProposeJob, { peoplePropose } from './people-propose.js';
import type { PeopleProposal } from './propose.js';

const proposal = {
  summary: {
    accounts: { default: 1 },
    usersRead: 1,
    proposedPeople: 0,
    multiAccountPeople: 0,
    uncertain: 0,
  },
  people: {},
  uncertain: [],
} as unknown as PeopleProposal;

const deps = () => ({
  propose: vi.fn(() => Promise.resolve(proposal)),
  write: vi.fn(),
  configFile: (): string | undefined => undefined,
});

describe('people-propose', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is a registered-shape runnable in the people domain', () => {
    expect(peopleProposeJob).toMatchObject({
      id: 'people-propose',
      domain: 'people',
    });
  });

  it('prints the proposal, passing --all through', async () => {
    const d = deps();
    await peoplePropose({ all: true }, d);
    expect(d.propose).toHaveBeenCalledWith({ all: true });
    expect(d.write).toHaveBeenCalledWith(
      `${JSON.stringify(proposal, null, 2)}\n`,
    );
  });

  it('also writes --out', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'people-propose-'));
    const out = path.join(dir, 'proposal.json');
    const d = deps();
    await peoplePropose({ out }, d);
    expect(fs.readFileSync(out, 'utf8')).toBe(
      `${JSON.stringify(proposal, null, 2)}\n`,
    );
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it.each([
    'jeeves-scripts.json',
    'JEEVES-SCRIPTS.JSON',
    'sub/Jeeves-Scripts.Json',
  ])('refuses --out %s before reading Slack or writing', async (out) => {
    const write = vi
      .spyOn(fs, 'writeFileSync')
      .mockImplementation(() => undefined);
    const d = deps();
    await expect(peoplePropose({ out }, d)).rejects.toThrow(
      'people-propose never writes the instance config',
    );
    expect(d.propose).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('refuses --out naming the instance config file itself (#62 review)', async () => {
    const write = vi
      .spyOn(fs, 'writeFileSync')
      .mockImplementation(() => undefined);
    const d = {
      ...deps(),
      configFile: () => path.resolve('cfg', 'config.json'),
    };
    await expect(
      peoplePropose({ out: path.join('cfg', 'CONFIG.json') }, d),
    ).rejects.toThrow('people-propose never writes the instance config');
    expect(d.propose).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('declares --all and --out, so run rejects anything else', () => {
    expect(argsError(peopleProposeJob, ['--bogus'])).toMatch(
      /Unknown option --bogus/,
    );
    expect(
      argsError(peopleProposeJob, ['--all', '--out', 'x.json']),
    ).toBeUndefined();
  });
});
