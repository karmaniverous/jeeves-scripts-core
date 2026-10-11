/**
 * Tests for lib/component-config and lib/runner-config against temp
 * config files and a loopback HTTP server standing in for the runner.
 */

import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  componentConfigPath,
  readComponentConfig,
} from './component-config.js';
import { runnerConfig, runnerUrl, triggerRunnerJob } from './runner-config.js';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'component-config-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** Write `{root}/jeeves-<name>/config.json` and return its path. */
const writeComponentConfig = (name: string, content: string): string => {
  const file = componentConfigPath(name, root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
};

describe('componentConfigPath', () => {
  it('follows the platform layout {configRoot}/jeeves-<name>/config.json', () => {
    expect(componentConfigPath('runner', root)).toBe(
      path.join(root, 'jeeves-runner', 'config.json'),
    );
  });
});

describe('readComponentConfig', () => {
  const schema = z.looseObject({ port: z.number() });

  it('returns undefined when the file does not exist', () => {
    expect(
      readComponentConfig(
        'runner',
        schema,
        componentConfigPath('runner', root),
      ),
    ).toBeUndefined();
  });

  it('returns the parsed file, keeping unread keys', () => {
    const file = writeComponentConfig('runner', '{"port":5,"other":true}');
    expect(readComponentConfig('runner', schema, file)).toEqual({
      port: 5,
      other: true,
    });
  });

  it('throws naming the component and file when the schema fails', () => {
    const file = writeComponentConfig('runner', '{"port":"x"}');
    expect(() => readComponentConfig('runner', schema, file)).toThrow(
      `Invalid jeeves-runner config at ${file}`,
    );
  });

  it('throws on a file that is not JSON', () => {
    const file = writeComponentConfig('runner', 'not json');
    expect(() => readComponentConfig('runner', schema, file)).toThrow(
      SyntaxError,
    );
  });
});

describe('runnerConfig / runnerUrl', () => {
  it("reads the runner's port from its config", () => {
    const file = writeComponentConfig('runner', '{"port":4242}');
    expect(runnerConfig(file).port).toBe(4242);
    expect(runnerUrl(file)).toBe('http://127.0.0.1:4242');
  });

  it("uses the runner's default port when it has no config file", () => {
    expect(runnerUrl(componentConfigPath('runner', root))).toBe(
      'http://127.0.0.1:1937',
    );
  });
});

describe('triggerRunnerJob', () => {
  it('POSTs /jobs/:id/run to the configured port and returns status and body', async () => {
    const requests: { method?: string; url?: string }[] = [];
    const server = http.createServer((req, res) => {
      requests.push({ method: req.method, url: req.url });
      res.writeHead(202).end('{"ok":true}');
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    try {
      const { port } = server.address() as AddressInfo;
      const file = writeComponentConfig('runner', JSON.stringify({ port }));
      await expect(
        triggerRunnerJob('vc daily/briefing', file),
      ).resolves.toEqual({ status: 202, body: '{"ok":true}' });
      expect(requests).toEqual([
        { method: 'POST', url: '/jobs/vc%20daily%2Fbriefing/run' },
      ]);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
