const MAX_SOURCE_PAGES = 100;
export const MAX_OCR_PAGES = 5;
const OCR_SCALE = 2.5;
const MAX_CANVAS_DIMENSION = 4_096;
const MAX_CANVAS_PIXELS = 12_000_000;
const MAX_TOTAL_CANVAS_PIXELS = 36_000_000;

interface PdfPage {
  getViewport(options: { scale: number }): { width: number; height: number };
  render(options: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }): { promise: Promise<unknown>; cancel(): void };
  cleanup(): void;
}

interface PdfDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
}

interface PdfLoadingTask {
  promise: Promise<PdfDocument>;
  destroy(): Promise<void>;
}

interface OcrWorker {
  recognize(canvas: HTMLCanvasElement): Promise<{ data: { text: string } }>;
  terminate(): Promise<unknown>;
}

interface TesseractRuntime {
  createWorker(
    language: string,
    engine: number,
    options: Record<string, unknown>,
  ): Promise<OcrWorker>;
  OEM: { LSTM_ONLY: number };
}

export interface OcrWorkerController {
  ready: Promise<OcrWorker>;
  terminate(): Promise<unknown>;
}

export interface BrowserOcrDependencies {
  loadPdfJs(): Promise<{
    GlobalWorkerOptions: { workerSrc: string };
    getDocument(options: Record<string, unknown>): PdfLoadingTask;
  }>;
  loadTesseract(): Promise<TesseractRuntime>;
  createWorkerController(
    tesseract: TesseractRuntime,
    language: string,
    engine: number,
    options: Record<string, unknown>,
  ): OcrWorkerController;
  createCanvas(): HTMLCanvasElement;
}

export function restoreWorkerConstructor(
  workerGlobal: { Worker: typeof Worker },
  originalDescriptor: PropertyDescriptor | undefined,
  expectedWorker: typeof Worker,
) {
  try {
    if (originalDescriptor) {
      Object.defineProperty(workerGlobal, 'Worker', originalDescriptor);
    } else if (!Reflect.deleteProperty(workerGlobal, 'Worker')) {
      throw new Error('worker-delete-failed');
    }
    if (workerGlobal.Worker !== expectedWorker) throw new Error('worker-restore-mismatch');
  } catch {
    throw new Error('ocr-worker-control-unavailable');
  }
}

export function createControlledWorkerController(
  tesseract: TesseractRuntime,
  language: string,
  engine: number,
  options: Record<string, unknown>,
): OcrWorkerController {
  const NativeWorker = globalThis.Worker;
  if (typeof NativeWorker !== 'function') throw new Error('ocr-worker-control-unavailable');

  const capturedWorkers: Worker[] = [];
  const terminatedWorkers = new Set<Worker>();
  let terminationRequested = false;
  let terminationTail: Promise<void> = Promise.resolve();
  const terminate = () => {
    terminationRequested = true;
    const batch = capturedWorkers.filter((worker) => !terminatedWorkers.has(worker));
    batch.forEach((worker) => terminatedWorkers.add(worker));
    if (batch.length === 0) return terminationTail;
    const batchTermination = Promise.all(batch.map(async (nativeWorker) => {
      try {
        await nativeWorker.terminate();
      } catch {
        // One broken worker must not prevent the remaining workers from terminating.
      }
    })).then(() => undefined);
    terminationTail = Promise.all([terminationTail, batchTermination]).then(() => undefined);
    return terminationTail;
  };
  const CapturingWorker = new Proxy(NativeWorker, {
    construct(target, args) {
      const nativeWorker = Reflect.construct(target, args, target) as Worker;
      capturedWorkers.push(nativeWorker);
      return nativeWorker;
    },
  });
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker');

  let rejectInitialization!: (error: Error) => void;
  const initializationFailure = new Promise<OcrWorker>((_resolve, reject) => {
    rejectInitialization = reject;
  });
  void initializationFailure.catch(() => undefined);
  let upstreamReady!: Promise<OcrWorker>;
  let ready!: Promise<OcrWorker>;
  try {
    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      writable: true,
      value: CapturingWorker,
    });
    upstreamReady = tesseract.createWorker(language, engine, {
      ...options,
      errorHandler: () => {
        rejectInitialization(new Error('ocr-worker-initialization-failed'));
        void terminate();
      },
    });
    void upstreamReady.catch(() => undefined);
    ready = Promise.race([upstreamReady, initializationFailure]);
    void ready.catch(() => terminate());
    if (terminationRequested) void terminate();
  } catch (error) {
    void terminate();
    throw error;
  } finally {
    try {
      restoreWorkerConstructor(globalThis, originalDescriptor, NativeWorker);
    } catch {
      void terminate();
      throw new Error('ocr-worker-control-unavailable');
    }
  }

  if (capturedWorkers.length !== 1) {
    void terminate();
    void upstreamReady.then(
      (lateWorker) => terminateLateWorker(lateWorker),
      () => undefined,
    );
    throw new Error('ocr-worker-control-unavailable');
  }
  return { ready, terminate };
}

