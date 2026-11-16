import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getInfo: vi.fn(),
  getScreenshot: vi.fn(),
  destroy: vi.fn(() => Promise.resolve()),
}));

vi.mock('pdf-parse', () => ({
  PDFParse: class {
    getInfo = mocks.getInfo;
    getScreenshot = mocks.getScreenshot;
    destroy = mocks.destroy;
  },
}));

const { renderPdf } = await import('./pdf-render.js');

afterEach(() => {
  vi.clearAllMocks();
});

describe('renderPdf', () => {
  it('renders the selected pages as PNG buffers, then destroys the parser', async () => {
    const png = new Uint8Array([1, 2]);
    mocks.getInfo.mockResolvedValue({ total: 4 });
    mocks.getScreenshot.mockResolvedValue({
      total: 4,
      pages: [{ pageNumber: 2, data: png, width: 10, height: 20, scale: 2 }],
    });
    const select = vi.fn(() => [2]);

    await expect(renderPdf(Buffer.from('%PDF'), select, 2)).resolves.toEqual([
      { page: 2, png, width: 10, height: 20 },
    ]);
    expect(select).toHaveBeenCalledWith(4);
    expect(mocks.getScreenshot).toHaveBeenCalledWith({
      partial: [2],
      scale: 2,
      imageDataUrl: false,
      imageBuffer: true,
    });
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
  });

  it('destroys the parser when the selection is rejected, rendering nothing', async () => {
    mocks.getInfo.mockResolvedValue({ total: 1 });

    await expect(
      renderPdf(
        Buffer.from('%PDF'),
        () => {
          throw new Error('outside');
        },
        1,
      ),
    ).rejects.toThrow('outside');
    expect(mocks.getScreenshot).not.toHaveBeenCalled();
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
  });

  it('destroys the parser when the PDF cannot be read', async () => {
    mocks.getInfo.mockRejectedValue(new Error('Invalid PDF structure'));

    await expect(renderPdf(Buffer.from('junk'), () => [1], 1)).rejects.toThrow(
      'Invalid PDF structure',
    );
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
  });
});
