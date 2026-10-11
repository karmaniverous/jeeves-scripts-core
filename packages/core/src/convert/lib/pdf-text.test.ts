import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getText: vi.fn(),
  destroy: vi.fn(() => Promise.resolve()),
  options: [] as unknown[],
}));

vi.mock('pdf-parse', () => ({
  PDFParse: class {
    constructor(options: unknown) {
      mocks.options.push(options);
    }
    getText = mocks.getText;
    destroy = mocks.destroy;
  },
}));

const { extractPdfText } = await import('./pdf-text.js');

afterEach(() => {
  vi.clearAllMocks();
  mocks.options.length = 0;
});

describe('extractPdfText', () => {
  it('returns text and page count, then destroys the parser', async () => {
    mocks.getText.mockResolvedValue({ text: 'hello', total: 2, pages: [] });
    const data = Buffer.from('%PDF');

    await expect(extractPdfText(data)).resolves.toEqual({
      text: 'hello',
      total: 2,
    });
    expect(mocks.options).toEqual([{ data }]);
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
  });

  it('destroys the parser when extraction rejects, and rethrows', async () => {
    mocks.getText.mockRejectedValue(new Error('bad xref'));

    await expect(extractPdfText(Buffer.from('junk'))).rejects.toThrow(
      'bad xref',
    );
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
  });
});
