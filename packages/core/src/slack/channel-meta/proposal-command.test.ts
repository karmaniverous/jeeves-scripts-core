/**
 * Tests for the proposed `config set` commands: the repo launcher form,
 * single quotes for every path, one command for both shells unless a
 * path holds a single quote (then one per shell), and, where the shells
 * are installed, that bash and PowerShell really read each path back
 * unchanged.
 */

import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import {
  homeDirCommand,
  proposalLines,
  sharedQuoting,
  type Shell,
  shellQuote,
} from './proposal-command.js';

/** Paths with every character a shell might expand or split on. */
const NASTY = [
  'J:/R&D',
  '/opt/my docs/b',
  '/opt/$HOME/x',
  '/opt/a`b',
  '/opt/a;b|c',
  '/opt/*?!',
  '/opt/(a)<b>',
  '/opt/a"b',
  '/opt/%PATH%',
];

/** Paths holding a quote character one of the shells reads as a quote. */
const QUOTED = ["/opt/o'brien", "/opt/'", '/opt/\u2018curly\u2019'];

describe('shellQuote', () => {
  it.each([
    ['J:/R&D', 'posix', "'J:/R&D'"],
    ['/opt/$HOME/x', 'powershell', "'/opt/$HOME/x'"],
    ['/opt/a`b', 'posix', "'/opt/a`b'"],
    ["/opt/o'brien", 'posix', String.raw`'/opt/o'\''brien'`],
    ["/opt/o'brien", 'powershell', "'/opt/o''brien'"],
    ['/opt/\u2018c\u2019', 'posix', "'/opt/\u2018c\u2019'"],
    ['/opt/\u2018c\u2019', 'powershell', "'/opt/\u2018\u2018c\u2019\u2019'"],
    ['/opt/\u201Ac\u201B', 'powershell', "'/opt/\u201A\u201Ac\u201B\u201B'"],
  ] as const)('quotes %s for %s as %s', (value, shell, quoted) => {
    expect(shellQuote(value, shell)).toBe(quoted);
  });
});

describe('sharedQuoting', () => {
  it.each(NASTY)('one command serves both shells for %s', (p) => {
    expect(sharedQuoting(p)).toBe(true);
  });

  it.each(QUOTED)('needs a command per shell for %s', (p) => {
    expect(sharedQuoting(p)).toBe(false);
  });
});

describe('homeDirCommand', () => {
  it('runs config set with the repo launcher', () => {
    expect(homeDirCommand('C0AB', 'J:/acme', 'posix')).toBe(
      "node bin/jeeves-scripts.js config set slack.channels.C0AB.homeDir 'J:/acme'",
    );
  });
});

describe('proposalLines', () => {
  it('gives one block for both shells when every path allows it', () => {
    expect(
      proposalLines([
        { id: 'C1', path: 'J:/R&D' },
        { id: 'C2', path: '/opt/$x' },
      ]),
    ).toEqual([
      '',
      'Proposed home directories (2); review each, run its command from the instance repo, then run it again with `--live` to write the config (the same command in POSIX shells and PowerShell):',
      '',
      '```',
      "node bin/jeeves-scripts.js config set slack.channels.C1.homeDir 'J:/R&D'",
      "node bin/jeeves-scripts.js config set slack.channels.C2.homeDir '/opt/$x'",
      '```',
    ]);
  });

  it('gives a block per shell when a path holds a single quote', () => {
    expect(
      proposalLines([
        { id: 'C1', path: 'J:/a' },
        { id: 'C2', path: "/opt/o'b" },
      ]),
    ).toEqual([
      '',
      'Proposed home directories (2); review each, run its command from the instance repo, then run it again with `--live` to write the config. A path holds a single quote, which POSIX shells and PowerShell escape differently: use the block for your shell.',
      '',
      'POSIX shells (bash, zsh):',
      '',
      '```',
      "node bin/jeeves-scripts.js config set slack.channels.C1.homeDir 'J:/a'",
      String.raw`node bin/jeeves-scripts.js config set slack.channels.C2.homeDir '/opt/o'\''b'`,
      '```',
      '',
      'PowerShell:',
      '',
      '```',
      "node bin/jeeves-scripts.js config set slack.channels.C1.homeDir 'J:/a'",
      "node bin/jeeves-scripts.js config set slack.channels.C2.homeDir '/opt/o''b'",
      '```',
    ]);
  });
});

/** Whether a shell runs here and prints `ok`. */
const runs = (cmd: string, args: string[]): boolean => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 30_000 });
  return r.status === 0 && r.stdout.trim() === 'ok';
};

const POWERSHELL = process.platform === 'win32' ? 'powershell' : 'pwsh';
const hasBash = runs('bash', ['-c', 'echo ok']);
const hasPowerShell = runs(POWERSHELL, [
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  'echo ok',
]);

/** The fifth argument `shell` reads from `command`, as UTF-8 base64. */
const readBack = (command: string, shell: Shell): string => {
  if (shell === 'posix') {
    // `node` replaced by a function: only the shell's own parsing counts.
    const script = `node() { printf '%s' "$5" | base64 | tr -d '\\n'; }\n${command}\n`;
    return spawnSync('bash', ['-s'], {
      input: script,
      encoding: 'utf8',
      timeout: 30_000,
    }).stdout;
  }
  const script = `function node { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($args[4])) }\n${command}\n`;
  return spawnSync(
    POWERSHELL,
    [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    { encoding: 'utf8', timeout: 30_000 },
  ).stdout.trim();
};

const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64');

describe('the commands in real shells', () => {
  it.runIf(hasBash)(
    'bash reads every path back unchanged',
    () => {
      for (const p of [...NASTY, ...QUOTED])
        expect(readBack(homeDirCommand('C1', p, 'posix'), 'posix')).toBe(
          b64(p),
        );
    },
    60_000,
  );

  it.runIf(hasPowerShell)(
    'PowerShell reads every path back unchanged',
    () => {
      for (const p of [...NASTY, ...QUOTED])
        expect(
          readBack(homeDirCommand('C1', p, 'powershell'), 'powershell'),
        ).toBe(b64(p));
    },
    60_000,
  );
});
