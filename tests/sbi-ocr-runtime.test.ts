import { describe, expect, it, vi } from 'vitest';
import {
  runSbiBrowserOcr,
  validateOcrPageRange,
  type BrowserOcrDependencies,
} from '@/import/sbi/browser-ocr';

describe('SBI browser OCR range', () => {
  it.each([
    [0, 1, 10],
    [1.5, 2, 10],
    [1, 11, 10],
    [4, 3, 10],
    [1, 6, 10],
  ])('rejects invalid or over-five-page ranges', (start, end, pageCount) => {
    expect(() => validateOcrPageRange(start, end, pageCount)).toThrow('ocr-page-range-invalid');
  });

  it('accepts an inclusive range of at most five source pages', () => {
    expect(validateOcrPageRange(3, 7, 10)).toEqual({ startPage: 3, endPage: 7 });
  });

  it('requires an integer source page count within the existing 100-page limit', () => {
    expect(() => validateOcrPageRange(1, 1, 101)).toThrow('ocr-page-range-invalid');
    expect(() => validateOcrPageRange(1, 1, 0)).toThrow('ocr-page-range-invalid');
    expect(vi.fn()).not.toHaveBeenCalled();
  });
});

describe('SBI browser OCR resources', () => {
  it('rejects promptly on abort and terminates a worker that initializes late exactly once', async () => {
    const controller = new AbortController();
    const destroy = vi.fn().mockResolvedValue(undefined);
    const terminate = vi.fn().mockResolvedValue(undefined);
    let resolveWorker!: (worker: {
      recognize: ReturnType<typeof vi.fn>;
      terminate: typeof terminate;
    }) => void;
    const workerPromise = new Promise<{
      recognize: ReturnType<typeof vi.fn>;
      terminate: typeof terminate;
    }>((resolve) => {
      resolveWorker = resolve;
    });
    const createWorker = vi.fn().mockReturnValue(workerPromise);
    const dependencies: BrowserOcrDependencies = {
      loadPdfJs: vi.fn().mockResolvedValue({
        GlobalWorkerOptions: { workerSrc: `${location.origin}/pdf.worker.min.mjs` },
        getDocument: vi.fn().mockReturnValue({
          promise: Promise.resolve({ numPages: 1, getPage: vi.fn() }),
          destroy,
        }),
      }),
      loadTesseract: vi.fn().mockResolvedValue({
        createWorker,
        OEM: { LSTM_ONLY: 1 },
      }),
      createCanvas: () => document.createElement('canvas'),
    };
    const pending = runSbiBrowserOcr(
      new Uint8Array([37, 80, 68, 70, 45]),
      { startPage: 1, endPage: 1 },
      controller.signal,
      vi.fn(),
      dependencies,
    );
    await vi.waitFor(() => expect(createWorker).toHaveBeenCalledOnce());

    controller.abort();
    await expect(Promise.race([
      pending,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('abort-not-prompt')), 100);
      }),
    ])).rejects.toMatchObject({ name: 'AbortError' });

    resolveWorker({ recognize: vi.fn(), terminate });
    await vi.waitFor(() => expect(terminate).toHaveBeenCalledOnce());
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('uses same-origin Japanese LSTM config and destroys every runtime resource', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    const cancel = vi.fn();
    const terminate = vi.fn().mockResolvedValue(undefined);
    const recognize = vi.fn().mockResolvedValue({ data: { text: '取引残高報告書' } });
    const createWorker = vi.fn().mockResolvedValue({ recognize, terminate });
    const canvas = document.createElement('canvas');
    canvas.getContext = vi.fn().mockReturnValue({});
    const dependencies: BrowserOcrDependencies = {
      loadPdfJs: vi.fn().mockResolvedValue({
        GlobalWorkerOptions: { workerSrc: `${location.origin}/pdf.worker.min.mjs` },
        getDocument: vi.fn().mockReturnValue({
          promise: Promise.resolve({
            numPages: 1,
            getPage: vi.fn().mockResolvedValue({
              getViewport: vi.fn(({ scale }: { scale: number }) => ({
                width: 600 * scale, height: 800 * scale,
              })),
              render: vi.fn().mockReturnValue({ promise: Promise.resolve(), cancel }),
              cleanup: vi.fn(),
            }),
          }),
          destroy,
        }),
      }),
      loadTesseract: vi.fn().mockResolvedValue({
        createWorker,
        OEM: { LSTM_ONLY: 1 },
      }),
      createCanvas: () => canvas,
    };

    const report = await runSbiBrowserOcr(
      new Uint8Array([37, 80, 68, 70, 45]),
      { startPage: 1, endPage: 1 },
      new AbortController().signal,
      vi.fn(),
      dependencies,
    );

    expect(report.pages[0].extractionMode).toBe('ocr');
    expect(createWorker).toHaveBeenCalledWith('jpn', 1, {
      workerPath: `${location.origin}/ocr/worker.min.js`,
      corePath: `${location.origin}/ocr/core`,
      langPath: `${location.origin}/ocr/lang`,
      workerBlobURL: false,
      cacheMethod: 'none',
      gzip: true,
    });
    expect(terminate).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });

  it('cancels and destroys each active resource once on abort', async () => {
    const controller = new AbortController();
    const destroy = vi.fn().mockResolvedValue(undefined);
    const cancel = vi.fn();
    const cleanupPage = vi.fn();
    let rejectRender!: (error: unknown) => void;
    const renderPromise = new Promise((_resolve, reject) => { rejectRender = reject; });
    cancel.mockImplementation(() => rejectRender(new DOMException('aborted', 'AbortError')));
    const terminate = vi.fn().mockResolvedValue(undefined);
    const dependencies: BrowserOcrDependencies = {
      loadPdfJs: vi.fn().mockResolvedValue({
        GlobalWorkerOptions: { workerSrc: `${location.origin}/pdf.worker.min.mjs` },
        getDocument: vi.fn().mockReturnValue({
          promise: Promise.resolve({
            numPages: 1,
            getPage: vi.fn().mockResolvedValue({
              getViewport: vi.fn(({ scale }: { scale: number }) => ({
                width: 600 * scale, height: 800 * scale,
              })),
              render: vi.fn().mockReturnValue({ promise: renderPromise, cancel }),
              cleanup: cleanupPage,
            }),
          }),
          destroy,
        }),
      }),
      loadTesseract: vi.fn().mockResolvedValue({
        createWorker: vi.fn().mockResolvedValue({ recognize: vi.fn(), terminate }),
        OEM: { LSTM_ONLY: 1 },
      }),
      createCanvas: () => {
        const canvas = document.createElement('canvas');
        canvas.getContext = vi.fn().mockReturnValue({});
        return canvas;
      },
    };
    const pending = runSbiBrowserOcr(
      new Uint8Array([37, 80, 68, 70, 45]),
      { startPage: 1, endPage: 1 },
      controller.signal,
      vi.fn(),
      dependencies,
    );
    await vi.waitFor(() => expect(dependencies.loadTesseract).toHaveBeenCalled());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(cleanupPage).toHaveBeenCalledOnce();
    expect(terminate).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('rejects promptly and releases everything when recognize never settles', async () => {
    const controller = new AbortController();
    const destroy = vi.fn().mockResolvedValue(undefined);
    const cleanupPage = vi.fn();
    const terminate = vi.fn().mockResolvedValue(undefined);
    const recognize = vi.fn().mockReturnValue(new Promise(() => undefined));
    const canvas = document.createElement('canvas');
    canvas.getContext = vi.fn().mockReturnValue({});
    const dependencies: BrowserOcrDependencies = {
      loadPdfJs: vi.fn().mockResolvedValue({
        GlobalWorkerOptions: { workerSrc: `${location.origin}/pdf.worker.min.mjs` },
        getDocument: vi.fn().mockReturnValue({
          promise: Promise.resolve({
            numPages: 1,
            getPage: vi.fn().mockResolvedValue({
              getViewport: vi.fn(({ scale }: { scale: number }) => ({
                width: 600 * scale, height: 800 * scale,
              })),
              render: vi.fn().mockReturnValue({ promise: Promise.resolve(), cancel: vi.fn() }),
              cleanup: cleanupPage,
            }),
          }),
          destroy,
        }),
      }),
      loadTesseract: vi.fn().mockResolvedValue({
        createWorker: vi.fn().mockResolvedValue({ recognize, terminate }),
        OEM: { LSTM_ONLY: 1 },
      }),
      createCanvas: () => canvas,
    };
    const pending = runSbiBrowserOcr(
      new Uint8Array([37, 80, 68, 70, 45]),
      { startPage: 1, endPage: 1 },
      controller.signal,
      vi.fn(),
      dependencies,
    );
    await vi.waitFor(() => expect(recognize).toHaveBeenCalledOnce());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(terminate).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
    expect(cleanupPage).toHaveBeenCalledOnce();
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });

  it('fails closed before worker creation for invalid runtime origins', async () => {
    const createWorker = vi.fn();
    const dependencies: BrowserOcrDependencies = {
      loadPdfJs: vi.fn().mockResolvedValue({
        GlobalWorkerOptions: { workerSrc: 'https://cdn.example/pdf.worker.mjs' },
        getDocument: vi.fn(),
      }),
      loadTesseract: vi.fn().mockResolvedValue({
        createWorker,
        OEM: { LSTM_ONLY: 1 },
      }),
      createCanvas: () => document.createElement('canvas'),
    };
    await expect(runSbiBrowserOcr(
      new Uint8Array([37, 80, 68, 70, 45]),
      { startPage: 1, endPage: 1 },
      new AbortController().signal,
      vi.fn(),
      dependencies,
    )).rejects.toThrow('ocr-runtime-url-invalid');
    expect(createWorker).not.toHaveBeenCalled();
  });

  it('rejects nonfinite page geometry before multiplying dimensions', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    const terminate = vi.fn().mockResolvedValue(undefined);
    const dependencies: BrowserOcrDependencies = {
      loadPdfJs: vi.fn().mockResolvedValue({
        GlobalWorkerOptions: { workerSrc: `${location.origin}/pdf.worker.min.mjs` },
        getDocument: vi.fn().mockReturnValue({
          promise: Promise.resolve({
            numPages: 1,
            getPage: vi.fn().mockResolvedValue({
              getViewport: vi.fn().mockReturnValue({ width: Infinity, height: 800 }),
              render: vi.fn(),
              cleanup: vi.fn(),
            }),
          }),
          destroy,
        }),
      }),
      loadTesseract: vi.fn().mockResolvedValue({
        createWorker: vi.fn().mockResolvedValue({ recognize: vi.fn(), terminate }),
        OEM: { LSTM_ONLY: 1 },
      }),
      createCanvas: () => document.createElement('canvas'),
    };
    await expect(runSbiBrowserOcr(
      new Uint8Array([37, 80, 68, 70, 45]),
      { startPage: 1, endPage: 1 },
      new AbortController().signal,
      vi.fn(),
      dependencies,
    )).rejects.toThrow('ocr-page-size-invalid');
    expect(destroy).toHaveBeenCalledOnce();
    expect(terminate).toHaveBeenCalledOnce();
  });

  it('enforces a cumulative rendered-pixel budget across selected pages', async () => {
    const cleanup = vi.fn();
    const destroy = vi.fn().mockResolvedValue(undefined);
    const terminate = vi.fn().mockResolvedValue(undefined);
    const dependencies: BrowserOcrDependencies = {
      loadPdfJs: vi.fn().mockResolvedValue({
        GlobalWorkerOptions: { workerSrc: `${location.origin}/pdf.worker.min.mjs` },
        getDocument: vi.fn().mockReturnValue({
          promise: Promise.resolve({
            numPages: 4,
            getPage: vi.fn().mockResolvedValue({
              getViewport: vi.fn(({ scale }: { scale: number }) => ({
                width: 2_000 * scale, height: 2_000 * scale,
              })),
              render: vi.fn().mockReturnValue({ promise: Promise.resolve(), cancel: vi.fn() }),
              cleanup,
            }),
          }),
          destroy,
        }),
      }),
      loadTesseract: vi.fn().mockResolvedValue({
        createWorker: vi.fn().mockResolvedValue({
          recognize: vi.fn().mockImplementation(
            () => Promise.resolve({ data: { text: '取引残高報告書' } }),
          ),
          terminate,
        }),
        OEM: { LSTM_ONLY: 1 },
      }),
      createCanvas: () => {
        const canvas = document.createElement('canvas');
        canvas.getContext = vi.fn().mockReturnValue({});
        return canvas;
      },
    };
    await expect(runSbiBrowserOcr(
      new Uint8Array([37, 80, 68, 70, 45]),
      { startPage: 1, endPage: 4 },
      new AbortController().signal,
      vi.fn(),
      dependencies,
    )).rejects.toThrow('ocr-page-size-invalid');
    expect(destroy).toHaveBeenCalledOnce();
    expect(terminate).toHaveBeenCalledOnce();
  });

  it('does not let detached-byte cleanup mask the primary PDF error', async () => {
    const source = new Uint8Array([37, 80, 68, 70, 45]);
    const detachedCopy = new Uint8Array(source);
    vi.spyOn(source, 'slice').mockReturnValue(detachedCopy);
    vi.spyOn(detachedCopy, 'fill').mockImplementation(() => {
      throw new TypeError('detached');
    });
    const primary = new Error('primary-pdf-error');
    const destroy = vi.fn().mockResolvedValue(undefined);
    const dependencies: BrowserOcrDependencies = {
      loadPdfJs: vi.fn().mockResolvedValue({
        GlobalWorkerOptions: { workerSrc: `${location.origin}/pdf.worker.min.mjs` },
        getDocument: vi.fn().mockReturnValue({
          promise: Promise.reject(primary),
          destroy,
        }),
      }),
      loadTesseract: vi.fn(),
      createCanvas: () => document.createElement('canvas'),
    };
    await expect(runSbiBrowserOcr(
      source,
      { startPage: 1, endPage: 1 },
      new AbortController().signal,
      vi.fn(),
      dependencies,
    )).rejects.toBe(primary);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('clears the recognizer result even when safe conversion rejects it', async () => {
    const result = { data: { text: '取引残高報告書\u0000PRIVATE-CANARY' } };
    const dependencies: BrowserOcrDependencies = {
      loadPdfJs: vi.fn().mockResolvedValue({
        GlobalWorkerOptions: { workerSrc: `${location.origin}/pdf.worker.min.mjs` },
        getDocument: vi.fn().mockReturnValue({
          promise: Promise.resolve({
            numPages: 1,
            getPage: vi.fn().mockResolvedValue({
              getViewport: vi.fn(({ scale }: { scale: number }) => ({
                width: 600 * scale, height: 800 * scale,
              })),
              render: vi.fn().mockReturnValue({ promise: Promise.resolve(), cancel: vi.fn() }),
              cleanup: vi.fn(),
            }),
          }),
          destroy: vi.fn().mockResolvedValue(undefined),
        }),
      }),
      loadTesseract: vi.fn().mockResolvedValue({
        createWorker: vi.fn().mockResolvedValue({
          recognize: vi.fn().mockResolvedValue(result),
          terminate: vi.fn().mockResolvedValue(undefined),
        }),
        OEM: { LSTM_ONLY: 1 },
      }),
      createCanvas: () => {
        const canvas = document.createElement('canvas');
        canvas.getContext = vi.fn().mockReturnValue({});
        return canvas;
      },
    };
    await expect(runSbiBrowserOcr(
      new Uint8Array([37, 80, 68, 70, 45]),
      { startPage: 1, endPage: 1 },
      new AbortController().signal,
      vi.fn(),
      dependencies,
    )).rejects.toThrow('ocr-text-forbidden-character');
    expect(result.data.text).toBe('');
  });
});
