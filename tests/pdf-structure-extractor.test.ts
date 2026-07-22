import { describe, expect, it, vi } from 'vitest';
import { extractPdfStructure } from '@/import/sbi/pdf-structure-extractor';

describe('PDF structure extractor', () => {
  it('fails immediately without loading when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const loader = vi.fn();

    await expect(extractPdfStructure(new Uint8Array([1, 2, 3]), loader, controller.signal))
      .rejects.toHaveProperty('name', 'AbortError');
    expect(loader).not.toHaveBeenCalled();
  });

  it('destroys an in-flight loading task once and rejects when aborted', async () => {
    const controller = new AbortController();
    const destroy = vi.fn().mockResolvedValue(undefined);
    const loader = vi.fn(() => ({ destroy, promise: new Promise<never>(() => undefined) }));
    const extraction = extractPdfStructure(new Uint8Array([1, 2, 3]), loader, controller.signal);

    controller.abort();

    await expect(extraction).rejects.toHaveProperty('name', 'AbortError');
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('destroys once and rejects promptly when aborted during text extraction', async () => {
    const controller = new AbortController();
    const destroy = vi.fn().mockResolvedValue(undefined);
    const getTextContent = vi.fn(() => new Promise<never>(() => undefined));
    const loader = vi.fn(() => ({ destroy, promise: Promise.resolve({
      numPages: 1,
      getPage: vi.fn().mockResolvedValue({
        getViewport: () => ({ width: 595, height: 842 }),
        getTextContent,
      }),
    }) }));
    const extraction = extractPdfStructure(new Uint8Array([1, 2, 3]), loader, controller.signal);

    await vi.waitFor(() => expect(getTextContent).toHaveBeenCalledOnce());
    controller.abort();

    const promptRejection = Promise.race([
      extraction,
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('extractPdfStructure did not reject promptly')), 100);
      }),
    ]);
    await expect(promptRejection).rejects.toHaveProperty('name', 'AbortError');
    expect(destroy).toHaveBeenCalledOnce();
  });

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

  it('rejects excessive raw content items and destroys the PDF document', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    const loader = vi.fn(() => ({ destroy, promise: Promise.resolve({
      numPages: 1,
      getPage: vi.fn().mockResolvedValue({
        getViewport: () => ({ width: 595, height: 842 }),
        getTextContent: vi.fn().mockResolvedValue({
          items: Array.from({ length: 20_001 }, () => ({ type: 'beginMarkedContent' })),
        }),
      }),
    }) }));

    await expect(extractPdfStructure(new Uint8Array([1, 2, 3]), loader))
      .rejects.toThrow('SBI取引残高報告書PDFの構造が大きすぎます');
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('rejects excessive aggregate text characters and destroys the PDF document', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    const loader = vi.fn(() => ({ destroy, promise: Promise.resolve({
      numPages: 1,
      getPage: vi.fn().mockResolvedValue({
        getViewport: () => ({ width: 595, height: 842 }),
        getTextContent: vi.fn().mockResolvedValue({ items: [
          {
            str: 'a'.repeat(2_000_001),
            transform: [1, 0, 0, 1, 101, 702],
            width: 80,
            height: 12,
          },
        ] }),
      }),
    }) }));

    await expect(extractPdfStructure(new Uint8Array([1, 2, 3]), loader))
      .rejects.toThrow('SBI取引残高報告書PDFの構造が大きすぎます');
    expect(destroy).toHaveBeenCalledOnce();
  });
});
