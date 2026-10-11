/**
 * Tests for the OpenClaw state-directory lookup shared by the config
 * reader, constants and worker sessions.
 */

import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { openclawConfigPaths, openclawStateDirs } from './openclaw-config.js';

describe('openclawStateDirs', () => {
  it('lists ~/.openclaw, then the legacy ~/.clawdbot', () => {
    expect(openclawStateDirs('/home/u')).toEqual([
      path.join('/home/u', '.openclaw'),
      path.join('/home/u', '.clawdbot'),
    ]);
  });

  it('places the config files in those directories', () => {
    expect(openclawConfigPaths('/home/u')).toEqual([
      path.join('/home/u', '.openclaw', 'openclaw.json'),
      path.join('/home/u', '.clawdbot', 'clawdbot.json'),
    ]);
  });
});
