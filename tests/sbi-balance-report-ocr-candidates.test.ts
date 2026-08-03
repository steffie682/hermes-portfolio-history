import { describe, expect, it } from 'vitest';
import {
  emptyBalanceReportOcrCandidates,
  extractBalanceReportOcrCandidates,
  mergeBalanceReportOcrCandidates,
  type OcrCandidatePage,
} from '@/import/sbi/balance-report-ocr-candidates';

function line(y: number, entries: Array<[string, number]>) {
  return {
    text: entries.map(([text]) => text).join(' '), confidence: 90,
    bbox: { x0: 0, y0: y, x1: 1_000, y1: y + 15 },
    words: entries.map(([text, x]) => ({ text, confidence: 90, bbox: { x0: x, y0: y, x1: x + 80, y1: y + 15 } })),
  };
}
function page(pageNumber: number, lines: ReturnType<typeof line>[]): OcrCandidatePage {
  return { pageNumber, width: 1_000, height: 1_400, blocks: [{ paragraphs: [{ lines }] }] };
}

describe('SBI balance-report on-device OCR candidates', () => {
  it('never autofills cash or collateral from short OCR labels', () => {
    const candidates = extractBalanceReportOcrCandidates([page(4, [
      line(100, [['預り金', 100], ['0円', 850]]),
      line(130, [['信用取引保証金', 100], ['0円', 850]]),
      line(160, [['信用取引保証金（担保貸株担保金）', 100], ['99,000円', 850]]),
      line(190, [['先物・オプション取引証拠金', 100], ['0円', 850]]),
    ])]);
    expect(candidates.deposits).toEqual([]);
    expect(candidates.collateral).toEqual([]);
  });

  it('extracts domestic acquisition rows and maps parenthesized values to reference fields', () => {
    const candidates = extractBalanceReportOcrCandidates([page(4, [
      line(70, [['国内株式', 100]]),
      line(90, [['銘柄名', 80], ['数量', 560], ['取得価格', 690], ['買付金額', 860]]),
      line(120, [['合成株式会社', 80], ['[1234]', 280], ['2024/01/15', 420], ['100株', 560], ['1,000円', 690], ['100,000円', 860]]),
      line(145, [['(900円)', 690], ['(90,000円)', 860]]),
      line(180, [['テスト工業', 80], ['[5678]', 280], ['2023/02/10', 420], ['200株', 560], ['2,000円', 690], ['400,000円', 860]]),
      line(205, [['(2,100円)', 690], ['(420,000円)', 860]]),
    ])]);
    expect(candidates.domesticStockLots).toEqual([
      expect.objectContaining({ securityCode: '1234', securityName: '合成株式会社', acquisitionDate: '2024-01-15', quantity: '100', acquisitionUnitPrice: '1000', purchaseAmount: '100000', referencePrice: '', evaluationAmount: '', sourcePage: '', sourceRow: '' }),
      expect.objectContaining({ securityCode: '5678', sourcePage: '', sourceRow: '' }),
    ]);
  });

  it('extracts only self-contained fund rows and skips multi-line totals', () => {
    const candidates = extractBalanceReportOcrCandidates([page(5, [
      line(70, [['投資信託', 100]]),
      line(90, [['銘柄名', 80], ['口数', 600], ['参考価格', 740], ['評価額', 890]]),
      line(120, [['合成世界ファンド', 80], ['[901.23]', 320], ['2024/01/10', 470], ['10口', 600]]),
      line(145, [['2024/02/20', 470], ['20口', 600]]),
      line(170, [['銘柄計', 470], ['30口', 600], ['120,000円', 740], ['1,000円', 890]]),
      line(210, [['合成米国ファンド', 80], ['[902.34]', 320], ['2024/03/01', 470], ['40口', 600], ['30,000円', 740], ['2,000円', 890]]),
    ])]);
    expect(candidates.fundBalances).toEqual([
      expect.objectContaining({ securityCode: '902.34', securityName: '合成米国ファンド', units: '40', referencePrice: '30000', referencePriceUnit: '', evaluationAmount: '2000', sourcePage: '', sourceRow: '' }),
    ]);
  });

  it('drops a group when a missed adjacent code would mix two securities', () => {
    const candidates = extractBalanceReportOcrCandidates([page(5, [
      line(70, [['投資信託', 100]]),
      line(90, [['銘柄名', 80], ['口数', 600], ['参考価格', 740], ['評価額', 890]]),
      line(120, [['合成第一ファンド', 80], ['[901.23]', 320]]),
      line(180, [['合成第二ファンド', 80], ['コード不鮮明', 320], ['2024/02/10', 470], ['40口', 600], ['30,000円', 740], ['2,000円', 890]]),
    ])]);
    expect(candidates.fundBalances).toEqual([]);
  });

  it('never combines a later physical line into an incomplete candidate', () => {
    const candidates = extractBalanceReportOcrCandidates([page(5, [
      line(70, [['投資信託', 100]]),
      line(90, [['銘柄名', 80], ['口数', 600], ['参考価格', 740], ['評価額', 890]]),
      line(120, [['合成境界ファンド', 80], ['[901.23]', 320]]),
      line(450, [['30口', 590], ['120,000円', 740], ['1,000円', 890]]),
    ])]);
    expect(candidates.fundBalances).toEqual([]);
  });

  it('rejects low-confidence rows and invalid page geometry', () => {
    const low = line(100, [['合成低信頼ファンド', 80], ['[901.23]', 320], ['30口', 600], ['120,000円', 740], ['1,000円', 890]]);
    low.confidence = 20;
    for (const word of low.words) word.confidence = 20;
    const invalid = page(5, [line(100, [['合成無効ファンド', 80], ['[902.34]', 320], ['40口', 600], ['30,000円', 740], ['2,000円', 890]])]);
    invalid.height = Number.NaN;
    expect(extractBalanceReportOcrCandidates([page(5, [
      line(70, [['投資信託', 100]]),
      line(90, [['銘柄名', 80], ['口数', 600], ['参考価格', 740], ['評価額', 890]]), low]), invalid]).fundBalances).toEqual([]);
  });


  it('rejects rows outside a proven section and expected column header', () => {
    const unrelated = page(2, [
      line(80, [['信用取引', 80]]),
      line(100, [['銘柄名', 80], ['数量', 560], ['取得価格', 690], ['買付金額', 860]]),
      line(130, [['合成建玉', 80], ['[1234]', 280], ['2024/01/15', 420], ['100株', 560], ['1,000円', 690], ['100,000円', 860]]),
    ]);
    const noColumns = page(3, [
      line(80, [['国内株式', 80]]),
      line(130, [['合成株式', 80], ['[1234]', 280], ['2024/01/15', 420], ['100株', 560], ['1,000円', 690], ['100,000円', 860]]),
    ]);
    expect(extractBalanceReportOcrCandidates([unrelated, noColumns]).domesticStockLots).toEqual([]);
  });

  it('rejects low-confidence required words, impossible dates, and malformed boxes', () => {
    const low = line(130, [['合成低信頼株', 80], ['[1234]', 280], ['2024/02/20', 420], ['100株', 560], ['1,000円', 690], ['100,000円', 860]]);
    low.words[1].confidence = 0;
    const badDate = line(160, [['合成無効日株', 80], ['[5678]', 280], ['2024/02/31', 420], ['200株', 560], ['2,000円', 690], ['400,000円', 860]]);
    const badBox = line(190, [['合成無効座標株', 80], ['[9012]', 280], ['2024/03/01', 420], ['300株', 560], ['3,000円', 690], ['900,000円', 860]]);
    badBox.words[3].bbox.x1 = -1;
    const candidates = extractBalanceReportOcrCandidates([page(4, [
      line(70, [['国内株式', 100]]),
      line(90, [['銘柄名', 80], ['数量', 560], ['取得価格', 690], ['買付金額', 860]]),
      low, badDate, badBox,
    ])]);
    expect(candidates.domesticStockLots).toEqual([]);
  });

  it('keeps distinct identical-looking lots by private row position and deduplicates an overlapping batch', () => {
    const first = { _localId: '4:domestic:1000:1234', securityCode: '1234', securityName: '合成株', acquisitionDate: '2024-01-15', quantity: '100', acquisitionUnitPrice: '1000' };
    const second = { ...first, _localId: '4:domestic:2000:1234' };
    const batchA = emptyBalanceReportOcrCandidates(); batchA.domesticStockLots = [first, second];
    const batchB = emptyBalanceReportOcrCandidates(); batchB.domesticStockLots = [{ ...first }];
    expect(mergeBalanceReportOcrCandidates(batchA, batchB).domesticStockLots).toEqual([first, second]);
  });



  it('treats a low-confidence identifying continuation as a hard section boundary', () => {
    const first = line(120, [['第一ファンド', 80], ['[901.23]', 320]]);
    const hiddenSecond = line(160, [['第二ファンド', 80], ['[902.34]', 320], ['40口', 600], ['30,000円', 740], ['2,000円', 890]]);
    hiddenSecond.words[0].confidence = 0;
    hiddenSecond.words[1].confidence = 0;
    const candidates = extractBalanceReportOcrCandidates([page(5, [
      line(70, [['投資信託', 100]]),
      line(90, [['銘柄名', 80], ['口数', 600], ['参考価格', 740], ['評価額', 890]]),
      first, hiddenSecond,
    ])]);
    expect(candidates.fundBalances).toEqual([]);
  });

  it('treats a low-confidence section marker as a boundary instead of carrying stale context', () => {
    const boundary = line(140, [['信用取引', 80]]);
    boundary.words[0].confidence = 0;
    const candidates = extractBalanceReportOcrCandidates([page(4, [
      line(70, [['国内株式', 100]]),
      line(90, [['銘柄名', 80], ['数量', 560], ['取得価格', 690], ['買付金額', 860]]),
      boundary,
      line(170, [['合成信用行', 80], ['[1234]', 280], ['2024/01/15', 420], ['100株', 560], ['1,000円', 690], ['100,000円', 860]]),
    ])]);
    expect(candidates.domesticStockLots).toEqual([]);
  });


  it('treats aggregate line text missing from words as a hard boundary', () => {
    const hiddenBoundary = line(140, [['信用取引', 80]]);
    hiddenBoundary.words = [];
    const hiddenFundIdentity = line(160, [['40口', 600], ['30,000円', 740], ['2,000円', 890]]);
    hiddenFundIdentity.text = '第二ファンド [902.34] 40口 30,000円 2,000円';
    const domestic = extractBalanceReportOcrCandidates([page(4, [
      line(70, [['国内株式', 100]]),
      line(90, [['銘柄名', 80], ['数量', 560], ['取得価格', 690], ['買付金額', 860]]),
      hiddenBoundary,
      line(170, [['合成信用行', 80], ['[1234]', 280], ['2024/01/15', 420], ['100株', 560], ['1,000円', 690], ['100,000円', 860]]),
    ])]);
    const fund = extractBalanceReportOcrCandidates([page(5, [
      line(70, [['投資信託', 100]]),
      line(90, [['銘柄名', 80], ['口数', 600], ['参考価格', 740], ['評価額', 890]]),
      line(120, [['第一ファンド', 80], ['[901.23]', 320]]),
      hiddenFundIdentity,
    ])]);
    expect(domestic.domesticStockLots).toEqual([]);
    expect(fund.fundBalances).toEqual([]);
  });

  it('rejects words whose geometry is outside their containing line', () => {
    const displaced = line(120, [['合成座標株', 80], ['[1234]', 280], ['2024/01/15', 420], ['100株', 560], ['1,000円', 690], ['100,000円', 860]]);
    for (const word of displaced.words) { word.bbox.y0 = 900; word.bbox.y1 = 915; }
    const candidates = extractBalanceReportOcrCandidates([page(4, [
      line(70, [['国内株式', 100]]),
      line(90, [['銘柄名', 80], ['数量', 560], ['取得価格', 690], ['買付金額', 860]]),
      displaced,
    ])]);
    expect(candidates.domesticStockLots).toEqual([]);
  });


  it('rejects a tall line whose identity and values occupy different vertical bands', () => {
    const split = line(120, [['合成縦分離株', 80], ['[1234]', 280], ['2024/01/15', 420], ['100株', 560], ['1,000円', 690], ['100,000円', 860]]);
    split.bbox.y1 = 230;
    for (const word of split.words.slice(3)) { word.bbox.y0 = 200; word.bbox.y1 = 215; }
    const candidates = extractBalanceReportOcrCandidates([page(4, [
      line(70, [['国内株式', 100]]),
      line(90, [['銘柄名', 80], ['数量', 560], ['取得価格', 690], ['買付金額', 860]]),
      split,
    ])]);
    expect(candidates.domesticStockLots).toEqual([]);
  });

  it('rejects physically reversed lines regardless of OCR array order', () => {
    const candidates = extractBalanceReportOcrCandidates([page(5, [
      line(70, [['投資信託', 100]]),
      line(90, [['銘柄名', 80], ['口数', 600], ['参考価格', 740], ['評価額', 890]]),
      line(200, [['第一ファンド', 80], ['[901.23]', 320]]),
      line(120, [['40口', 600], ['30,000円', 740], ['2,000円', 890]]),
    ])]);
    expect(candidates.fundBalances).toEqual([]);
  });

  it('does not treat a bare decimal amount in the code column as a fund code', () => {
    const candidates = extractBalanceReportOcrCandidates([page(5, [
      line(70, [['投資信託', 100]]),
      line(90, [['銘柄名', 80], ['口数', 600], ['参考価格', 740], ['評価額', 890]]),
      line(120, [['合成集計値', 80], ['901.23', 320], ['30口', 600], ['120,000円', 740], ['1,000円', 890]]),
    ])]);
    expect(candidates.fundBalances).toEqual([]);
  });

  it('reports the candidate cap instead of silently treating a truncated merge as complete', () => {
    const first = emptyBalanceReportOcrCandidates();
    first.domesticStockLots = Array.from({ length: 100 }, (_, index) => ({ _localId: `4:domestic:${index}:1234`, securityCode: '1234' }));
    const next = emptyBalanceReportOcrCandidates();
    next.domesticStockLots = [{ _localId: '5:domestic:1:5678', securityCode: '5678' }];
    const merged = mergeBalanceReportOcrCandidates(first, next);
    expect(merged.domesticStockLots).toHaveLength(100);
    expect(merged.limitReached).toBe(true);
  });

  it('drops incomplete or ambiguous rows instead of inventing values', () => {
    const candidates = extractBalanceReportOcrCandidates([page(7, [
      line(70, [['投資信託', 100]]),
      line(90, [['銘柄名', 80], ['口数', 600], ['参考価格', 740], ['評価額', 890]]),
      line(120, [['合成欠損ファンド', 80], ['[901.23]', 320], ['30口', 600], ['1,000円', 890]]),
      line(180, [['国内株式', 100]]),
      line(200, [['銘柄名', 80], ['数量', 560], ['取得価格', 690], ['買付金額', 860]]),
      line(220, [['合成欠損株', 80], ['[1234]', 280], ['100株', 560], ['1,000円', 690]]),
    ])]);
    expect(candidates.fundBalances).toEqual([]);
    expect(candidates.domesticStockLots).toEqual([]);
  });
});
