import { describe, expect, it, vi } from 'vitest';
import {
  createControlledWorkerController,
  restoreWorkerConstructor,
  rerunAfterLocalPiiMask,
  runSbiBrowserOcr,
  validateOcrPageRange,
  type BrowserOcrDependencies,
} from '@/import/sbi/browser-ocr';

const createMockWorkerController: BrowserOcrDependencies['createWorkerController'] = (
  tesseract,
  language,
  engine,
  options,
) => {
  let worker: Awaited<ReturnType<typeof tesseract.createWorker>> | null = null;
  let terminationRequested = false;
  let terminatePromise: Promise<unknown> | null = null;
  const ready = tesseract.createWorker(language, engine, options).then((createdWorker) => {
    worker = createdWorker;
    if (terminationRequested) void createdWorker.terminate().catch(() => undefined);
    return createdWorker;
  });
  return {
    ready,
    terminate() {
      terminationRequested = true;
      if (!worker) return Promise.resolve();
      terminatePromise ??= worker.terminate();
      return terminatePromise;
    },
  };
};

describe('SBI local PII masking runtime', () => {
  it('burns trusted local masks, clears the first recognition, and returns only the second recognition', async () => {
    const words = [
      ['お名前', 50, 60], ['合成秘密名', 180, 60], ['ご住所', 50, 100], ['合成県秘密市', 180, 100],
      ['口座番号', 50, 140], ['0123456789', 180, 140], ['国内株式', 50, 300], ['銘柄名', 50, 330], ['数量', 560, 330], ['取得価格', 690, 330], ['買付金額', 860, 330],
    ].map(([text, x, y]) => ({ text: String(text), confidence: 95,
      bbox: { x0: Number(x), y0: Number(y), x1: Number(x) + 100, y1: Number(y) + 20 } }));
    const first = { data: { text: '合成秘密名 0123456789', blocks: [{ paragraphs: [{ lines: [{
      text: words.map((word) => word.text).join(' '), confidence: 95, bbox: { x0: 0, y0: 50, x1: 900, y1: 360 }, words,
    }] }] }] } };
    const second = { data: { text: '信用取引の建玉残高', blocks: [{ paragraphs: [] }] } };
    const fillRect = vi.fn();
    const context = { fillStyle: '', fillRect } as unknown as CanvasRenderingContext2D;
    const repeat = vi.fn().mockResolvedValue(second);

    const result = await rerunAfterLocalPiiMask(first, { width: 1_000, height: 1_400 }, context, repeat);

    expect(result).toEqual({ recognition: second, maskApplied: true });
    expect(repeat).toHaveBeenCalledOnce();
    expect(fillRect).toHaveBeenCalledTimes(1);
    expect(first.data.text).toBe('');
    expect(first.data.blocks).toBeNull();
  });
  it('clears the first recognition when local mask drawing fails', async () => {
    const words = ['お名前', 'ご住所', '口座番号'].map((text, index) => ({ text, confidence: 95,
      bbox: { x0: 50, y0: 60 + index * 40, x1: 150, y1: 80 + index * 40 } }));
    words.push({ text: '国内株式', confidence: 95, bbox: { x0: 50, y0: 300, x1: 150, y1: 320 } },
      { text: '銘柄名', confidence: 95, bbox: { x0: 50, y0: 330, x1: 150, y1: 350 } },
      { text: '数量', confidence: 95, bbox: { x0: 560, y0: 330, x1: 640, y1: 350 } },
      { text: '取得価格', confidence: 95, bbox: { x0: 690, y0: 330, x1: 770, y1: 350 } },
      { text: '買付金額', confidence: 95, bbox: { x0: 860, y0: 330, x1: 940, y1: 350 } });
    const first = { data: { text: 'SYNTHETIC-PII-CANARY', blocks: [{ paragraphs: [{ lines: [{
      text: words.map((word) => word.text).join(' '), confidence: 95, bbox: { x0: 0, y0: 50, x1: 900, y1: 360 }, words,
    }] }] }] } };
    const context = { fillStyle: '', fillRect: vi.fn(() => { throw new Error('canvas-write-failed'); }) } as unknown as CanvasRenderingContext2D;

    await expect(rerunAfterLocalPiiMask(first, { width: 1_000, height: 1_400 }, context, vi.fn()))
      .rejects.toThrow('canvas-write-failed');
    expect(first.data.text).toBe('');
    expect(first.data.blocks).toBeNull();
  });
});

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
  it('fails closed when a temporary Worker property cannot be removed', () => {
    class OriginalWorker {}
    class TemporaryWorker {}
    const workerGlobal = Object.create({ Worker: OriginalWorker }) as { Worker: typeof Worker };
    Object.defineProperty(workerGlobal, 'Worker', {
      configurable: false,
      value: TemporaryWorker,
    });

    expect(() => restoreWorkerConstructor(
      workerGlobal,
      undefined,
      OriginalWorker as unknown as typeof Worker,
    )).toThrow('ocr-worker-control-unavailable');
  });

  it('controls the native worker before Tesseract initialization is ready', async () => {
    const nativeTerminate = vi.fn();
    class FakeWorker {
      terminate = nativeTerminate;
    }
    vi.stubGlobal('Worker', FakeWorker);
    try {
      const ready = new Promise<never>(() => undefined);
      const createWorker = vi.fn((_language, _engine, options: Record<string, unknown>) => {
        const WorkerConstructor = globalThis.Worker;
        new WorkerConstructor(String(options.workerPath));
        return ready;
      });
      const originalWorker = globalThis.Worker;
      const controller = createControlledWorkerController(
        { createWorker, OEM: { LSTM_ONLY: 1 } },
        'jpn',
        1,
        { workerPath: `${location.origin}/ocr/worker.min.js` },
      );

      expect(globalThis.Worker).toBe(originalWorker);
      expect(createWorker).toHaveBeenCalledWith('jpn', 1, {
        workerPath: `${location.origin}/ocr/worker.min.js`,
        errorHandler: expect.any(Function),
      });
      await controller.terminate();
      await controller.terminate();
      expect(nativeTerminate).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('terminates every captured worker when one native termination throws', async () => {
    const firstTerminate = vi.fn(() => { throw new Error('native-terminate-failed'); });
    const secondTerminate = vi.fn();
    let workerIndex = 0;
    class FakeWorker {
      private readonly index = workerIndex++;

      terminate() {
        if (this.index === 0) firstTerminate();
        else secondTerminate();
      }
    }
    vi.stubGlobal('Worker', FakeWorker);
    try {
      const createWorker = vi.fn(() => {
        new globalThis.Worker('/ocr/worker.min.js');
        new globalThis.Worker('/ocr/worker.min.js');
        return new Promise<never>(() => undefined);
      });

      expect(() => createControlledWorkerController(
        { createWorker, OEM: { LSTM_ONLY: 1 } },
        'jpn',
        1,
        { workerPath: `${location.origin}/ocr/worker.min.js` },
      )).toThrow('ocr-worker-control-unavailable');

      await vi.waitFor(() => expect(firstTerminate).toHaveBeenCalledOnce());
      expect(secondTerminate).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects controlled initialization when Tesseract reports a language-load error', async () => {
    const nativeTerminate = vi.fn();
    class FakeWorker {
      terminate = nativeTerminate;
    }
    vi.stubGlobal('Worker', FakeWorker);
    try {
      let errorHandler!: (error: unknown) => void;
      const createWorker = vi.fn((_language, _engine, options: Record<string, unknown>) => {
        errorHandler = options.errorHandler as (error: unknown) => void;
        new globalThis.Worker(String(options.workerPath));
        return new Promise<never>(() => undefined);
      });
      const controller = createControlledWorkerController(
        { createWorker, OEM: { LSTM_ONLY: 1 } },
        'jpn',
        1,
        { workerPath: `${location.origin}/ocr/worker.min.js` },
      );

      errorHandler(new Error('language-load-failed'));

      await expect(Promise.race([
        controller.ready,
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('initialization-error-not-prompt')), 100);
        }),
      ])).rejects.toThrow('ocr-worker-initialization-failed');
      expect(nativeTerminate).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

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
      createWorkerController: createMockWorkerController,
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

  it('terminates a controlled worker when initialization never settles', async () => {
    const controller = new AbortController();
    const destroy = vi.fn().mockResolvedValue(undefined);
    const terminateInitialization = vi.fn().mockResolvedValue(undefined);
    const createWorkerController = vi.fn().mockReturnValue({
      ready: new Promise(() => undefined),
      terminate: terminateInitialization,
    });
    const dependencies: BrowserOcrDependencies = {
      loadPdfJs: vi.fn().mockResolvedValue({
        GlobalWorkerOptions: { workerSrc: `${location.origin}/pdf.worker.min.mjs` },
        getDocument: vi.fn().mockReturnValue({
          promise: Promise.resolve({ numPages: 1, getPage: vi.fn() }),
          destroy,
        }),
      }),
      loadTesseract: vi.fn().mockResolvedValue({
        createWorker: vi.fn().mockReturnValue(new Promise(() => undefined)),
        OEM: { LSTM_ONLY: 1 },
      }),
      createWorkerController,
      createCanvas: () => document.createElement('canvas'),
    };
    const pending = runSbiBrowserOcr(
      new Uint8Array([37, 80, 68, 70, 45]),
      { startPage: 1, endPage: 1 },
      controller.signal,
      vi.fn(),
      dependencies,
    );
    await vi.waitFor(() => expect(dependencies.loadTesseract).toHaveBeenCalledOnce());

    controller.abort();
    await expect(Promise.race([
      pending,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('abort-not-prompt')), 100);
      }),
    ])).rejects.toMatchObject({ name: 'AbortError' });

    expect(createWorkerController).toHaveBeenCalledOnce();
    expect(terminateInitialization).toHaveBeenCalledOnce();
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
      createWorkerController: createMockWorkerController,
      createCanvas: () => canvas,
    };

    const report = await runSbiBrowserOcr(
      new Uint8Array([37, 80, 68, 70, 45]),
      { startPage: 1, endPage: 1 },
      new AbortController().signal,
      vi.fn(),
      dependencies,
    );

    expect(report.report.pages[0].extractionMode).toBe('ocr');
    expect(report.candidates).toEqual({ deposits: [], collateral: [], domesticStockLots: [], fundBalances: [], margin: [], limitReached: false });
    expect(recognize).toHaveBeenCalledWith(canvas, {}, { text: true, blocks: true });
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

  it('returns strict structured candidates even when safe OCR text has no known label', async () => {
    const candidateLine = (y: number, entries: Array<[string, number]>) => ({
      text: entries.map(([text]) => text).join(' '), confidence: 95,
      bbox: { x0: 0, y0: y, x1: 1_000, y1: y + 15 },
      words: entries.map(([text, x]) => ({ text, confidence: 95, bbox: { x0: x, y0: y, x1: x + 60, y1: y + 15 } })),
    });
    const recognition = { data: {
      text: 'PRIVATE OCR TEXT WITHOUT ALLOWLISTED LABEL',
      blocks: [{ paragraphs: [{ lines: [
        candidateLine(70, [['信用取引の建玉残高', 40]]),
        candidateLine(90, [['銘柄名(弁済期限)', 20], ['指定', 260], ['数量・市場', 330], ['区分', 440],
          ['約定年月日', 520], ['約定単価', 630], ['時価', 720], ['手数料', 790],
          ['評価損益', 850], ['最終決済期日', 910]]),
        candidateLine(120, [['合成建設[1234]6ヶ月', 20], ['-', 260], ['100株東京', 330], ['買未決済', 440],
          ['2024/01/15', 520], ['1,000円', 630], ['900円', 720], ['-', 790],
          ['-10,000円', 850], ['2024/07/15', 910]]),
      ] }] }],
    } };
    const terminate = vi.fn().mockResolvedValue(undefined);
    const destroy = vi.fn().mockResolvedValue(undefined);
    const canvas = document.createElement('canvas');
    canvas.getContext = vi.fn().mockReturnValue({});
    const dependencies: BrowserOcrDependencies = {
      loadPdfJs: vi.fn().mockResolvedValue({
        GlobalWorkerOptions: { workerSrc: `${location.origin}/pdf.worker.min.mjs` },
        getDocument: vi.fn().mockReturnValue({
          promise: Promise.resolve({
            numPages: 1,
            getPage: vi.fn().mockResolvedValue({
              getViewport: vi.fn(({ scale }: { scale: number }) => ({ width: 400 * scale, height: 560 * scale })),
              render: vi.fn().mockReturnValue({ promise: Promise.resolve(), cancel: vi.fn() }),
              cleanup: vi.fn(),
            }),
          }),
          destroy,
        }),
      }),
      loadTesseract: vi.fn().mockResolvedValue({
        createWorker: vi.fn().mockResolvedValue({ recognize: vi.fn().mockResolvedValue(recognition), terminate }),
        OEM: { LSTM_ONLY: 1 },
      }),
      createWorkerController: createMockWorkerController,
      createCanvas: () => canvas,
    };

    const output = await runSbiBrowserOcr(
      new Uint8Array([37, 80, 68, 70, 45]),
      { startPage: 1, endPage: 1 },
      new AbortController().signal,
      vi.fn(),
      dependencies,
    );

    expect(output.candidates.margin).toHaveLength(1);
    expect(output.diagnostics).toEqual({ pages: [{
      pageNumber: 1, trustedLineCount: 3, marginSectionMarkerCount: 1,
      marginHeaderCount: 1, eligibleMarginLineCount: 1, marginCandidateCount: 1,
    }] });
    expect(output.report.pages[0].items.every((item) => item.kind !== 'known-label')).toBe(true);
    expect(JSON.stringify(output.report)).not.toContain('PRIVATE OCR TEXT');
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
      createWorkerController: createMockWorkerController,
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
      createWorkerController: createMockWorkerController,
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

  it('clears raw OCR text when recognition resolves after abort', async () => {
    const controller = new AbortController();
    const lateResult = { data: { text: '取引残高報告書 LATE-OCR-TEXT', blocks: [{ paragraphs: [] }] } };
    let resolveRecognition!: (result: typeof lateResult) => void;
    const recognitionPromise = new Promise<typeof lateResult>((resolve) => {
      resolveRecognition = resolve;
    });
    const recognize = vi.fn().mockReturnValue(recognitionPromise);
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
              cleanup: vi.fn(),
            }),
          }),
          destroy: vi.fn().mockResolvedValue(undefined),
        }),
      }),
      loadTesseract: vi.fn().mockResolvedValue({
        createWorker: vi.fn().mockResolvedValue({
          recognize,
          terminate: vi.fn().mockResolvedValue(undefined),
        }),
        OEM: { LSTM_ONLY: 1 },
      }),
      createWorkerController: createMockWorkerController,
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
    resolveRecognition(lateResult);

    await vi.waitFor(() => expect(lateResult.data.text).toBe(''));
    expect(lateResult.data.blocks).toBeNull();
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
      createWorkerController: createMockWorkerController,
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
      createWorkerController: createMockWorkerController,
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
      createWorkerController: createMockWorkerController,
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

  it('continues final cleanup when page cleanup throws', async () => {
    const cleanupError = new Error('page-cleanup-failed');
    const cleanupPage = vi.fn(() => { throw cleanupError; });
    const destroy = vi.fn().mockResolvedValue(undefined);
    const terminate = vi.fn().mockResolvedValue(undefined);
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
        createWorker: vi.fn().mockResolvedValue({
          recognize: vi.fn().mockResolvedValue({ data: { text: '取引残高報告書' } }),
          terminate,
        }),
        OEM: { LSTM_ONLY: 1 },
      }),
      createWorkerController: createMockWorkerController,
      createCanvas: () => canvas,
    };

    await expect(runSbiBrowserOcr(
      new Uint8Array([37, 80, 68, 70, 45]),
      { startPage: 1, endPage: 1 },
      new AbortController().signal,
      vi.fn(),
      dependencies,
    )).rejects.toBe(cleanupError);

    expect(terminate).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
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
      createWorkerController: createMockWorkerController,
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
    const result = { data: { text: '取引残高報告書\u0000PRIVATE-CANARY', blocks: [{ paragraphs: [] }] } };
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
      createWorkerController: createMockWorkerController,
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
    expect(result.data.blocks).toBeNull();
  });
});
