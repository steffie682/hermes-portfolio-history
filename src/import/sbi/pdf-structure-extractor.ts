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
  getXfa?(): Promise<unknown | null>;
  isPureXfa?: boolean;
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
const MAX_XFA_NODES = 50_000;
const MAX_XFA_DEPTH = 100;
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

function xfaGeometry(value: unknown): number {
  if (typeof value !== 'number' && typeof value !== 'string') return 0;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function extractXfaItems(
  root: unknown,
  signal: AbortSignal | undefined,
  maxItems: number,
  maxNodes: number,
  onText: (length: number) => void,
): { items: PdfStructurePage['items']; traversedNodeCount: number } {
  if (!root || typeof root !== 'object') return { items: [], traversedNodeCount: 0 };
  const items: PdfStructurePage['items'] = [];
  const seen = new WeakSet<object>();
  const stack: Array<{ node: object; depth: number }> = [{ node: root, depth: 0 }];
  let nodeCount = 0;
  while (stack.length > 0) {
    signal?.throwIfAborted();
    const entry = stack.pop()!;
    if (seen.has(entry.node)) continue;
    if (entry.depth > MAX_XFA_DEPTH) throw new Error(STRUCTURE_TOO_LARGE_ERROR);
    if (nodeCount >= maxNodes) throw new Error(STRUCTURE_TOO_LARGE_ERROR);
    seen.add(entry.node);
    nodeCount += 1;

    const node = entry.node as {
      value?: unknown;
      children?: unknown;
      attributes?: unknown;
    };
    const attributes = node.attributes && typeof node.attributes === 'object' && !Array.isArray(node.attributes)
      ? node.attributes as Record<string, unknown>
      : undefined;
    const text = typeof attributes?.textContent === 'string'
      ? attributes.textContent
      : typeof node.value === 'string' ? node.value : undefined;
    if (text !== undefined) {
      if (items.length >= maxItems) throw new Error(STRUCTURE_TOO_LARGE_ERROR);
      onText(text.length);
      let style: Record<string, unknown> | undefined;
      if (attributes) {
        const candidate = attributes.style;
        if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
          style = candidate as Record<string, unknown>;
        }
      }
      items.push({
        text,
        x: xfaGeometry(style?.left),
        y: xfaGeometry(style?.top),
        width: xfaGeometry(style?.width),
        height: xfaGeometry(style?.height),
      });
    }
    if (Array.isArray(node.children)) {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        const child = node.children[index];
        if (child && typeof child === 'object') stack.push({ node: child, depth: entry.depth + 1 });
      }
    }
  }
  return { items, traversedNodeCount: nodeCount };
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
      enableXfa: true,
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
    let xfaNodeCount = 0;
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
      let extractionMode: PdfStructurePage['extractionMode'] = content.items.length > 0
        ? 'text-content'
        : 'none';
      if (items.length === 0 && page.getXfa) {
        const xfaPromise = page.getXfa();
        const xfa = await (signal ? Promise.race([xfaPromise, aborted]) : xfaPromise);
        signal?.throwIfAborted();
        if (xfa !== null) {
          const xfaExtraction = extractXfaItems(
            xfa,
            signal,
            MAX_ITEMS - itemCount,
            MAX_XFA_NODES - xfaNodeCount,
            (length) => {
              textCharacterCount += length;
              if (textCharacterCount > MAX_TEXT_CHARACTERS) throw new Error(STRUCTURE_TOO_LARGE_ERROR);
            },
          );
          const xfaItems = xfaExtraction.items;
          xfaNodeCount += xfaExtraction.traversedNodeCount;
          itemCount += xfaItems.length;
          items.push(...xfaItems);
          extractionMode = 'xfa';
        }
      }
      if (extractionMode !== 'xfa') {
        itemCount += content.items.length;
        if (itemCount > MAX_ITEMS) throw new Error(STRUCTURE_TOO_LARGE_ERROR);
      }
      pages.push({
        pageNumber,
        width: viewport.width,
        height: viewport.height,
        extractionMode,
        rawItemCount: extractionMode === 'xfa' ? items.length : content.items.length,
        discardedItemCount: extractionMode === 'xfa' ? 0 : content.items.length - items.length,
        items,
      });
    }
    return pages;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    await destroy();
  }
}