const defaultDependencies: BrowserOcrDependencies = {
  async loadPdfJs() {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString();
    return pdfjs as unknown as Awaited<ReturnType<BrowserOcrDependencies['loadPdfJs']>>;
  },
  async loadTesseract() {
    return import('tesseract.js') as unknown as ReturnType<
      BrowserOcrDependencies['loadTesseract']
    >;
  },
  createWorkerController: createControlledWorkerController,
  createCanvas() {
    return document.createElement('canvas');
  },
};

export function validateOcrPageRange(startPage: number, endPage: number, pageCount: number) {
  const valid = Number.isInteger(pageCount)
    && pageCount >= 1
    && pageCount <= MAX_SOURCE_PAGES
    && Number.isInteger(startPage)
    && Number.isInteger(endPage)
    && startPage >= 1
    && endPage <= pageCount
    && startPage <= endPage
    && endPage - startPage + 1 <= MAX_OCR_PAGES;
  if (!valid) throw new Error('ocr-page-range-invalid');
  return { startPage, endPage };
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
}

function validateSameOriginUrl(path: string, expectedPrefix: string): string {
  const url = new URL(path, location.origin);
  if (url.origin !== location.origin || !url.pathname.startsWith(expectedPrefix)) {
    throw new Error('ocr-runtime-url-invalid');
  }
  return url.toString();
}

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

function releaseBytes(bytes: Uint8Array) {
  try {
    bytes.fill(0);
  } catch {
    // PDF.js may have transferred and detached this local copy.
  }
}

function terminateLateWorker(worker: OcrWorker) {
  try {
    void worker.terminate().catch(() => undefined);
  } catch {
    // The main OCR operation has already settled; late cleanup is best-effort.
  }
}

function cleanupLatePage(page: PdfPage) {
  try {
    page.cleanup();
  } catch {
    // The main OCR operation has already settled; late cleanup is best-effort.
  }
}

function runCleanup(operation: () => unknown): Promise<void> {
  try {
    return Promise.resolve(operation()).then(
      () => undefined,
      () => undefined,
    );
  } catch {
    return Promise.resolve();
  }
}

function clearCanvas(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  try {
    canvas.width = 0;
  } catch {
    // Continue releasing the remaining resources.
  }
  try {
    canvas.height = 0;
  } catch {
    // Continue releasing the remaining resources.
  }
}

