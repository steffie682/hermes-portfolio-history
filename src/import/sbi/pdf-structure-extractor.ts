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
): Promise<PdfStructurePage[]> {
  let loadingTask: PdfLoadingTaskLike | null = null;
  try {
    loadingTask = loadDocument({
      data: source,
      isEvalSupported: false,
      useSystemFonts: false,
      disableFontFace: true,
      stopAtErrors: true,
      verbosity: 0,
    });
    const document = await loadingTask.promise;
    if (document.numPages < 1 || document.numPages > MAX_PAGES) {
      throw new Error('SBI取引残高報告書PDFのページ数を確認できません');
    }
    const pages: PdfStructurePage[] = [];
    let itemCount = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items = content.items.filter(isTextItem).map((item) => ({
        text: item.str,
        x: item.transform[4],
        y: item.transform[5],
        width: item.width,
        height: item.height,
      }));
      itemCount += items.length;
      if (itemCount > MAX_ITEMS) {
        throw new Error('SBI取引残高報告書PDFの構造が大きすぎます');
      }
      pages.push({ pageNumber, width: viewport.width, height: viewport.height, items });
    }
    return pages;
  } finally {
    await loadingTask?.destroy();
  }
}
