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
  getAnnotations?(input: { intent: 'display' }): Promise<unknown[]>;
  getOperatorList?(): Promise<{ fnArray: unknown[]; argsArray: unknown[] }>;
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

const TEXT_PAINT_OPERATOR_NAMES = [
  'showText', 'showSpacedText', 'nextLineShowText', 'nextLineSetSpacingShowText',
] as const;
const IMAGE_PAINT_OPERATOR_NAMES = [
  'paintImageMaskXObject', 'paintImageMaskXObjectGroup', 'paintImageXObject',
  'paintInlineImageXObject', 'paintInlineImageXObjectGroup', 'paintImageXObjectRepeat',
  'paintImageMaskXObjectRepeat', 'paintSolidColorImageMask',
] as const;
const PATH_OPERATOR_NAMES = ['constructPath'] as const;
type PdfPaintOperatorName = typeof TEXT_PAINT_OPERATOR_NAMES[number]
  | typeof IMAGE_PAINT_OPERATOR_NAMES[number]
  | typeof PATH_OPERATOR_NAMES[number];
const TEXT_STATE_OPERATOR_NAMES = [
  'save', 'restore', 'transform', 'beginText', 'endText', 'setCharSpacing',
  'setWordSpacing', 'setHScale', 'setLeading', 'setFont', 'setTextRise',
  'moveText', 'setLeadingMoveText', 'setTextMatrix', 'nextLine',
] as const;
type PdfTextStateOperatorName = typeof TEXT_STATE_OPERATOR_NAMES[number];
export type PdfOperatorCodeMapping = Partial<Record<PdfPaintOperatorName | PdfTextStateOperatorName, unknown>>;

const MAX_PAGES = 100;
const MAX_ITEMS = 20_000;
const MAX_TEXT_CHARACTERS = 2_000_000;
const MAX_XFA_NODES = 50_000;
const MAX_XFA_DEPTH = 100;
const MAX_ANNOTATIONS = 20_000;
const MAX_OPERATORS = 200_000;
const STRUCTURE_TOO_LARGE_ERROR = 'SBI取引残高報告書PDFの構造が大きすぎます';

interface OperatorCodeSets {
  text: Set<number>;
  image: Set<number>;
  path: Set<number>;
  showText: number;
  state: Record<PdfTextStateOperatorName, number>;
}

