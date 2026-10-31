/**
 * The `transcripts` block: optional fields with their defaults resolved
 * (`libraryDir` under the default silo, `scratchDir` under the state
 * directory, `userAgent` from the instance name), and validation that
 * fails `config check` (Decision 76).
 */

import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { configCheck } from './check.js';
import { useConfigFile } from './config-file.test-helper.js';
import { configSchema } from './schema.js';
import { deriveTranscripts, transcriptsConfig } from './transcripts.js';

const base = path.resolve('/base');
const config = (extra: object) =>
  configSchema.parse({ instance: { name: 'acme', baseDir: base }, ...extra });

describe('deriveTranscripts', () => {
  it('resolves every default with no block', () => {
    expect(deriveTranscripts(config({}))).toEqual({
      libraryDir: path.join(base, 'content', 'library', 'video-transcripts'),
      scratchDir: path.join(base, 'state', 'transcripts'),
      userAgent: 'jeeves-scripts/acme',
    });
  });

  it('roots libraryDir in the default silo base', () => {
    const silo = path.join(base, 'silo');
    expect(
      deriveTranscripts(
        config({ siloRouting: { defaultBasePath: silo, silos: {} } }),
      ).libraryDir,
    ).toBe(path.join(silo, 'library', 'video-transcripts'));
  });

  it('keeps configured values', () => {
    const transcripts = {
      libraryDir: path.join(base, 'lib'),
      scratchDir: path.join(base, 'scratch'),
      userAgent: 'acme-assistant/1.0',
    };
    expect(deriveTranscripts(config({ transcripts }))).toEqual(transcripts);
  });
});

describe('transcriptsConfig and config check', () => {
  const write = useConfigFile();

  it('reads the loaded config', () => {
    write({ transcripts: { userAgent: 'acme-assistant/1.0' } });
    expect(transcriptsConfig().userAgent).toBe('acme-assistant/1.0');
  });

  it.each([
    [{ libraryDir: 'rel' }, 'libraryDir must be an absolute path'],
    [{ scratchDir: 'rel' }, 'scratchDir must be an absolute path'],
    [{ userAgent: '  ' }, 'Too small: expected string to have >=1 characters'],
  ])('fails config check on %j', (transcripts, message) => {
    const result = configCheck(write({ transcripts }));
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain(message);
  });
});
