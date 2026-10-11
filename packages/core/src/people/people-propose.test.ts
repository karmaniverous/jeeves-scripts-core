import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

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
    expect(peopleProposeJob.description).toBeTruthy();
  });

  it('prints the proposal, passing --all through', async () => {
    const d = deps();
    await peoplePropose(['--all'], d);
    expect(d.propose).toHaveBeenCalledWith({ all: true });
    expect(d.write).toHaveBeenCalledWith(
      `${JSON.stringify(proposal, null, 2)}\n`,
    );
  });

  it('also writes --out', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'people-propose-'));
    const out = path.join(dir, 'proposal.json');
    const d = deps();
    await peoplePropose(['--out', out], d);
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
    await expect(peoplePropose(['--out', out], d)).rejects.toThrow(
      'people-propose never writes jeeves-scripts.json',
    );
    expect(d.propose).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('rejects an unknown option', async () => {
    await expect(peoplePropose(['--bogus'], deps())).rejects.toThrow(/bogus/);
  });
});
