/**
 * The binary conversion kinds of `materialize` (slides export, plain text,
 * PDF, xlsx, docx/office), with the PDF and office parsers stubbed and the
 * xlsx fixture read for real.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getText: vi.fn(() => Promise.resolve({ text: 'pdf words' })),
  destroy: vi.fn(() => Promise.resolve()),
  officeConvert: vi.fn(() => Promise.resolve({ value: '# Office' })),
}));
vi.mock('pdf-parse', () => ({
  PDFParse: class {
    getText = mocks.getText;
    destroy = mocks.destroy;
  },
}));
vi.mock('officeparser', () => ({ convert: mocks.officeConvert }));

import { SheetsConversionSchema } from './config.js';
import { isExportLimitError, materialize } from './convert.js';
import type { DriveClient } from './drive-client.js';
import { fakeDrive, file } from './fake-drive.test-helper.js';

const sheets = SheetsConversionSchema.parse({});
const fixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'sample.xlsx',
);
let staging: string;

const client = (body: string | Buffer): DriveClient => {
  const c = fakeDrive({});
  c.downloadTo = (_id, out) => {
    fs.writeFileSync(out, body);
    return out;
  };
  c.exportTo = (_id, format, out) => {
    const p = out.replace(/\.[^.]+$/, `.${format}`);
    fs.writeFileSync(p, body);
    return p;
  };
  return c;
};

beforeEach(() => {
  staging = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-kinds-'));
});
afterEach(() => {
  fs.rmSync(staging, { recursive: true, force: true });
});

describe('materialize kinds', () => {
  it('exports slides as text and decodes plain text', async () => {
    await expect(
      materialize(
        'gslides',
        file({ id: 's' }),
        client('slide text'),
        path.join(staging, 'a.dl'),
        sheets,
      ),
    ).resolves.toBe('slide text');
    await expect(
      materialize(
        'text',
        file({ id: 't' }),
        client('plain'),
        path.join(staging, 'b.dl'),
        sheets,
      ),
    ).resolves.toBe('plain');
  });

  it('extracts PDF text and frees the parser', async () => {
    await expect(
      materialize(
        'pdf',
        file({ id: 'p' }),
        client('%PDF'),
        path.join(staging, 'c.dl'),
        sheets,
      ),
    ).resolves.toBe('pdf words');
    expect(mocks.destroy).toHaveBeenCalled();
  });

  it('converts docx and other office files through officeparser', async () => {
    await expect(
      materialize(
        'docx',
        file({ id: 'd' }),
        client('PK'),
        path.join(staging, 'd.dl'),
        sheets,
      ),
    ).resolves.toBe('# Office');
    await expect(
      materialize(
        'office',
        file({ id: 'o' }),
        client('PK'),
        path.join(staging, 'e.dl'),
        sheets,
      ),
    ).resolves.toBe('# Office');
  });

  it('renders every worksheet of an xlsx', async () => {
    const body = await materialize(
      'xlsx',
      file({ id: 'x' }),
      client(fs.readFileSync(fixture)),
      path.join(staging, 'f.dl'),
      sheets,
    );
    expect(body).toMatch(/^## /m);
    expect(fs.readdirSync(staging)).toEqual([]);
  });

  it('recognises the export limit in strings too', () => {
    expect(isExportLimitError('file too large to be exported')).toBe(true);
    expect(isExportLimitError(new Error('quota'))).toBe(false);
  });
});