export async function runSbiBrowserOcr(
  source: Uint8Array,
  range: { startPage: number; endPage: number },
  signal: AbortSignal,
  onProgress: (completed: number, total: number) => void,
  dependencies: BrowserOcrDependencies = defaultDependencies,
) {
  const { createSbiOcrSafeReportBuilder } = await import('./ocr-safe-report');
  signal.throwIfAborted();
  const pdfjs = await dependencies.loadPdfJs();
  signal.throwIfAborted();
  validateSameOriginUrl(pdfjs.GlobalWorkerOptions.workerSrc, '/');
  const workerPath = validateSameOriginUrl('/ocr/worker.min.js', '/ocr/worker.min.js');
  const corePath = validateSameOriginUrl('/ocr/core', '/ocr/core');
  const langPath = validateSameOriginUrl('/ocr/lang', '/ocr/lang');
  const pdfSource = source.slice();
  const loadingTask = pdfjs.getDocument({
    data: pdfSource,
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    stopAtErrors: true,
    verbosity: 0,
  });
  let worker: OcrWorker | null = null;
  let workerController: OcrWorkerController | null = null;
  let terminatePromise: Promise<unknown> | null = null;
  let destroyPromise: Promise<void> | null = null;
  let renderTask: ReturnType<PdfPage['render']> | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let page: PdfPage | null = null;
  const safeReport = createSbiOcrSafeReportBuilder();
  let renderedPixels = 0;
  let completed = false;
  const terminateWorker = () => {
    if (!workerController) return Promise.resolve();
    terminatePromise ??= workerController.terminate();
    return terminatePromise;
  };
  const destroyPdf = () => {
    destroyPromise ??= loadingTask.destroy();
    return destroyPromise;
  };
  const onAbort = () => {
    const task = renderTask;
    renderTask = null;
    if (task) void runCleanup(() => task.cancel());
    void runCleanup(terminateWorker);
    void runCleanup(destroyPdf);
  };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    const pdf = await raceAbort(loadingTask.promise, signal);
    validateOcrPageRange(range.startPage, range.endPage, pdf.numPages);
    const tesseract = await raceAbort(dependencies.loadTesseract(), signal);
    workerController = dependencies.createWorkerController(
      tesseract,
      'jpn',
      tesseract.OEM.LSTM_ONLY,
      {
        workerPath,
        corePath,
        langPath,
        workerBlobURL: false,
        cacheMethod: 'none',
        gzip: true,
      },
    );
    worker = await raceAbort(workerController.ready, signal);
    const total = range.endPage - range.startPage + 1;
    for (let pageNumber = range.startPage; pageNumber <= range.endPage; pageNumber += 1) {
      signal.throwIfAborted();
      const pagePromise = pdf.getPage(pageNumber);
      let pageAcquired = false;
      void pagePromise.then(
        (latePage) => {
          if (!pageAcquired && signal.aborted) cleanupLatePage(latePage);
        },
        () => undefined,
      );
      page = await raceAbort(pagePromise, signal);
      pageAcquired = true;
      const baseViewport = page.getViewport({ scale: 1 });
      if (!Number.isFinite(baseViewport.width)
        || !Number.isFinite(baseViewport.height)
        || baseViewport.width <= 0
        || baseViewport.height <= 0) {
        throw new Error('ocr-page-size-invalid');
      }
      const basePixels = baseViewport.width * baseViewport.height;
      if (!Number.isFinite(basePixels) || basePixels <= 0) throw new Error('ocr-page-size-invalid');
      const boundedScale = Math.min(
        OCR_SCALE,
        MAX_CANVAS_DIMENSION / Math.max(baseViewport.width, baseViewport.height),
        Math.sqrt(MAX_CANVAS_PIXELS / basePixels),
      );
      if (!Number.isFinite(boundedScale) || boundedScale <= 0) throw new Error('ocr-page-size-invalid');
      const viewport = page.getViewport({ scale: boundedScale });
      canvas = dependencies.createCanvas();
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const canvasPixels = canvas.width * canvas.height;
      renderedPixels += canvasPixels;
      if (!Number.isSafeInteger(canvasPixels)
        || canvasPixels > MAX_CANVAS_PIXELS
        || !Number.isSafeInteger(renderedPixels)
        || renderedPixels > MAX_TOTAL_CANVAS_PIXELS) {
        throw new Error('ocr-page-size-invalid');
      }
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('ocr-canvas-unavailable');
      renderTask = page.render({ canvasContext: context, viewport });
      await raceAbort(renderTask.promise, signal);
      renderTask = null;
      signal.throwIfAborted();
      const recognitionPromise = worker.recognize(canvas);
      void recognitionPromise.then(
        (lateResult) => {
          if (signal.aborted) lateResult.data.text = '';
        },
        () => undefined,
      );
      const result = await raceAbort(recognitionPromise, signal);
      try {
        signal.throwIfAborted();
        safeReport.addPage({
          pageNumber,
          width: baseViewport.width,
          height: baseViewport.height,
          text: result.data.text,
        });
      } finally {
        result.data.text = '';
      }
      canvas.width = 0;
      canvas.height = 0;
      canvas = null;
      page.cleanup();
      page = null;
      onProgress(pageNumber - range.startPage + 1, total);
    }
    const report = safeReport.finish();
    completed = true;
    return report;
  } catch (error) {
    if (signal.aborted) throw abortError(signal);
    throw error;
  } finally {
    signal.removeEventListener('abort', onAbort);
    const task = renderTask;
    renderTask = null;
    if (task) await runCleanup(() => task.cancel());
    clearCanvas(canvas);
    const remainingPage = page;
    if (remainingPage) await runCleanup(() => remainingPage.cleanup());
    if (!completed) safeReport.safePages.length = 0;
    await Promise.all([
      runCleanup(terminateWorker),
      runCleanup(destroyPdf),
    ]);
    releaseBytes(pdfSource);
  }
}
