import fs from 'node:fs';
import path from 'node:path';

import { resetConfig } from '@karmaniverous/jeeves-scripts-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { sampleTaskFile } from './index';

const config = {
  instance: { name: 'sample', baseDir: '/srv' },
  paths: { contentDir: '/srv/content' },
  siloRouting: { silos: { acme: { basePath: '/srv/acme' } } },
};

describe('sampleTaskFile', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetConfig();
  });

  it('resolves through core: default silo and a named silo', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(config));
    const options = { configPath: '/srv/jeeves-scripts/jeeves-scripts.json' };

    expect(sampleTaskFile(undefined, options)).toBe(
      path.join('/srv/content', 'sample', 'TASK.md'),
    );
    expect(sampleTaskFile('acme', options)).toBe(
      path.join('/srv/acme', 'sample', 'TASK.md'),
    );
  });
});