function operatorCodeSets(mapping: PdfOperatorCodeMapping | undefined): OperatorCodeSets | null {
  if (!mapping || typeof mapping !== 'object') return null;
  const codes = new Map<PdfPaintOperatorName | PdfTextStateOperatorName, number>();
  for (const name of [
    ...TEXT_PAINT_OPERATOR_NAMES, ...IMAGE_PAINT_OPERATOR_NAMES, ...PATH_OPERATOR_NAMES,
    ...TEXT_STATE_OPERATOR_NAMES,
  ]) {
    const code = mapping[name];
    if (!Number.isInteger(code) || (code as number) < 0 || (code as number) > MAX_OPERATORS) return null;
    codes.set(name, code as number);
  }
  if (new Set(codes.values()).size !== codes.size) return null;
  return {
    text: new Set(TEXT_PAINT_OPERATOR_NAMES.map((name) => codes.get(name)!)),
    image: new Set(IMAGE_PAINT_OPERATOR_NAMES.map((name) => codes.get(name)!)),
    path: new Set(PATH_OPERATOR_NAMES.map((name) => codes.get(name)!)),
    showText: codes.get('showText')!,
    state: Object.fromEntries(TEXT_STATE_OPERATOR_NAMES.map((name) => [name, codes.get(name)!])) as
      Record<PdfTextStateOperatorName, number>,
  };
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

type Matrix = [number, number, number, number, number, number];
const IDENTITY_MATRIX: Matrix = [1, 0, 0, 1, 0, 0];

function multiplyMatrices(left: Matrix, right: Matrix): Matrix | null {
  const result: Matrix = [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
  return result.every(finiteNumber) ? result : null;
}

function directMatrix(args: unknown): Matrix | null {
  if (!Array.isArray(args) || args.length !== 6) return null;
  const a = args[0]; const b = args[1]; const c = args[2];
  const d = args[3]; const e = args[4]; const f = args[5];
  return finiteNumber(a) && finiteNumber(b) && finiteNumber(c)
    && finiteNumber(d) && finiteNumber(e) && finiteNumber(f) ? [a, b, c, d, e, f] : null;
}

function serializedTextMatrix(args: unknown): Matrix | null {
  if (!Array.isArray(args) || args.length < 1) return null;
  const matrix = args[0];
  if ((!matrix || typeof matrix !== 'object')
    || !('length' in matrix) || matrix.length !== 6) return null;
  const values = matrix as Record<number, unknown>;
  const a = values[0]; const b = values[1]; const c = values[2];
  const d = values[3]; const e = values[4]; const f = values[5];
  return finiteNumber(a) && finiteNumber(b) && finiteNumber(c)
    && finiteNumber(d) && finiteNumber(e) && finiteNumber(f) ? [a, b, c, d, e, f] : null;
}

interface OperatorState {
  ctm: Matrix;
  textMatrix: Matrix;
  x: number;
  y: number;
  lineX: number;
  lineY: number;
  fontSize: number;
  fontDirection: number;
  charSpacing: number;
  wordSpacing: number;
  textHScale: number;
  textRise: number;
  leading: number;
}

function cloneOperatorState(state: OperatorState): OperatorState {
  return { ...state, ctm: [...state.ctm], textMatrix: [...state.textMatrix] };
}

function extractOperatorGlyphItems(
  fnArray: unknown[],
  argsArray: unknown[],
  codes: OperatorCodeSets,
  signal: AbortSignal | undefined,
  maxItems: number,
  remainingGlyphs: number,
  onText: (length: number) => void,
  normalizeUnicode: (value: string) => string,
): { items: PdfStructurePage['items']; glyphCount: number } {
  if (!Array.isArray(argsArray) || argsArray.length !== fnArray.length) {
    throw new Error(STRUCTURE_TOO_LARGE_ERROR);
  }
  const items: PdfStructurePage['items'] = [];
  let glyphCount = 0;
  let state: OperatorState = {
    ctm: [...IDENTITY_MATRIX], textMatrix: [...IDENTITY_MATRIX], x: 0, y: 0, lineX: 0, lineY: 0,
    fontSize: 0, fontDirection: 1, charSpacing: 0, wordSpacing: 0,
    textHScale: 1, textRise: 0, leading: 0,
  };
  const stack: OperatorState[] = [];
  const safeGeometry = (value: number) => Number.isFinite(value) && value >= 0 ? value : 0;
  const finiteOrZero = (value: number) => Number.isFinite(value) ? value : 0;
  const scalarArg = (args: unknown): number | null => Array.isArray(args) && finiteNumber(args[0]) ? args[0] : null;
  for (let index = 0; index < fnArray.length; index += 1) {
    signal?.throwIfAborted();
    const code = fnArray[index];
    if (code === codes.showText) {
      if (items.length >= maxItems) throw new Error(STRUCTURE_TOO_LARGE_ERROR);
      const args = argsArray[index];
      if (!Array.isArray(args) || !Array.isArray(args[0])) continue;
      const glyphs = args[0];
      if (glyphs.length > remainingGlyphs - glyphCount) throw new Error(STRUCTURE_TOO_LARGE_ERROR);
      let text = '';
      let advance = 0;
      for (let glyphIndex = 0; glyphIndex < glyphs.length; glyphIndex += 1) {
        signal?.throwIfAborted();
        glyphCount += 1;
        const glyph = glyphs[glyphIndex];
        if (finiteNumber(glyph)) {
          const spacingAdvance = -glyph * state.fontSize / 1000
            * state.textHScale * state.fontDirection;
          if (Number.isFinite(advance + spacingAdvance)) advance += spacingAdvance;
          continue;
        }
        if (!glyph || typeof glyph !== 'object' || Array.isArray(glyph)) continue;
        const unicode = (glyph as { unicode?: unknown }).unicode;
        signal?.throwIfAborted();
        if (typeof unicode !== 'string') continue;
        const normalized = normalizeUnicode(unicode);
        if (typeof normalized !== 'string') throw new Error(STRUCTURE_TOO_LARGE_ERROR);
        onText(normalized.length);
        text += normalized;
        const glyphWidth = (glyph as { width?: unknown }).width;
        const isSpace = (glyph as { isSpace?: unknown }).isSpace;
        if (finiteNumber(glyphWidth)) {
          const glyphAdvance = (glyphWidth * state.fontSize / 1000 + state.charSpacing
            + (isSpace === true ? state.wordSpacing : 0)) * state.textHScale * state.fontDirection;
          if (Number.isFinite(advance + glyphAdvance)) advance += glyphAdvance;
        }
      }
      if (text.length > 0) {
        const combined = multiplyMatrices(state.ctm, state.textMatrix);
        if (!combined) throw new Error(STRUCTURE_TOO_LARGE_ERROR);
        const localX = state.x;
        const localY = state.y + state.textRise;
        const originX = combined[0] * localX + combined[2] * localY + combined[4];
        const originY = combined[1] * localX + combined[3] * localY + combined[5];
        const width = Math.hypot(combined[0] * advance, combined[1] * advance);
        const height = Math.hypot(combined[2] * state.fontSize, combined[3] * state.fontSize);
        items.push({ text, x: safeGeometry(originX), y: safeGeometry(originY),
          width: safeGeometry(width), height: safeGeometry(height) });
      }
      state.x = finiteOrZero(state.x + advance);
      continue;
    }
    if (code === codes.state.setTextMatrix) {
      const args = argsArray[index];
      const matrix = serializedTextMatrix(args);
      state.textMatrix = matrix ?? [...IDENTITY_MATRIX];
      state.x = state.y = state.lineX = state.lineY = 0;
    } else if (code === codes.state.setFont) {
      const args = argsArray[index];
      const size = Array.isArray(args) ? args[1] : undefined;
      state.fontSize = finiteNumber(size) ? Math.abs(size) : 0;
      state.fontDirection = finiteNumber(size) && size < 0 ? -1 : 1;
    } else if (code === codes.state.setLeading) {
      const value = scalarArg(argsArray[index]);
      state.leading = value === null ? 0 : -value;
    } else if (code === codes.state.setCharSpacing) {
      state.charSpacing = scalarArg(argsArray[index]) ?? 0;
    } else if (code === codes.state.setWordSpacing) {
      state.wordSpacing = scalarArg(argsArray[index]) ?? 0;
    } else if (code === codes.state.setHScale) {
      const value = scalarArg(argsArray[index]);
      state.textHScale = value === null ? 0 : value / 100;
    } else if (code === codes.state.setTextRise) {
      state.textRise = scalarArg(argsArray[index]) ?? 0;
    } else if (code === codes.state.moveText || code === codes.state.setLeadingMoveText) {
      const args = argsArray[index];
      if (Array.isArray(args) && finiteNumber(args[0]) && finiteNumber(args[1])) {
        state.lineX = finiteOrZero(state.lineX + args[0]);
        state.lineY = finiteOrZero(state.lineY + args[1]);
        state.x = state.lineX; state.y = state.lineY;
        if (code === codes.state.setLeadingMoveText) state.leading = -args[1];
      }
    } else if (code === codes.state.nextLine) {
      state.lineY = finiteOrZero(state.lineY + state.leading);
      state.x = state.lineX; state.y = state.lineY;
    } else if (code === codes.state.beginText) {
      state.textMatrix = [...IDENTITY_MATRIX];
      state.x = state.y = state.lineX = state.lineY = 0;
    } else if (code === codes.state.transform) {
      const matrix = directMatrix(argsArray[index]);
      if (matrix) state.ctm = multiplyMatrices(state.ctm, matrix) ?? state.ctm;
    } else if (code === codes.state.save) {
      if (stack.length >= 100) throw new Error(STRUCTURE_TOO_LARGE_ERROR);
      stack.push(cloneOperatorState(state));
    } else if (code === codes.state.restore) {
      if (stack.length > 0) state = stack.pop()!;
    }
  }
  return { items, glyphCount };
}

function countPaintOperators(fnArray: unknown[], codes: OperatorCodeSets, remaining: number) {
  if (!Array.isArray(fnArray)) throw new Error(STRUCTURE_TOO_LARGE_ERROR);
  const totalOperatorCount = fnArray.length;
  if (totalOperatorCount > remaining) throw new Error(STRUCTURE_TOO_LARGE_ERROR);
  let textPaintOperatorCount = 0;
  let imagePaintOperatorCount = 0;
  let pathOperatorCount = 0;
  for (let index = 0; index < totalOperatorCount; index += 1) {
    const code = fnArray[index];
    if (!Number.isInteger(code) || (code as number) < 0 || (code as number) > MAX_OPERATORS) continue;
    if (codes.text.has(code as number)) textPaintOperatorCount += 1;
    else if (codes.image.has(code as number)) imagePaintOperatorCount += 1;
    else if (codes.path.has(code as number)) pathOperatorCount += 1;
  }
  return {
    textPaintOperatorCount,
    imagePaintOperatorCount,
    pathOperatorCount,
    totalOperatorCount,
  };
}

function isTextItem(item: unknown): item is PdfTextItemLike {
  if (!item || typeof item !== 'object') return false;
  const candidate = item as Partial<PdfTextItemLike>;
  return typeof candidate.str === 'string'
    && Array.isArray(candidate.transform)
    && candidate.transform.length >= 6
    && candidate.transform.every((value) => typeof value === 'number' && Number.isFinite(value))
    && finiteNumber(candidate.width)
    && finiteNumber(candidate.height);
}

function xfaGeometry(value: unknown): number {
  if (typeof value !== 'number' && typeof value !== 'string') return 0;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nonnegativeGeometry(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
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
        width: nonnegativeGeometry(xfaGeometry(style?.width)),
        height: nonnegativeGeometry(xfaGeometry(style?.height)),
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

function annotationGeometry(rect: unknown): Pick<PdfStructurePage['items'][number], 'x' | 'y' | 'width' | 'height'> {
  if (!Array.isArray(rect) || rect.length !== 4
    || !rect.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const [x1, y1, x2, y2] = rect as [number, number, number, number];
  const geometry = {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
  return Object.values(geometry).every(Number.isFinite)
    ? geometry
    : { x: 0, y: 0, width: 0, height: 0 };
}

function extractAnnotationItems(
  annotations: unknown,
  signal: AbortSignal | undefined,
  maxItems: number,
  onText: (length: number) => void,
): PdfStructurePage['items'] {
  if (!Array.isArray(annotations) || annotations.length === 0) return [];
  const items: PdfStructurePage['items'] = [];
  const requireRemainingItem = () => {
    if (items.length >= maxItems) throw new Error(STRUCTURE_TOO_LARGE_ERROR);
  };
  const add = (text: string, geometry: ReturnType<typeof annotationGeometry>) => {
    signal?.throwIfAborted();
    requireRemainingItem();
    onText(text.length);
    items.push({ text, ...geometry });
  };
  for (const value of annotations) {
    signal?.throwIfAborted();
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const annotation = value as {
      fieldName?: unknown;
      fieldValue?: unknown;
      contentsObj?: unknown;
      rect?: unknown;
    };
    requireRemainingItem();
    const geometry = annotationGeometry(annotation.rect);
    const annotationItemStart = items.length;
    requireRemainingItem();
    const fieldName = annotation.fieldName;
    if (typeof fieldName === 'string') add(fieldName, geometry);
    requireRemainingItem();
    const fieldValue = annotation.fieldValue;
    if (typeof fieldValue === 'string') {
      add(fieldValue, geometry);
    } else if (Array.isArray(fieldValue)) {
      for (let index = 0; index < fieldValue.length; index += 1) {
        requireRemainingItem();
        signal?.throwIfAborted();
        const entry = fieldValue[index];
        if (typeof entry === 'string') add(entry, geometry);
      }
    }
    requireRemainingItem();
    if (items.length === annotationItemStart) {
      const contentsObj = annotation.contentsObj;
      if (contentsObj && typeof contentsObj === 'object' && !Array.isArray(contentsObj)) {
        const contents = (contentsObj as { str?: unknown }).str;
        if (typeof contents === 'string') add(contents, geometry);
      }
    }
  }
  return items;
}

export async function extractPdfStructure(
  source: Uint8Array,
  loadDocument: PdfDocumentLoader,
  signal?: AbortSignal,
  operatorCodes?: PdfOperatorCodeMapping,
  normalizeUnicode: (value: string) => string = (value) => value,
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
    let annotationCount = 0;
    let operatorCount = 0;
    let operatorGlyphCount = 0;
    const paintOperatorCodes = operatorCodeSets(operatorCodes);
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
          width: nonnegativeGeometry(item.width),
          height: nonnegativeGeometry(item.height),
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
          if (xfaItems.length > 0) {
            itemCount += xfaItems.length;
            items.push(...xfaItems);
            extractionMode = 'xfa';
          }
        }
      }
      if (items.length === 0 && page.getAnnotations) {
        const annotationsPromise = page.getAnnotations({ intent: 'display' });
        const annotations = await (signal ? Promise.race([annotationsPromise, aborted]) : annotationsPromise);
        signal?.throwIfAborted();
        if (Array.isArray(annotations) && annotations.length > 0) {
          if (annotations.length > MAX_ANNOTATIONS - annotationCount) throw new Error(STRUCTURE_TOO_LARGE_ERROR);
          annotationCount += annotations.length;
          const annotationItems = extractAnnotationItems(
            annotations,
            signal,
            MAX_ITEMS - itemCount,
            (length) => {
              textCharacterCount += length;
              if (textCharacterCount > MAX_TEXT_CHARACTERS) throw new Error(STRUCTURE_TOO_LARGE_ERROR);
            },
          );
          if (annotationItems.length > 0) {
            itemCount += annotationItems.length;
            items.push(...annotationItems);
            extractionMode = 'annotations';
          }
        }
      }
      let operatorDiagnostics: ReturnType<typeof countPaintOperators> | undefined;
      if (items.length === 0 && page.getOperatorList && paintOperatorCodes) {
        const operatorListPromise = page.getOperatorList();
        const operatorList = await (signal ? Promise.race([operatorListPromise, aborted]) : operatorListPromise);
        signal?.throwIfAborted();
        if (!operatorList || typeof operatorList !== 'object' || !Array.isArray(operatorList.fnArray)) {
          throw new Error(STRUCTURE_TOO_LARGE_ERROR);
        }
        operatorDiagnostics = countPaintOperators(
          operatorList.fnArray,
          paintOperatorCodes,
          MAX_OPERATORS - operatorCount,
        );
        operatorCount += operatorDiagnostics.totalOperatorCount;
        if (!Array.isArray(operatorList.argsArray)
          || operatorList.argsArray.length !== operatorList.fnArray.length) {
          throw new Error(STRUCTURE_TOO_LARGE_ERROR);
        }
        const glyphExtraction = extractOperatorGlyphItems(
          operatorList.fnArray,
          operatorList.argsArray,
          paintOperatorCodes,
          signal,
          MAX_ITEMS - itemCount,
          MAX_ITEMS - operatorGlyphCount,
          (length) => {
            textCharacterCount += length;
            if (textCharacterCount > MAX_TEXT_CHARACTERS) throw new Error(STRUCTURE_TOO_LARGE_ERROR);
          },
          normalizeUnicode,
        );
        operatorGlyphCount += glyphExtraction.glyphCount;
        if (glyphExtraction.items.length > 0) {
          items.push(...glyphExtraction.items);
          extractionMode = 'operator-glyphs';
        }
      }
      if (extractionMode !== 'xfa' && extractionMode !== 'annotations') {
        itemCount += extractionMode === 'operator-glyphs' ? items.length : content.items.length;
        if (itemCount > MAX_ITEMS) throw new Error(STRUCTURE_TOO_LARGE_ERROR);
      }
      pages.push({
        pageNumber,
        width: viewport.width,
        height: viewport.height,
        extractionMode,
        rawItemCount: extractionMode === 'xfa' || extractionMode === 'annotations'
          || extractionMode === 'operator-glyphs' ? items.length : content.items.length,
        discardedItemCount: extractionMode === 'xfa' || extractionMode === 'annotations'
          || extractionMode === 'operator-glyphs' ? 0 : content.items.length - items.length,
        ...operatorDiagnostics,
        items,
      });
    }
    return pages;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    await destroy();
  }
}
