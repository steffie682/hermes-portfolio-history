import { describe, expect, it, vi } from 'vitest';
import { extractPdfStructure } from '@/import/sbi/pdf-structure-extractor';

describe('PDF structure extractor', () => {
  it('extracts text geometry and destroys the PDF document', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    const loader = vi.fn(() => ({ destroy, promise: Promise.resolve({
      numPages: 1,
      getPage: vi.fn().mockResolvedValue({
        getViewport: () => ({ width: 595, height: 842 }),
        getTextContent: vi.fn().mockResolvedValue({ items: [
          { str: '信用取引', transform: [1, 0, 0, 1, 101, 702], width: 80, height: 12 },
          { type: 'beginMarkedContent' },
        ] }),
      }),
    }) }));

    await expect(extractPdfStructure(new Uint8Array([1, 2, 3]), loader)).resolves.toEqual([{
      pageNumber: 1,
      width: 595,
      height: 842,
      items: [{ text: '信用取引', x: 101, y: 702, width: 80, height: 12 }],
    }]);
    expect(loader).toHaveBeenCalledWith(expect.objectContaining({ data: expect.any(Uint8Array), isEvalSupported: false }));
    expect(destroy).toHaveBeenCalledOnce();
  });
});
