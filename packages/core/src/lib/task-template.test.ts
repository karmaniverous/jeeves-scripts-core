/**
 * Tests for the TASK-template resolver (Decision 75): the instance file
 * wins, core's copy is used otherwise, the source is described, and
 * placeholders and includes are filled.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  coreTaskTemplatePath,
  describeTaskSource,
  fillTaskTemplate,
  resolveTaskTemplate,
} from './task-template.js';

const pkgRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const HARVEST = 'punch-list/harvest.task.md';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('coreTaskTemplatePath', () => {
  it('is task-templates/<name> at the package root', () => {
    expect(coreTaskTemplatePath(HARVEST)).toBe(
      path.join(pkgRoot, 'task-templates', 'punch-list', 'harvest.task.md'),
    );
  });

  it.each([
    '../package.json',
    '../../package.json',
    'punch-list/../../package.json',
    'punch-list\\..\\..\\package.json',
    '/etc/hosts',
    'C:\\Windows\\win.ini',
    'C:/Windows/win.ini',
    'C:win.ini',
    '\\\\host\\share\\x.md',
    '\\x.md',
    '',
    '.',
  ])('refuses %j, which is not a path inside task-templates/', (name) => {
    expect(() => coreTaskTemplatePath(name)).toThrow(
      `core task template name ${JSON.stringify(name)} must be a relative path inside task-templates/`,
    );
  });

  it('takes # and % literally (no URL decoding)', () => {
    expect(coreTaskTemplatePath('a%2e%2e/b#c.md')).toBe(
      path.join(pkgRoot, 'task-templates', 'a%2e%2e', 'b#c.md'),
    );
  });

  it('refuses a name that leaves the root through a link', () => {
    const root = path.join(dir, 'root');
    const outside = path.join(dir, 'outside');
    fs.mkdirSync(root);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'f.md'), 'secret');
    fs.writeFileSync(path.join(root, 'ok.md'), 'ok');
    // A junction needs no privilege on Windows; elsewhere it is a symlink.
    fs.symlinkSync(outside, path.join(root, 'out'), 'junction');
    expect(coreTaskTemplatePath('ok.md', root)).toBe(path.join(root, 'ok.md'));
    expect(() => coreTaskTemplatePath('out/f.md', root)).toThrow(
      'must be a relative path inside task-templates/',
    );
  });
});

describe('resolveTaskTemplate', () => {
  it('reads the instance file when it exists, even with a core template named', () => {
    const own = path.join(dir, 'TASK.md');
    fs.writeFileSync(own, 'mine');
    expect(resolveTaskTemplate(own, HARVEST)).toEqual({
      text: 'mine',
      source: 'instance',
      path: own,
      instanceFile: own,
      template: HARVEST,
    });
  });

  it('reads core template when the instance has no file', () => {
    const own = path.join(dir, 'TASK.md');
    expect(resolveTaskTemplate(own, HARVEST)).toEqual({
      text: fs.readFileSync(coreTaskTemplatePath(HARVEST), 'utf8'),
      source: 'core',
      path: coreTaskTemplatePath(HARVEST),
      instanceFile: own,
      template: HARVEST,
    });
  });

  it('reads the instance file with no template named, and omits the template', () => {
    const own = path.join(dir, 'TASK.md');
    fs.writeFileSync(own, 'mine');
    expect(resolveTaskTemplate(own)).toEqual({
      text: 'mine',
      source: 'instance',
      path: own,
      instanceFile: own,
    });
  });

  it('returns undefined with no instance file and no template', () => {
    expect(resolveTaskTemplate(path.join(dir, 'TASK.md'))).toBeUndefined();
  });

  it('refuses a template name outside task-templates/, even when the instance file wins', () => {
    const own = path.join(dir, 'TASK.md');
    expect(() => resolveTaskTemplate(own, '../../package.json')).toThrow(
      'must be a relative path inside task-templates/',
    );
    fs.writeFileSync(own, 'mine');
    expect(() => resolveTaskTemplate(own, '../../package.json')).toThrow(
      'must be a relative path inside task-templates/',
    );
  });

  it('throws naming a core template that does not exist', () => {
    expect(() =>
      resolveTaskTemplate(path.join(dir, 'TASK.md'), 'nope/missing.md'),
    ).toThrow(/^core task template nope\/missing\.md is missing \(/);
  });
});

describe('describeTaskSource', () => {
  it('names the instance file', () => {
    expect(
      describeTaskSource({
        text: '',
        source: 'instance',
        path: '/x/TASK.md',
        instanceFile: '/x/TASK.md',
        template: HARVEST,
      }),
    ).toBe('task from the instance file /x/TASK.md');
  });

  it('names the core template and the instance file it looked for', () => {
    expect(
      describeTaskSource({
        text: '',
        source: 'core',
        path: '/core/t.md',
        instanceFile: '/x/TASK.md',
        template: HARVEST,
      }),
    ).toBe(
      `task from core template ${HARVEST} (no instance file at /x/TASK.md)`,
    );
  });

  it('falls back to the core path when no template name is recorded', () => {
    expect(
      describeTaskSource({
        text: '',
        source: 'core',
        path: '/core/t.md',
        instanceFile: '/x/TASK.md',
      }),
    ).toBe(
      'task from core template /core/t.md (no instance file at /x/TASK.md)',
    );
  });
});

describe('fillTaskTemplate', () => {
  it('fills every placeholder, with or without inner spaces', () => {
    expect(
      fillTaskTemplate('{{org}} and {{ org }} for {{who}}', {
        org: 'Acme',
        who: 'Ana',
      }),
    ).toBe('Acme and Acme for Ana');
  });

  it('inserts values literally, $ patterns included', () => {
    expect(fillTaskTemplate('{{a}}', { a: "$& $1 $'" })).toBe("$& $1 $'");
  });

  it('leaves text without placeholders unchanged and needs no values', () => {
    expect(fillTaskTemplate('{ "items": [] } {x}')).toBe('{ "items": [] } {x}');
  });

  it('names every missing placeholder once', () => {
    expect(() => fillTaskTemplate('{{a}} {{b}} {{a}}', {})).toThrow(
      'task template needs a value for {{a}}, {{b}}',
    );
  });

  it('does not take values from the prototype chain', () => {
    expect(() => fillTaskTemplate('{{constructor}}', {})).toThrow(
      'task template needs a value for {{constructor}}',
    );
  });

  it('includes a core template, trimmed, and fills its placeholders too', () => {
    const rules = fs
      .readFileSync(
        coreTaskTemplatePath('daily-briefings/briefing-rules.md'),
        'utf8',
      )
      .trim();
    const vars = {
      principal: 'Ana',
      deliveryChannel: '#brief',
      timeZone: 'UTC',
    };
    const filled = fillTaskTemplate(
      'A\n\n{{> daily-briefings/briefing-rules.md}}\n\nB',
      vars,
    );
    expect(filled).toBe(
      `A\n\n${rules.replaceAll('{{principal}}', 'Ana').replaceAll('{{deliveryChannel}}', '#brief').replaceAll('{{timeZone}}', 'UTC')}\n\nB`,
    );
  });

  it('throws naming an include that does not exist', () => {
    expect(() => fillTaskTemplate('{{> nope/missing.md}}')).toThrow(
      'task includes core template nope/missing.md, which is missing',
    );
  });

  it.each([
    '../../package.json',
    '../../../../etc/hosts',
    '/etc/hosts',
    'C:\\Windows\\win.ini',
  ])('refuses the include %j, outside task-templates/', (name) => {
    expect(() => fillTaskTemplate(`{{> ${name}}}`)).toThrow(
      `core task template name ${JSON.stringify(name)} must be a relative path inside task-templates/`,
    );
  });
});
