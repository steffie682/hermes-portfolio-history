import type { PdfStructurePage } from './balance-report-safe-report';

interface PdfTextItemLike {
  str: string;
  transform: number[];
  width: number;
  height: number;
}
interface PdfPageLike {
  getViewport(input: { scale: number }): { width: number; height: number };
  getTextContent(): Promise<{ items: unknown[] }>;
}
interface PdfDocumentLike {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
}
interface PdfLoadingTaskLike {
  promise: Promise<PdfDocumentLike>;
  destroy(): Promise<void>;
}
export type PdfDocumentLoader = (options: Record<string, unknown>) => PdfLoadingTaskLike;

const MAX_PAGES = 100;
const MAX_ITEMS = 20_000;
const MAX_TEXT_CHARACTERS = 2_000_000;
const STRUCTURE_TOO_LARGE_ERROR = 'SBI取引残高報告書PDFの構造が大きすぎます';

function isTextItem(item: unknown): item is PdfTextItemLike {
  if (!item || typeof item !== 'object') return false;
  const candidate = item as Partial<PdfTextItemLike>;
  return typeof candidate.str === 'string'
    && Array.isArray(candidate.transform)
    && candidate.transform.length >= 6
    && candidate.transform.every((value) => typeof value === 'number' && Number.isFinite(value))
    && typeof candidate.width === 'number'
    && typeof candidate.height === 'number';
}

export async function extractPdfStructure(
  source: Uint8Array,
  loadDocument: PdfDocumentLoader,
  signal?: AbortSignal,
): Promise<PdfStructurePage[]> {
  signal?.throwIfAborted();
  let loadingTask: PdfLoadingTaskLike | null = null;
  let destroyPromise: Promise<void> | null = null;
  const destroy = () => {
    if (!loadingTask) return Promise.resolve();
    destroyPromise ??= loadingTask.destroy();
    return destroyPromise;
  };
  let rejectAbort: ((reason: unknown) => void) | null = null;
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const onAbort = () => {
    void destroy();
    rejectAbort?.(signal?.reason ?? new DOMException('The operation was aborted', 'AbortError'));
  };
  try {
    loadingTask = loadDocument({
      data: source,
      isEvalSupported: false,
      useSystemFonts: false,
      disableFontFace: true,
      stopAtErrors: true,
      verbosity: 0,
    });
    signal?.addEventListener('abort', onAbort, { once: true });
    signal?.throwIfAborted();
    const document = await (signal ? Promise.race([loadingTask.promise, aborted]) : loadingTask.promise);
    signal?.throwIfAborted();
    if (!Number.isInteger(document.numPages) || document.numPages < 1 || document.numPages > MAX_PAGES) {
      throw new Error('SBI取引残高報告書PDFのページ数を確認できません');
    }
    const pages: PdfStructurePage[] = [];
    let itemCount = 0;
    let textCharacterCount = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      signal?.throwIfAborted();
      const pagePromise = document.getPage(pageNumber);
      const page = await (signal ? Promise.race([pagePromise, aborted]) : pagePromise);
      signal?.throwIfAborted();
      const viewport = page.getViewport({ scale: 1 });
      signal?.throwIfAborted();
      const contentPromise = page.getTextContent();
      const content = await (signal ? Promise.race([contentPromise, aborted]) : contentPromise);
      signal?.throwIfAborted();
      itemCount += content.items.length;
      if (itemCount > MAX_ITEMS) {
        throw new Error(STRUCTURE_TOO_LARGE_ERROR);
      }
      const items: PdfStructurePage['items'] = [];
      for (const item of content.items) {
        if (!isTextItem(item)) continue;
        textCharacterCount += item.str.length;
        if (textCharacterCount > MAX_TEXT_CHARACTERS) {
          throw new Error(STRUCTURE_TOO_LARGE_ERROR);
        }
        items.push({
          text: item.str,
          x: item.transform[4],
          y: item.transform[5],
          width: item.width,
          height: item.height,
        });
      }
      pages.push({
        pageNumber,
        width: viewport.width,
        height: viewport.height,
        rawItemCount: content.items.length,
        discardedItemCount: content.items.length - items.length,
        items,
      });
    }
    return pages;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    await destroy();
  }
}
