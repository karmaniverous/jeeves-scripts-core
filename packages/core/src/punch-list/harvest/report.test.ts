import { describe, expect, it } from 'vitest';

import { reportItem } from '../punch-list.test-helper.js';
import { parseReport } from './report.js';

describe('parseReport', () => {
  it('reads JSON inside prose or a fence', () => {
    const r = parseReport(
      'Here:\n```json\n{"items":[],"summary":"quiet day"}\n```',
    );
    expect(r).toEqual({ items: [], summary: 'quiet day' });
  });

  it('rejects no JSON, bad JSON and bad items', () => {
    expect(() => parseReport('nothing')).toThrow(/no JSON/);
    expect(() => parseReport('{oops}')).toThrow(/not valid JSON/);
    expect(() =>
      parseReport(
        JSON.stringify({
          items: [{ ...reportItem(), sources: ['relative/path'] }],
          summary: '',
        }),
      ),
    ).toThrow('a source is an absolute file path or a telemetry reference');
    expect(() =>
      parseReport(
        JSON.stringify({
          items: [{ ...reportItem(), sources: [] }],
          summary: '',
        }),
      ),
    ).toThrow('Too small: expected array to have >=1 items');
  });

  it('requires a requester on requested items', () => {
    const reply = (over: object): string =>
      JSON.stringify({
        items: [{ ...reportItem(), kind: 'requested', ...over }],
        summary: '',
      });
    expect(() => parseReport(reply({}))).toThrow(/requester/);
    expect(parseReport(reply({ requester: 'Ana' })).items[0]?.requester).toBe(
      'Ana',
    );
  });

  it('turns the failure sentinel into an error carrying the reason', () => {
    expect(() =>
      parseReport(
        'HARVEST_FAILED: watcher_search embedding_unavailable {"x":1}',
      ),
    ).toThrow(
      'harvest worker failed: watcher_search embedding_unavailable {"x":1}',
    );
  });

  it('rejects session references as sources', () => {
    const reply = JSON.stringify({
      items: [{ ...reportItem(), sources: ['session:agent:main:x'] }],
      summary: '',
    });
    expect(() => parseReport(reply)).toThrow(/telemetry reference/);
  });

  it('treats an empty requester on an inferred item as none', () => {
    const reply = JSON.stringify({
      items: [{ ...reportItem(), requester: '' }],
      summary: '',
    });
    expect(parseReport(reply).items[0]?.requester).toBeUndefined();
  });
});
