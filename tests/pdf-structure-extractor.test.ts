import { describe, expect, it, vi } from 'vitest';
import { extractPdfStructure } from '@/import/sbi/pdf-structure-extractor';
import { buildSbiIncomeStructureSafeReport } from '@/import/sbi/balance-report-safe-report';

const OPS = {
  save: 10,
  restore: 11,
  transform: 12,
  beginText: 31,
  endText: 32,
  setCharSpacing: 33,
  setWordSpacing: 34,
  setHScale: 35,
  setLeading: 36,
  setFont: 37,
  setTextRise: 38,
  moveText: 40,
  setLeadingMoveText: 41,
  setTextMatrix: 42,
  nextLine: 43,
  showText: 44,
  showSpacedText: 45,
  nextLineShowText: 46,
  nextLineSetSpacingShowText: 47,
  paintImageMaskXObject: 83,
  paintImageMaskXObjectGroup: 84,
  paintImageXObject: 85,
  paintInlineImageXObject: 86,
  paintInlineImageXObjectGroup: 87,
  paintImageXObjectRepeat: 88,
  paintImageMaskXObjectRepeat: 89,
  paintSolidColorImageMask: 90,
  constructPath: 91,
};

describe('PDF structure extractor', () => {
  function operatorLoader(
    fnArray: unknown[],
    overrides: Record<string, unknown> = {},
    argsArray: unknown[] = Array.from({ length: fnArray.length }, () => []),
  ) {
    const destroy = vi.fn().mockResolvedValue(undefined);
    const getOperatorList = vi.fn().mockResolvedValue({ fnArray, argsArray });
    const loader = vi.fn(() => ({ destroy, promise: Promise.resolve({
      numPages: 1,
      getPage: vi.fn().mockResolvedValue({
        getViewport: () => ({ width: 600, height: 320 }),
        getTextContent: vi.fn().mockResolvedValue({ items: [] }),
        getXfa: vi.fn().mockResolvedValue(null),
        getAnnotations: vi.fn().mockResolvedValue([]),
        getOperatorList,
        ...overrides,
      }),
    }) }));
    return { destroy, getOperatorList, loader };
  }

  it('counts mixed text, image, and path paint operators while reading only showText operands', async () => {
    const unknownArgs = { get 0() { throw new Error('CANARY_UNKNOWN_ARGS_WAS_READ'); } };
    const operatorList = {
      fnArray: [
        OPS.showText, OPS.showSpacedText, OPS.nextLineShowText, OPS.nextLineSetSpacingShowText,
        OPS.paintImageMaskXObject, OPS.paintImageMaskXObjectGroup, OPS.paintImageXObject,
        OPS.paintInlineImageXObject, OPS.paintInlineImageXObjectGroup, OPS.paintImageXObjectRepeat,
        OPS.paintImageMaskXObjectRepeat, OPS.paintSolidColorImageMask,
        OPS.constructPath, OPS.constructPath, 999,
      ],
      argsArray: [[], [], [], [], unknownArgs, unknownArgs, unknownArgs, unknownArgs, unknownArgs,
        unknownArgs, unknownArgs, unknownArgs, unknownArgs, unknownArgs, unknownArgs],
    };
    const { loader } = operatorLoader([], {
      getOperatorList: vi.fn().mockResolvedValue(operatorList),
    });

    const pages = await extractPdfStructure(new Uint8Array([1]), loader, undefined, OPS);
    const safeJson = JSON.stringify(buildSbiIncomeStructureSafeReport(pages));

    expect(pages).toEqual([expect.objectContaining({
      extractionMode: 'none', textPaintOperatorCount: 4, imagePaintOperatorCount: 8,
      pathOperatorCount: 2, totalOperatorCount: 15,
    })]);
    expect(JSON.parse(safeJson).pages[0]).toMatchObject({
      textPaintOperatorCount: 4, imagePaintOperatorCount: 8, pathOperatorCount: 2, totalOperatorCount: 15,
    });
    expect(safeJson).not.toContain('CANARY');
  });

  it('does not read any operands when no allowlisted text/state operator exists', async () => {
    const unread = { get 0() { throw new Error('CANARY_OPERAND_WAS_READ'); } };
    const { loader } = operatorLoader([OPS.paintImageXObject, 999], {}, [unread, unread]);
    const [page] = await extractPdfStructure(new Uint8Array([1]), loader, undefined, OPS);
    expect(page).toMatchObject({ extractionMode: 'none', totalOperatorCount: 2 });
  });

  it('extracts normalized showText glyphs into coarse safe geometry and classifications', async () => {
    const glyphs = (text: string) => [...text].map((unicode) => {
      const glyph = { unicode, width: 500 };
      Object.defineProperties(glyph, {
        fontChar: { get: () => { throw new Error('CANARY_FONT_CHAR'); } },
        payload: { get: () => { throw new Error('CANARY_PAYLOAD'); } },
      });
      return glyph;
    });
    const fnArray = [OPS.beginText, OPS.setFont, OPS.setTextMatrix, OPS.showText,
      OPS.moveText, OPS.showText, OPS.setLeadingMoveText, OPS.showText, OPS.endText];
    const argsArray = [[], ['CANARY_FONT_ID', 12], [new Float32Array([1, 0, 0, 1, 13, 27])], [glyphs('分配金額')],
      [97, 0], [glyphs('2026年7月18日')], [0, -18], [[...glyphs('1,234円'), -120, ...glyphs('秘密名')]], []];
    const { loader } = operatorLoader(fnArray, {}, argsArray);

    const pages = await extractPdfStructure(new Uint8Array([1]), loader, undefined, OPS);
    const report = buildSbiIncomeStructureSafeReport(pages);
    const serialized = JSON.stringify(report);

    expect(pages[0]).toMatchObject({ extractionMode: 'operator-glyphs', rawItemCount: 3,
      discardedItemCount: 0, textPaintOperatorCount: 3, totalOperatorCount: 9 });
    expect(report.pages[0].items).toEqual([
      expect.objectContaining({ kind: 'known-label', labels: ['分配金額'], x: 10, y: 30, width: 20, height: 10 }),
      expect.objectContaining({ kind: 'date', x: 110, y: 30, width: 60, height: 10 }),
      expect.objectContaining({ kind: 'masked-text', x: 110, y: 10, width: 60, height: 10 }),
    ]);
    for (const canary of ['CANARY', '2026', '1,234', '秘密名']) expect(serialized).not.toContain(canary);
  });

  it('keeps operator-only diagnostics as none when showText has no usable unicode', async () => {
    const glyph = { width: 500, fontChar: 'CANARY_FONT_CHAR' };
    const { loader } = operatorLoader([OPS.showText], {}, [[[glyph, 120, null]]]);
    const [page] = await extractPdfStructure(new Uint8Array([1]), loader, undefined, OPS);
    expect(page).toMatchObject({ extractionMode: 'none', rawItemCount: 0, items: [] });
  });

  it('rejects mismatched operator arrays before reading an operand', async () => {
    const argsArray: unknown[] = new Array(2);
    Object.defineProperty(argsArray, 0, { get: () => { throw new Error('CANARY_LATE_ARG'); } });
    const { loader } = operatorLoader([OPS.showText], {}, argsArray);
    await expect(extractPdfStructure(new Uint8Array([1]), loader, undefined, OPS))
      .rejects.toThrow('構造が大きすぎます');
  });

  it('handles cyclic/malformed glyph entries without recursive traversal', async () => {
    const glyphs: unknown[] = [null, 100, { unicode: 7, width: 500 }];
    glyphs.push(glyphs);
    const { loader } = operatorLoader([OPS.showText], {}, [[glyphs]]);
    const [page] = await extractPdfStructure(new Uint8Array([1]), loader, undefined, OPS);
    expect(page).toMatchObject({ extractionMode: 'none', items: [] });
  });

  it('accepts exactly 20,000 glyph entries and rejects 20,001 before reading one', async () => {
    const exact = Array.from({ length: 20_000 }, () => 10);
    const oversized = new Array(20_001);
    Object.defineProperty(oversized, 0, { get: () => { throw new Error('CANARY_GLYPH_READ'); } });
    const accepted = operatorLoader([OPS.showText], {}, [[exact]]);
    const rejected = operatorLoader([OPS.showText], {}, [[oversized]]);
    await expect(extractPdfStructure(new Uint8Array([1]), accepted.loader, undefined, OPS)).resolves.toBeDefined();
    await expect(extractPdfStructure(new Uint8Array([1]), rejected.loader, undefined, OPS))
      .rejects.toThrow('構造が大きすぎます');
  });

  it('accepts exactly 2M unicode characters and fails before a later width getter', async () => {
    const first = operatorLoader([OPS.showText], {}, [[[{ unicode: 'a'.repeat(2_000_000), width: 0 }]]]);
    await expect(extractPdfStructure(new Uint8Array([1]), first.loader, undefined, OPS)).resolves.toBeDefined();
    const lateGlyph = { unicode: 'x', get width() { throw new Error('CANARY_LATE_WIDTH'); } };
    const second = operatorLoader([OPS.showText, OPS.showText], {}, [
      [[{ unicode: 'a'.repeat(2_000_000), width: 0 }]], [[lateGlyph]],
    ]);
    await expect(extractPdfStructure(new Uint8Array([1]), second.loader, undefined, OPS))
      .rejects.toThrow('構造が大きすぎます');
  });

  it('aborts during glyph traversal and destroys once', async () => {
    const controller = new AbortController();
    const first = { get unicode() { controller.abort(); return 'a'; }, width: 500 };
    const { loader, destroy } = operatorLoader([OPS.showText], {}, [[[first, { unicode: 'b', width: 500 }]]]);
    await expect(extractPdfStructure(new Uint8Array([1]), loader, controller.signal, OPS))
      .rejects.toHaveProperty('name', 'AbortError');
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('accepts only the serialized nested six-value text matrix without reading extras', async () => {
    const matrix = new Float32Array([2, 0, 0, 3, 7, 11]);
    const args = [matrix] as unknown[];
    Object.defineProperty(args, 1, { get: () => { throw new Error('CANARY_MATRIX_EXTRA'); } });
    const glyph = { unicode: 'x', width: 500 };
    const valid = operatorLoader(
      [OPS.setFont, OPS.setTextMatrix, OPS.showText], {},
      [['CANARY_FONT', 10], args, [[glyph]]],
    );
    const [page] = await extractPdfStructure(new Uint8Array([1]), valid.loader, undefined, OPS);
    expect(page.items).toEqual([{ text: 'x', x: 7, y: 11, width: 10, height: 30 }]);

    const malformedValues = [
      [1, 0, 0, 1, 7, 11],
      [new Float32Array([1, 0, 0, 1, Number.NaN, 11])],
    ];
    for (const bad of malformedValues) {
      const loaded = operatorLoader([OPS.setTextMatrix, OPS.showText], {}, [bad, [[glyph]]]);
      const [malformedPage] = await extractPdfStructure(new Uint8Array([1]), loaded.loader, undefined, OPS);
      expect(malformedPage.items[0]).toMatchObject({ x: 0, y: 0 });
    }
    const arrayLike = operatorLoader([OPS.setTextMatrix, OPS.showText], {}, [
      [{ 0: 1, 1: 0, 2: 0, 3: 1, 4: 7, 5: 11, length: 6 }], [[glyph]],
    ]);
    const [arrayLikePage] = await extractPdfStructure(new Uint8Array([1]), arrayLike.loader, undefined, OPS);
    expect(arrayLikePage.items[0]).toMatchObject({ x: 7, y: 11 });
  });

  it('normalizes each glyph before accounting and supports NFKC ligature classification', async () => {
    const normalize = vi.fn((value: string) => value.normalize('NFKC'));
    const dateGlyphs = [...'２０２６年①月②日'].map((unicode) => ({ unicode, width: 100 }));
    const ligatureGlyphs = [{ unicode: 'ﬃ', width: 100 }];
    const { loader } = operatorLoader([OPS.showText, OPS.showText], {}, [[dateGlyphs], [ligatureGlyphs]]);
    const pages = await extractPdfStructure(new Uint8Array([1]), loader, undefined, OPS, normalize);
    expect(normalize).toHaveBeenCalledTimes(dateGlyphs.length + 1);
    expect(pages[0].items.map((item) => item.text)).toEqual(['2026年1月2日', 'ffi']);
    expect(buildSbiIncomeStructureSafeReport(pages).pages[0].items[0]).toMatchObject({ kind: 'date' });
    expect(buildSbiIncomeStructureSafeReport(pages).pages[0].items[1]).toMatchObject({ kind: 'masked-text' });
  });

  it('fails closed and destroys once when normalization throws or expands beyond the budget', async () => {
    for (const normalize of [
      () => { throw new Error('CANARY_NORMALIZER'); },
      () => 'x'.repeat(2_000_001),
      () => 7 as unknown as string,
    ]) {
      const { loader, destroy } = operatorLoader([OPS.showText], {}, [[[ { unicode: 'a', width: 0 } ]]]);
      await expect(extractPdfStructure(new Uint8Array([1]), loader, undefined, OPS, normalize)).rejects.toThrow();
      expect(destroy).toHaveBeenCalledOnce();
    }
  });

  it('does not read a later showText operand after the exact item budget is consumed', async () => {
    const fnArray = Array.from({ length: 20_001 }, () => OPS.showText);
    const argsArray = Array.from({ length: 20_001 }, () => [[{ unicode: 'x', width: 0 }]]) as unknown[];
    Object.defineProperty(argsArray, 20_000, { get: () => { throw new Error('CANARY_NO_ITEM_SLOT'); } });
    const { loader } = operatorLoader(fnArray, {}, argsArray);
    await expect(extractPdfStructure(new Uint8Array([1]), loader, undefined, OPS))
      .rejects.toThrow('構造が大きすぎます');
  });

  it('tracks CTM, text state, signed advance, and restores graphics state', async () => {
    const glyph = (unicode: string, width: number, isSpace = false) => ({ unicode, width, isSpace });
    const fnArray = [
      OPS.transform, OPS.save, OPS.transform, OPS.beginText, OPS.setFont, OPS.setCharSpacing,
      OPS.setWordSpacing, OPS.setHScale, OPS.setTextRise, OPS.setTextMatrix, OPS.showText,
      OPS.restore, OPS.showText,
    ];
    const argsArray = [
      [2, 0, 0, 3, 5, 7], [], [0, 1, -1, 0, 10, 20], [], ['CANARY_FONT', -10], [1],
      [2], [50], [4], [new Float32Array([1, 0, 0, 1, 3, 6])],
      [[glyph('a', 500), glyph(' ', -200, true), 100]], [], [[glyph('b', 500)]],
    ];
    const { loader } = operatorLoader(fnArray, {}, argsArray);
    const [page] = await extractPdfStructure(new Uint8Array([1]), loader, undefined, OPS);
    expect(page.items).toEqual([
      { text: 'a ', x: 5, y: 76, width: 9, height: 20 },
      { text: 'b', x: 5, y: 7, width: 0, height: 0 },
    ]);
  });

  it('exports finite nonnegative geometry while preserving signed local advances', async () => {
    const { loader } = operatorLoader(
      [OPS.setFont, OPS.setTextMatrix, OPS.showText, OPS.showText], {},
      [['font', 10], [new Float32Array([1, 0, 0, 1, 9, 8])],
        [[{ unicode: 'a', width: -500 }]], [[{ unicode: 'b', width: Number.POSITIVE_INFINITY }]]],
    );
    const [page] = await extractPdfStructure(new Uint8Array([1]), loader, undefined, OPS);
    expect(page.items).toEqual([
      { text: 'a', x: 9, y: 8, width: 5, height: 10 },
      { text: 'b', x: 4, y: 8, width: 0, height: 10 },
    ]);
  });

  it('clamps negative transformed origins without clamping signed local advances', async () => {
    const { loader } = operatorLoader(
      [OPS.setFont, OPS.setTextMatrix, OPS.showText, OPS.showText], {},
      [['font', 10], [new Float32Array([-1, 0, 0, 1, -2, -3])],
        [[{ unicode: 'a', width: -500 }]], [[{ unicode: 'b', width: 0 }]]],
    );
    const [page] = await extractPdfStructure(new Uint8Array([1]), loader, undefined, OPS);
    expect(page.items).toEqual([
      { text: 'a', x: 0, y: 0, width: 5, height: 10 },
      { text: 'b', x: 3, y: 0, width: 0, height: 10 },
    ]);
  });

  it('bounds save depth before reading excessive later state operands', async () => {
    const fnArray = [...Array.from({ length: 101 }, () => OPS.save), OPS.transform];
    const argsArray = Array.from({ length: fnArray.length }, () => []) as unknown[];
    Object.defineProperty(argsArray, 101, { get: () => { throw new Error('CANARY_AFTER_STACK'); } });
    const { loader } = operatorLoader(fnArray, {}, argsArray);
    await expect(extractPdfStructure(new Uint8Array([1]), loader, undefined, OPS))
      .rejects.toThrow('構造が大きすぎます');
  });

  it('omits operator diagnostics when the API or complete mapping is unavailable', async () => {
    const withoutApi = operatorLoader([], { getOperatorList: undefined });
    const incompleteMapping = operatorLoader([OPS.showText]);

    const [pageWithoutApi] = await extractPdfStructure(new Uint8Array([1]), withoutApi.loader, undefined, OPS);
    const [pageWithoutMapping] = await extractPdfStructure(
      new Uint8Array([1]), incompleteMapping.loader, undefined, { showText: OPS.showText },
    );

    expect(pageWithoutApi).not.toHaveProperty('totalOperatorCount');
    expect(pageWithoutMapping).not.toHaveProperty('totalOperatorCount');
    expect(incompleteMapping.getOperatorList).not.toHaveBeenCalled();
  });

  it('does not request operators when accepted text already exists', async () => {
    const getOperatorList = vi.fn().mockResolvedValue({ fnArray: [OPS.showText] });
    const { loader } = operatorLoader([], {
      getTextContent: vi.fn().mockResolvedValue({ items: [{
        str: '信用取引', transform: [1, 0, 0, 1, 10, 20], width: 30, height: 10,
      }] }),
      getOperatorList,
    });

    const [page] = await extractPdfStructure(new Uint8Array([1]), loader, undefined, OPS);

    expect(page.extractionMode).toBe('text-content');
    expect(getOperatorList).not.toHaveBeenCalled();
  });

  it('fails closed on a malformed operator list', async () => {
    const { loader, destroy } = operatorLoader([], {
      getOperatorList: vi.fn().mockResolvedValue({ fnArray: 'CANARY_NOT_AN_ARRAY' }),
    });

    await expect(extractPdfStructure(new Uint8Array([1]), loader, undefined, OPS))
      .rejects.toThrow('構造が大きすぎます');
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('fails before reading an element of an oversized single operator list', async () => {
    const fnArray = Array.from({ length: 200_001 }, () => 999);
    Object.defineProperty(fnArray, 0, {
      get: () => { throw new Error('CANARY_OVERSIZED_OPERATOR_WAS_READ'); },
    });
    const { loader } = operatorLoader(fnArray);

    await expect(extractPdfStructure(new Uint8Array([1]), loader, undefined, OPS))
      .rejects.toThrow('構造が大きすぎます');
  });

  it('fails before reading a later list that exceeds the aggregate operator budget', async () => {
    const first = Array.from({ length: 100_001 }, () => 999);
    const second = Array.from({ length: 100_000 }, () => 999);
    Object.defineProperty(second, 0, {
      get: () => { throw new Error('CANARY_AGGREGATE_OPERATOR_WAS_READ'); },
    });
    const destroy = vi.fn().mockResolvedValue(undefined);
    const getPage = vi.fn().mockImplementation(async (pageNumber: number) => ({
      getViewport: () => ({ width: 600, height: 320 }),
      getTextContent: () => Promise.resolve({ items: [] }),
      getXfa: () => Promise.resolve(null),
      getAnnotations: () => Promise.resolve([]),
      getOperatorList: () => Promise.resolve({ fnArray: pageNumber === 1 ? first : second }),
    }));
    const loader = vi.fn(() => ({ destroy, promise: Promise.resolve({ numPages: 2, getPage }) }));

    await expect(extractPdfStructure(new Uint8Array([1]), loader, undefined, OPS))
      .rejects.toThrow('構造が大きすぎます');
  });

  it('destroys once and rejects promptly when aborted during getOperatorList', async () => {
    const controller = new AbortController();
    const getOperatorList = vi.fn(() => new Promise<never>(() => undefined));
    const { destroy, loader } = operatorLoader([], { getOperatorList });
    const extraction = extractPdfStructure(new Uint8Array([1]), loader, controller.signal, OPS);

    await vi.waitFor(() => expect(getOperatorList).toHaveBeenCalledOnce());
    controller.abort();

    await expect(extraction).rejects.toHaveProperty('name', 'AbortError');
    expect(destroy).toHaveBeenCalledOnce();
  });
  function annotationLoader(annotations: unknown[], overrides: Record<string, unknown> = {}) {
    const destroy = vi.fn().mockResolvedValue(undefined);
    const getAnnotations = vi.fn().mockResolvedValue(annotations);
    const loader = vi.fn(() => ({ destroy, promise: Promise.resolve({
      numPages: 1,
      getPage: vi.fn().mockResolvedValue({
        getViewport: () => ({ width: 600, height: 320 }),
        getTextContent: vi.fn().mockResolvedValue({ items: [] }),
        getXfa: vi.fn().mockResolvedValue(null),
        getAnnotations,
        ...overrides,
      }),
    }) }));
    return { destroy, getAnnotations, loader };
  }

  it('enables XFA parsing without enabling eval or DOM rendering', async () => {
    const loader = vi.fn(() => ({
      destroy: vi.fn().mockResolvedValue(undefined),
      promise: Promise.resolve({ numPages: 1, getPage: vi.fn().mockResolvedValue({
        getViewport: () => ({ width: 600, height: 320 }),
        getTextContent: vi.fn().mockResolvedValue({ items: [] }),
        getXfa: vi.fn().mockResolvedValue(null),
      }) }),
    }));

    await extractPdfStructure(new Uint8Array([1, 2, 3]), loader);

    expect(loader).toHaveBeenCalledWith(expect.objectContaining({
      enableXfa: true,
      isEvalSupported: false,
    }));
  });

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
      extractionMode: 'text-content',
      rawItemCount: 2,
      discardedItemCount: 1,
      items: [{ text: '信用取引', x: 101, y: 702, width: 80, height: 12 }],
    }]);
    expect(loader).toHaveBeenCalledWith(expect.objectContaining({ data: expect.any(Uint8Array), isEvalSupported: false }));
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('distinguishes zero raw items from raw items discarded by the text guard', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    const getPage = vi.fn()
      .mockResolvedValueOnce({
        getViewport: () => ({ width: 600, height: 320 }),
        getTextContent: vi.fn().mockResolvedValue({ items: [] }),
      })
      .mockResolvedValueOnce({
        getViewport: () => ({ width: 600, height: 320 }),
        getTextContent: vi.fn().mockResolvedValue({ items: [
          { type: 'beginMarkedContent', canary: 'CANARY_REJECTED_VALUE' },
          { str: 'missing geometry', canary: 'CANARY_REJECTED_TEXT' },
        ] }),
      });
    const loader = vi.fn(() => ({ destroy, promise: Promise.resolve({ numPages: 2, getPage }) }));

    const pages = await extractPdfStructure(new Uint8Array([1, 2, 3]), loader);

    expect(pages).toEqual([
      { pageNumber: 1, width: 600, height: 320, extractionMode: 'none', rawItemCount: 0, discardedItemCount: 0, items: [] },
      { pageNumber: 2, width: 600, height: 320, extractionMode: 'text-content', rawItemCount: 2, discardedItemCount: 2, items: [] },
    ]);
    expect(JSON.stringify(pages)).not.toContain('CANARY_REJECTED');
  });

  it('falls back from PDF.js XFA text items without geometry to the XFA tree', async () => {
    const getXfa = vi.fn().mockResolvedValue({
      attributes: { textContent: '収益分配金', style: { left: '12px', top: '21px' } },
    });
    const loader = vi.fn(() => ({ destroy: vi.fn().mockResolvedValue(undefined), promise: Promise.resolve({
      numPages: 1,
      getPage: vi.fn().mockResolvedValue({
        getViewport: () => ({ width: 600, height: 320 }),
        getTextContent: vi.fn().mockResolvedValue({ items: [{ str: '収益分配金' }] }),
        getXfa,
      }),
    }) }));

    await expect(extractPdfStructure(new Uint8Array([1]), loader)).resolves.toEqual([{
      pageNumber: 1, width: 600, height: 320, extractionMode: 'xfa',
      rawItemCount: 1, discardedItemCount: 0,
      items: [{ text: '収益分配金', x: 12, y: 21, width: 0, height: 0 }],
    }]);
    expect(getXfa).toHaveBeenCalledOnce();
  });

  it('extracts only XFA textContent/value and approved geometry into the privacy-safe report flow', async () => {
    const xfa = {
      value: 'CANARY_SHADOWED_VALUE',
      attributes: {
        textContent: '収益分配金',
        style: { left: '12.5px', top: '21mm', width: '81pt', height: '9.5px', color: 'CANARY_STYLE' },
        id: 'CANARY_ID', href: 'https://CANARY_URL.invalid', name: 'CANARY_NAME_ATTRIBUTE',
      },
      children: [
        {
          value: 'CANARY_CHILD_SHADOWED_VALUE',
          attributes: { textContent: 'PRIVATE_NAME_CANARY', style: { left: '101px', top: '42px' } },
        },
        { value: '2026/07/22', attributes: { style: { width: 'not-a-number', height: Infinity } } },
        {
          value: '12,345円',
          attributes: { textContent: 12345, source: 'CANARY_SOURCE_ATTRIBUTE' },
          metadata: 'CANARY_METADATA',
          rejected: 'CANARY_REJECTED',
        },
      ],
    };
    const loader = vi.fn(() => ({ destroy: vi.fn().mockResolvedValue(undefined), promise: Promise.resolve({
      numPages: 1,
      getPage: vi.fn().mockResolvedValue({
        isPureXfa: true,
        getViewport: () => ({ width: 600, height: 320 }),
        getTextContent: vi.fn().mockResolvedValue({ items: [] }),
        getXfa: vi.fn().mockResolvedValue(xfa),
      }),
    }) }));

    const pages = await extractPdfStructure(new Uint8Array([1, 2, 3]), loader);
    const safeJson = JSON.stringify(buildSbiIncomeStructureSafeReport(pages));

    expect(pages[0]).toMatchObject({ extractionMode: 'xfa', rawItemCount: 4, discardedItemCount: 0 });
    expect(JSON.parse(safeJson).pages[0]).toMatchObject({
      extractionMode: 'xfa',
      items: [
        { kind: 'known-label', labels: ['収益分配金'], x: 10, y: 20, width: 80, height: 10 },
        { kind: 'masked-text', x: 100, y: 40, width: 0, height: 0 },
        { kind: 'date', x: 0, y: 0, width: 0, height: 0 },
        { kind: 'number', x: 0, y: 0, width: 0, height: 0 },
      ],
    });
    expect(safeJson).not.toMatch(/PRIVATE_NAME_CANARY|2026\/07\/22|12,345|CANARY|https:/);
  });

  it('stops fail-closed during XFA item overflow before reading later nodes', async () => {
    const unreadNode = Object.defineProperty({}, 'value', {
      get: () => { throw new Error('CANARY_LATE_NODE_WAS_READ'); },
    });
    const xfa = {
      children: [
        ...Array.from({ length: 20_001 }, () => ({ value: '口' })),
        unreadNode,
      ],
    };
    const destroy = vi.fn().mockResolvedValue(undefined);
    const loader = vi.fn(() => ({ destroy, promise: Promise.resolve({ numPages: 1, getPage: vi.fn().mockResolvedValue({
      getViewport: () => ({ width: 600, height: 320 }),
      getTextContent: () => Promise.resolve({ items: [{ str: '口' }] }),
      getXfa: () => Promise.resolve(xfa),
    }) }) }));

    await expect(extractPdfStructure(new Uint8Array([1]), loader))
      .rejects.toThrow('構造が大きすぎます');
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('preserves bounded zero diagnostics when XFA is null', async () => {
    const getXfa = vi.fn().mockResolvedValue(null);
    const loader = vi.fn(() => ({ destroy: vi.fn().mockResolvedValue(undefined), promise: Promise.resolve({
      numPages: 1,
      getPage: vi.fn().mockResolvedValue({
        getViewport: () => ({ width: 600, height: 320 }),
        getTextContent: vi.fn().mockResolvedValue({ items: [] }),
        getXfa,
      }),
    }) }));

    await expect(extractPdfStructure(new Uint8Array([1]), loader)).resolves.toEqual([{
      pageNumber: 1, width: 600, height: 320, extractionMode: 'none',
      rawItemCount: 0, discardedItemCount: 0, items: [],
    }]);
    expect(getXfa).toHaveBeenCalledOnce();
  });

  it('falls back to allowlisted annotation text and emits only safe classifications', async () => {
    const annotations = [
      {
        fieldName: '収益分配金',
        fieldValue: 'PRIVATE_ACCOUNT_CANARY',
        rect: [101, 42, 184, 54],
        id: 'CANARY_ID',
        url: 'https://CANARY_URL.invalid',
        action: 'CANARY_ACTION',
      },
      { fieldValue: ['2026/07/22', '12,345円'], rect: [20, 30, 10, 5] },
      { contentsObj: { str: '再投資口数' }, rect: [0, 1, Number.NaN, 4] },
      { fieldValue: 12345, fieldName: null, contentsObj: { str: 42 } },
    ];
    const { getAnnotations, loader } = annotationLoader(annotations);

    const pages = await extractPdfStructure(new Uint8Array([1]), loader);
    const safeJson = JSON.stringify(buildSbiIncomeStructureSafeReport(pages));

    expect(getAnnotations).toHaveBeenCalledWith({ intent: 'display' });
    expect(pages[0]).toMatchObject({ extractionMode: 'annotations', rawItemCount: 5, discardedItemCount: 0 });
    expect(JSON.parse(safeJson).pages[0].items).toEqual([
      { kind: 'known-label', labels: ['収益分配金'], x: 100, y: 40, width: 80, height: 10 },
      { kind: 'masked-text', x: 100, y: 40, width: 80, height: 10 },
      { kind: 'date', x: 10, y: 10, width: 10, height: 30 },
      { kind: 'number', x: 10, y: 10, width: 10, height: 30 },
      { kind: 'known-label', labels: ['再投資', '再投資口数', '口数'], x: 0, y: 0, width: 0, height: 0 },
    ]);
    expect(safeJson).not.toMatch(/PRIVATE_ACCOUNT_CANARY|2026\/07\/22|12,345|CANARY|https:/);
  });

  it('does not access or serialize irrelevant annotation getters', async () => {
    const annotation: Record<string, unknown> = { fieldValue: '口数', rect: [1, 2, 3, 4] };
    for (const key of ['id', 'url', 'actions', 'js', 'alternativeText', 'title', 'filename', 'metadata']) {
      Object.defineProperty(annotation, key, { get: () => { throw new Error(`accessed ${key}`); } });
    }
    const { loader } = annotationLoader([annotation]);

    const pages = await extractPdfStructure(new Uint8Array([1]), loader);

    expect(JSON.stringify(buildSbiIncomeStructureSafeReport(pages))).not.toContain('accessed');
  });

  it('fails before reading any getter on the next annotation after the item budget is exhausted', async () => {
    const late = {};
    const getters = new Map<string, ReturnType<typeof vi.fn>>();
    for (const key of ['rect', 'fieldName', 'fieldValue', 'contentsObj']) {
      const getter = vi.fn(() => { throw new Error(`CANARY_ACCESSED_${key}`); });
      getters.set(key, getter);
      Object.defineProperty(late, key, { get: getter });
    }
    const annotations = [
      ...Array.from({ length: 10_000 }, () => ({ fieldName: '口', fieldValue: '数' })),
      late,
    ];
    const { destroy, loader } = annotationLoader(annotations);

    await expect(extractPdfStructure(new Uint8Array([1]), loader))
      .rejects.toThrow('構造が大きすぎます');
    for (const getter of getters.values()) expect(getter).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('fails before reading fieldValue when fieldName consumes the last item slot', async () => {
    const getFieldValue = vi.fn(() => { throw new Error('CANARY_ACCESSED_fieldValue'); });
    const last = Object.defineProperty({ fieldName: '口' }, 'fieldValue', {
      get: getFieldValue,
    });
    const annotations = [
      ...Array.from({ length: 9_999 }, () => ({ fieldName: '口', fieldValue: '数' })),
      { fieldName: '口' },
      last,
    ];
    const { loader } = annotationLoader(annotations);

    await expect(extractPdfStructure(new Uint8Array([1]), loader))
      .rejects.toThrow('構造が大きすぎます');
    expect(getFieldValue).not.toHaveBeenCalled();
  });

  it('fails before reading contentsObj when fieldValue consumes the last item slot', async () => {
    const getContentsObj = vi.fn(() => { throw new Error('CANARY_ACCESSED_contentsObj'); });
    const last = Object.defineProperty({ fieldValue: '口' }, 'contentsObj', {
      get: getContentsObj,
    });
    const annotations = [
      ...Array.from({ length: 9_999 }, () => ({ fieldName: '口', fieldValue: '数' })),
      { fieldName: '口' },
      last,
    ];
    const { loader } = annotationLoader(annotations);

    await expect(extractPdfStructure(new Uint8Array([1]), loader))
      .rejects.toThrow('構造が大きすぎます');
    expect(getContentsObj).not.toHaveBeenCalled();
  });

  it('counts only emitted strings in annotation fieldValue arrays', async () => {
    const annotations = [
      ...Array.from({ length: 9_999 }, () => ({ fieldName: '口', fieldValue: '数' })),
      { fieldValue: [0, { raw: 'PRIVATE_ARRAY_CANARY' }, '口'] },
    ];
    const { loader } = annotationLoader(annotations);

    const pages = await extractPdfStructure(new Uint8Array([1]), loader);
    const safeJson = JSON.stringify(buildSbiIncomeStructureSafeReport(pages));

    expect(pages[0]).toMatchObject({ extractionMode: 'annotations', rawItemCount: 19_999 });
    expect(pages[0]?.items).toHaveLength(19_999);
    expect(pages[0]?.items.at(-1)).toEqual({ text: '口', x: 0, y: 0, width: 0, height: 0 });
    expect(safeJson).not.toMatch(/PRIVATE_ARRAY_CANARY|"text"|"raw"/);
  });

  it('fails before reading a fieldValue array entry after the item budget is exhausted', async () => {
    const getLateEntry = vi.fn(() => { throw new Error('CANARY_ACCESSED_LATE_ARRAY_ENTRY'); });
    const fieldValue: unknown[] = [0, '口'];
    Object.defineProperty(fieldValue, 2, { get: getLateEntry });
    const annotations = [
      ...Array.from({ length: 9_999 }, () => ({ fieldName: '口', fieldValue: '数' })),
      { fieldName: '口' },
      { fieldValue },
    ];
    const { loader } = annotationLoader(annotations);

    await expect(extractPdfStructure(new Uint8Array([1]), loader))
      .rejects.toThrow('構造が大きすぎます');
    expect(getLateEntry).not.toHaveBeenCalled();
  });

  it('zeros annotation geometry when finite coordinates produce non-finite derived values', async () => {
    const { loader } = annotationLoader([{
      fieldValue: '口数',
      rect: [-Number.MAX_VALUE, -Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE],
    }]);

    await expect(extractPdfStructure(new Uint8Array([1]), loader)).resolves.toEqual([
      expect.objectContaining({
        items: [{ text: '口数', x: 0, y: 0, width: 0, height: 0 }],
      }),
    ]);
  });

  it('keeps none diagnostics for empty XFA and annotations without allowed strings', async () => {
    const { loader } = annotationLoader([{ id: 'CANARY_ID', fieldValue: 1 }, null], {
      getXfa: vi.fn().mockResolvedValue({ children: [] }),
    });

    await expect(extractPdfStructure(new Uint8Array([1]), loader)).resolves.toEqual([{
      pageNumber: 1, width: 600, height: 320, extractionMode: 'none',
      rawItemCount: 0, discardedItemCount: 0, items: [],
    }]);
  });

  it('fails closed at the aggregate annotation bound before reading a later value', async () => {
    const late = Object.defineProperty({}, 'fieldValue', {
      get: () => { throw new Error('CANARY_LATE_ANNOTATION_WAS_READ'); },
    });
    const pageOne = Array.from({ length: 10_000 }, () => ({ fieldValue: '口' }));
    const pageTwo = [...Array.from({ length: 10_001 }, () => ({ fieldValue: '口' })), late];
    const destroy = vi.fn().mockResolvedValue(undefined);
    const getPage = vi.fn().mockImplementation(async (pageNumber: number) => ({
      getViewport: () => ({ width: 600, height: 320 }),
      getTextContent: () => Promise.resolve({ items: [] }),
      getXfa: () => Promise.resolve(null),
      getAnnotations: () => Promise.resolve(pageNumber === 1 ? pageOne : pageTwo),
    }));
    const loader = vi.fn(() => ({ destroy, promise: Promise.resolve({ numPages: 2, getPage }) }));

    await expect(extractPdfStructure(new Uint8Array([1]), loader)).rejects.toThrow('構造が大きすぎます');
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('fails closed at the aggregate annotation text bound before a later annotation', async () => {
    const late = Object.defineProperty({}, 'fieldValue', {
      get: () => { throw new Error('CANARY_LATE_ANNOTATION_TEXT_WAS_READ'); },
    });
    const destroy = vi.fn().mockResolvedValue(undefined);
    const getPage = vi.fn().mockImplementation(async (pageNumber: number) => ({
      getViewport: () => ({ width: 600, height: 320 }),
      getTextContent: () => Promise.resolve({ items: [] }),
      getXfa: () => Promise.resolve(null),
      getAnnotations: () => Promise.resolve(pageNumber === 1
        ? [{ fieldValue: 'a'.repeat(1_000_000) }]
        : [{ fieldValue: 'b'.repeat(1_000_001) }, late]),
    }));
    const loader = vi.fn(() => ({ destroy, promise: Promise.resolve({ numPages: 2, getPage }) }));

    await expect(extractPdfStructure(new Uint8Array([1]), loader)).rejects.toThrow('構造が大きすぎます');
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('destroys once and rejects promptly when aborted during getAnnotations', async () => {
    const controller = new AbortController();
    const getAnnotations = vi.fn(() => new Promise<never>(() => undefined));
    const { destroy, loader } = annotationLoader([], { getAnnotations });
    const extraction = extractPdfStructure(new Uint8Array([1]), loader, controller.signal);

    await vi.waitFor(() => expect(getAnnotations).toHaveBeenCalledOnce());
    controller.abort();

    await expect(extraction).rejects.toHaveProperty('name', 'AbortError');
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('skips cyclic XFA references safely', async () => {
    const xfa: { value: string; children: unknown[] } = { value: '口数', children: [] };
    xfa.children.push(xfa);
    const loader = vi.fn(() => ({ destroy: vi.fn().mockResolvedValue(undefined), promise: Promise.resolve({
      numPages: 1,
      getPage: vi.fn().mockResolvedValue({
        getViewport: () => ({ width: 600, height: 320 }), getTextContent: () => Promise.resolve({ items: [] }),
        getXfa: () => Promise.resolve(xfa),
      }),
    }) }));

    await expect(extractPdfStructure(new Uint8Array([1]), loader)).resolves.toEqual([expect.objectContaining({
      extractionMode: 'xfa', rawItemCount: 1, discardedItemCount: 0,
    })]);
  });

  it('fails closed when XFA depth exceeds its bound', async () => {
    let xfa: Record<string, unknown> = { value: '口数' };
    for (let index = 0; index < 200; index += 1) xfa = { children: [xfa] };
    const destroy = vi.fn().mockResolvedValue(undefined);
    const loader = vi.fn(() => ({ destroy, promise: Promise.resolve({ numPages: 1, getPage: vi.fn().mockResolvedValue({
      getViewport: () => ({ width: 600, height: 320 }), getTextContent: () => Promise.resolve({ items: [] }),
      getXfa: () => Promise.resolve(xfa),
    }) }) }));

    await expect(extractPdfStructure(new Uint8Array([1]), loader))
      .rejects.toThrow('SBI取引残高報告書PDFの構造が大きすぎます');
    expect(destroy).toHaveBeenCalledOnce();
  });

  it.each([
    ['node count', { children: Array.from({ length: 50_001 }, () => ({})) }],
    ['item count', { children: Array.from({ length: 20_001 }, () => ({ value: '口' })) }],
    ['text characters', { value: 'a'.repeat(2_000_001) }],
  ])('fails closed when XFA exceeds the %s bound', async (_bound, xfa) => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    const loader = vi.fn(() => ({ destroy, promise: Promise.resolve({ numPages: 1, getPage: vi.fn().mockResolvedValue({
      getViewport: () => ({ width: 600, height: 320 }), getTextContent: () => Promise.resolve({ items: [] }),
      getXfa: () => Promise.resolve(xfa),
    }) }) }));

    await expect(extractPdfStructure(new Uint8Array([1]), loader))
      .rejects.toThrow('SBI取引残高報告書PDFの構造が大きすぎます');
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('fails closed when aggregate XFA nodes across pages exceed the document bound', async () => {
    const xfaPages = Array.from({ length: 2 }, () => ({
      children: Array.from({ length: 25_000 }, () => ({})),
    }));
    xfaPages[1].children[24_998] = Object.defineProperty({}, 'value', {
      get: () => { throw new Error('CANARY_OVER_BUDGET_NODE_WAS_READ'); },
    });
    const destroy = vi.fn().mockResolvedValue(undefined);
    const getPage = vi.fn().mockImplementation(async (pageNumber: number) => ({
      getViewport: () => ({ width: 600, height: 320 }),
      getTextContent: () => Promise.resolve({ items: [] }),
      getXfa: () => Promise.resolve(xfaPages[pageNumber - 1]),
    }));
    const loader = vi.fn(() => ({
      destroy,
      promise: Promise.resolve({ numPages: 2, getPage }),
    }));

    await expect(extractPdfStructure(new Uint8Array([1]), loader))
      .rejects.toThrow('SBI取引残高報告書PDFの構造が大きすぎます');
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('destroys once and rejects promptly when aborted during getXfa', async () => {
    const controller = new AbortController();
    const destroy = vi.fn().mockResolvedValue(undefined);
    const getXfa = vi.fn(() => new Promise<never>(() => undefined));
    const loader = vi.fn(() => ({ destroy, promise: Promise.resolve({ numPages: 1, getPage: vi.fn().mockResolvedValue({
      getViewport: () => ({ width: 600, height: 320 }), getTextContent: () => Promise.resolve({ items: [] }), getXfa,
    }) }) }));
    const extraction = extractPdfStructure(new Uint8Array([1]), loader, controller.signal);

    await vi.waitFor(() => expect(getXfa).toHaveBeenCalledOnce());
    controller.abort();

    await expect(extraction).rejects.toHaveProperty('name', 'AbortError');
    expect(destroy).toHaveBeenCalledOnce();
  });

  it.each([Number.NaN, 1.5])(
    'rejects invalid page count %s and destroys the PDF document once',
    async (numPages) => {
      const destroy = vi.fn().mockResolvedValue(undefined);
      const loader = vi.fn(() => ({ destroy, promise: Promise.resolve({
        numPages,
        getPage: vi.fn(),
      }) }));

      await expect(extractPdfStructure(new Uint8Array([1, 2, 3]), loader))
        .rejects.toThrow('SBI取引残高報告書PDFのページ数を確認できません');
      expect(destroy).toHaveBeenCalledOnce();
    },
  );

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
