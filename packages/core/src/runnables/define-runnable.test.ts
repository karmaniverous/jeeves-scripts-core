import { describe, expect, it, vi } from 'vitest';

import { defineRunnable, isJobModule } from './define-runnable.js';
import * as deprecated from './deprecated.js';

describe('defineJob (deprecated alias)', () => {
  it('is defineRunnable, so instance plugins written against 0.2 keep working', () => {
    // Read by name: the deprecated symbol is never referenced directly in core.
    expect(deprecated).toHaveProperty('defineJob', defineRunnable);
  });
});

describe('defineRunnable', () => {
  it('returns the declaration frozen and marked as a job, running nothing', () => {
    const run = vi.fn();
    const job = defineRunnable({ id: 'acme-report', domain: 'acme', run });
    expect(isJobModule(job)).toBe(true);
    expect(Object.isFrozen(job)).toBe(true);
    expect(job).toMatchObject({ id: 'acme-report', domain: 'acme' });
    expect(run).not.toHaveBeenCalled();
  });

  it('keeps a one-line description for list', () => {
    const job = defineRunnable({
      id: 'google-drive-report',
      domain: 'google-drive',
      description: 'Report on the drive.',
      run: () => undefined,
    });
    expect(job.description).toBe('Report on the drive.');
  });

  it.each([
    ['an id with capitals', { id: 'Acme', domain: 'acme' }, /runnable id/],
    [
      'an id with a trailing dash',
      { id: 'acme-', domain: 'acme' },
      /runnable id/,
    ],
    ['an empty domain', { id: 'acme', domain: '' }, /domain/],
    [
      'an id that does not start with its domain',
      { id: 'report-acme', domain: 'acme' },
      /must start with its domain and a dash/,
    ],
    [
      'an id that is only its domain',
      { id: 'acme', domain: 'acme' },
      /must start with its domain and a dash/,
    ],
    [
      'an empty description',
      { id: 'acme-report', domain: 'acme', description: '' },
      /description/,
    ],
  ])('rejects %s', (_label, fields, message) => {
    expect(() => defineRunnable({ ...fields, run: () => undefined })).toThrow(
      message,
    );
  });

  it('rejects a declaration without a run function', () => {
    expect(() =>
      defineRunnable({ id: 'acme', domain: 'acme', run: 'nope' } as never),
    ).toThrow(/run must be a function/);
  });

  it('tells jobs from other values', () => {
    expect(isJobModule({ id: 'acme', domain: 'acme', run: () => 0 })).toBe(
      false,
    );
    expect(isJobModule(null)).toBe(false);
    expect(isJobModule('acme')).toBe(false);
  });
});
