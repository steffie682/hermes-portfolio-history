/* eslint-disable @typescript-eslint/no-explicit-any -- adversarial mutations intentionally cross the domain boundary */
import { describe, expect, it } from 'vitest';
import {
  FullBalanceReportCheckpointValidationError,
  fingerprintFullBalanceReportCheckpoint,
  validateFullBalanceReportCheckpoint,
} from '@/import/sbi/full-balance-report-checkpoint';

const locator = (sourcePage: number, sourceRow: number) => ({ sourcePage, sourceRow });

const validCheckpoint = {
  brokerAccountId: '22222222-2222-4222-8222-222222222222',
  statementDate: '2025-04-18',
  sourcePageCount: 7,
  allRelevantPagesReviewed: true,
  evidence: { kind: 'generic_as_of', confirmation: 'manual' },
  deposits: {
    evidenceState: 'reported',
    zeroLocator: null,
    rows: [{ kind: 'cash_deposit', amount: '7300', ...locator(1, 1) }],
  },
  collateral: {
    evidenceState: 'reported',
    zeroLocator: null,
    rows: [{ kind: 'margin_guarantee', amount: '4100', ...locator(2, 1) }],
  },
  domesticStockLots: {
    evidenceState: 'reported',
    zeroLocator: null,
    rows: [{
      securityCode: '1357',
      securityName: '合成株式',
      acquisitionDate: '2024-11-12',
      quantity: '8',
      rowKind: 'acquisition_lot',
      acquisitionUnitPriceState: 'reported',
      purchaseAmountState: 'reported',
      acquisitionUnitPrice: '125.25',
      purchaseAmount: '1002',
      referencePrice: '130',
      evaluationAmount: '1040',
      ...locator(3, 1),
    }],
  },
  fundBalances: {
    evidenceState: 'reported',
    zeroLocator: null,
    rows: [{
      securityCode: '246.80',
      securityName: '合成ファンド',
      units: '12.5',
      referencePrice: '80',
      evaluationAmount: '1000',
      referencePriceUnit: '1',
      ...locator(4, 1),
    }],
  },
  margin: {
    evidenceState: 'reported',
    zeroLocator: null,
    rows: [{
      state: 'open',
      securityCode: '3579',
      securityName: '合成信用銘柄',
      repaymentTermLabel: '合成期限',
      designationLabel: null,
      quantity: '6',
      market: 'tokyo',
      side: 'buy',
      contractDate: '2025-03-03',
      contractUnitPrice: '220',
      currentPrice: null,
      fees: null,
      unrealizedPnl: null,
      finalSettlementOrPlannedDate: '2025-09-30',
      ...locator(5, 1),
    }],
  },
  futures: { evidenceState: 'explicit_zero', zeroLocator: locator(6, 1), rows: [] },
  options: { evidenceState: 'explicit_zero', zeroLocator: locator(7, 1), rows: [] },
};

describe('confirmed full SBI balance-report checkpoint', () => {
  it('accepts a complete manually confirmed generic as-of checkpoint', () => {
    expect(validateFullBalanceReportCheckpoint(validCheckpoint)).toEqual(validCheckpoint);
  });

  it('accepts a reviewed section as explicitly unresolved without pretending it is zero', () => {
    const input = structuredClone(validCheckpoint) as any;
    input.margin = { evidenceState: 'missing', zeroLocator: null, rows: [] };
    expect(validateFullBalanceReportCheckpoint(input).margin).toEqual(input.margin);
  });

  it.each([
    ['rows', [{ synthetic: true }]],
    ['zero locator', { sourcePage: 5, sourceRow: 1 }],
  ])('rejects missing evidence with %s', (kind, value) => {
    const input = structuredClone(validCheckpoint) as any;
    input.margin = { evidenceState: 'missing', zeroLocator: null, rows: [] };
    if (kind === 'rows') input.margin.rows = value;
    else input.margin.zeroLocator = value;
    expect(() => validateFullBalanceReportCheckpoint(input))
      .toThrow(FullBalanceReportCheckpointValidationError);
  });

  it('fingerprints canonical evidence deterministically and binds it to its owner', () => {
    const checkpoint = validateFullBalanceReportCheckpoint(validCheckpoint);
    expect(fingerprintFullBalanceReportCheckpoint('synthetic-owner-a', checkpoint))
      .toBe(fingerprintFullBalanceReportCheckpoint('synthetic-owner-a', structuredClone(checkpoint)));
    expect(fingerprintFullBalanceReportCheckpoint('synthetic-owner-a', checkpoint))
      .not.toBe(fingerprintFullBalanceReportCheckpoint('synthetic-owner-b', checkpoint));
    expect(fingerprintFullBalanceReportCheckpoint('synthetic-owner-a', checkpoint))
      .toMatch(/^[0-9a-f]{64}$/);
  });

  it('canonicalizes property ordering recursively while preserving row order', () => {
    const checkpoint = validateFullBalanceReportCheckpoint(validCheckpoint);
    const reverseKeys = (value: any): any => Array.isArray(value)
      ? value.map(reverseKeys)
      : value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)]))
        : value;
    expect(fingerprintFullBalanceReportCheckpoint('synthetic-owner-a', checkpoint))
      .toBe(fingerprintFullBalanceReportCheckpoint(
        'synthetic-owner-a',
        validateFullBalanceReportCheckpoint(reverseKeys(checkpoint)),
      ));
    const twoRows = structuredClone(validCheckpoint);
    twoRows.deposits.rows.push({ ...twoRows.deposits.rows[0], sourceRow: 2, amount: '1' });
    const validated = validateFullBalanceReportCheckpoint(twoRows);
    expect(fingerprintFullBalanceReportCheckpoint('synthetic-owner-a', validated))
      .not.toBe(fingerprintFullBalanceReportCheckpoint('synthetic-owner-a', {
        ...validated,
        deposits: { ...validated.deposits, rows: [...validated.deposits.rows].reverse() },
      }));
  });

  it.each([
    ['unexpected root key', (value: any) => { value.unexpected = true; }],
    ['unexpected nested key', (value: any) => { value.deposits.unexpected = true; }],
    ['OCR evidence', (value: any) => { value.evidence.confirmation = 'ocr_inferred'; }],
    ['ledger evidence', (value: any) => { value.evidence.kind = 'canonical_ledger'; }],
    ['missing all-pages confirmation', (value: any) => { delete value.allRelevantPagesReviewed; }],
    ['all-pages confirmation is false', (value: any) => { value.allRelevantPagesReviewed = false; }],
    ['missing futures evidence', (value: any) => { delete value.futures; }],
    ['reported futures', (value: any) => { value.futures.evidenceState = 'reported'; }],
    ['reported options', (value: any) => { value.options.evidenceState = 'reported'; }],
    ['empty without section confirmation', (value: any) => {
      value.deposits.rows = [];
    }],
    ['zero-confirmed with rows', (value: any) => {
      value.collateral.evidenceState = 'explicit_zero';
    }],
    ['zero-confirmed without locator', (value: any) => {
      value.collateral.rows = [];
      value.collateral.evidenceState = 'explicit_zero';
      value.collateral.zeroLocator = null;
    }],
    ['too many rows', (value: any) => {
      value.fundBalances.rows = Array.from(
        { length: 101 },
        (_, index) => ({ ...value.fundBalances.rows[0], sourceRow: index + 1 }),
      );
    }],
  ])('rejects fail-open structure: %s', (_label, mutate) => {
    const input = structuredClone(validCheckpoint);
    mutate(input);
    expect(() => validateFullBalanceReportCheckpoint(input))
      .toThrow(FullBalanceReportCheckpointValidationError);
  });

  it.each([
    ['invalid account', (value: any) => { value.brokerAccountId = 'not-an-account'; }],
    ['impossible statement date', (value: any) => { value.statementDate = '2025-02-30'; }],
    ['unexpected row key', (value: any) => { value.deposits.rows[0].extra = 'x'; }],
    ['unsafe C0 text', (value: any) => { value.domesticStockLots.rows[0].securityName = 'bad\nname'; }],
    ['unsafe C1 text', (value: any) => { value.margin.rows[0].market = 'bad\u0085market'; }],
    ['unsafe bidi text', (value: any) => { value.fundBalances.rows[0].securityName = 'bad\u2067name'; }],
    ['overlong text', (value: any) => { value.margin.rows[0].securityName = 'あ'.repeat(101); }],
    ['broad security code', (value: any) => { value.margin.rows[0].securityCode = 'ABCD'; }],
    ['bad source page', (value: any) => { value.collateral.rows[0].sourcePage = 0; }],
    ['source page beyond inspected report', (value: any) => { value.collateral.rows[0].sourcePage = 8; }],
    ['zero page beyond inspected report', (value: any) => { value.futures.zeroLocator.sourcePage = 8; }],
    ['unpaired high surrogate', (value: any) => { value.domesticStockLots.rows[0].securityName = 'bad\uD800'; }],
    ['unpaired low surrogate', (value: any) => { value.fundBalances.rows[0].securityName = 'bad\uDC00'; }],
    ['bad source row', (value: any) => { value.collateral.rows[0].sourceRow = 101; }],
    ['noncanonical leading zero', (value: any) => { value.deposits.rows[0].amount = '07300'; }],
    ['noncanonical decimal zero', (value: any) => { value.fundBalances.rows[0].units = '0.0'; }],
    ['excess precision', (value: any) => { value.domesticStockLots.rows[0].quantity = '1.1234567'; }],
    ['negative quantity', (value: any) => { value.margin.rows[0].quantity = '-1'; }],
    ['negative amount', (value: any) => { value.collateral.rows[0].amount = '-1'; }],
    ['excessive amount', (value: any) => { value.deposits.rows[0].amount = '1'.repeat(19); }],
    ['duplicate locator', (value: any) => {
      value.deposits.rows.push({ ...value.deposits.rows[0] });
    }],
    ['cross-section duplicate locator', (value: any) => {
      value.collateral.rows[0].sourcePage = value.deposits.rows[0].sourcePage;
      value.collateral.rows[0].sourceRow = value.deposits.rows[0].sourceRow;
    }],
    ['row and zero duplicate locator', (value: any) => {
      value.futures.zeroLocator = { ...value.deposits.rows[0] };
    }],
    ['zero and zero duplicate locator', (value: any) => {
      value.options.zeroLocator = { ...value.futures.zeroLocator };
    }],
  ])('rejects unsafe or noncanonical values: %s', (_label, mutate) => {
    const input = structuredClone(validCheckpoint);
    mutate(input);
    expect(() => validateFullBalanceReportCheckpoint(input))
      .toThrow(FullBalanceReportCheckpointValidationError);
  });

  it.each([
    ['legacy deposit kind', (value: any) => { value.deposits.rows[0].kind = 'cash'; }],
    ['unknown deposit kind', (value: any) => { value.deposits.rows[0].kind = 'other'; }],
    ['legacy collateral kind', (value: any) => { value.collateral.rows[0].kind = 'guarantee'; }],
    ['unknown collateral kind', (value: any) => { value.collateral.rows[0].kind = 'other'; }],
    ['unknown margin market', (value: any) => { value.margin.rows[0].market = 'domestic'; }],
  ])('rejects unsupported v2 source semantics: %s', (_label, mutate) => {
    const input = structuredClone(validCheckpoint);
    mutate(input);
    expect(() => validateFullBalanceReportCheckpoint(input))
      .toThrow(FullBalanceReportCheckpointValidationError);
  });

  it.each(['tokyo', 'private', 'nagoya', 'fukuoka', 'sapporo'])(
    'accepts supported margin market %s',
    (market) => {
      const input = structuredClone(validCheckpoint);
      input.margin.rows[0].market = market;
      expect(validateFullBalanceReportCheckpoint(input).margin.rows[0].market).toBe(market);
    },
  );

  it('binds the fingerprint to manual review and source-zero locators', () => {
    const checkpoint = validateFullBalanceReportCheckpoint(validCheckpoint);
    const moved = structuredClone(checkpoint);
    moved.futures.zeroLocator.sourceRow += 1;
    expect(fingerprintFullBalanceReportCheckpoint('synthetic-owner-a', checkpoint))
      .not.toBe(fingerprintFullBalanceReportCheckpoint('synthetic-owner-a', moved));
  });

  it.each(['open', 'settled'] as const)(
    'preserves a source final date before the statement independently of %s state',
    (state) => {
      const input = structuredClone(validCheckpoint);
      input.margin.rows[0].state = state;
      input.margin.rows[0].finalSettlementOrPlannedDate = '2025-04-17';
      expect(validateFullBalanceReportCheckpoint(input).margin.rows[0]
        .finalSettlementOrPlannedDate).toBe('2025-04-17');
    },
  );

  it.each([
    [null, null, null],
    ['1', '2', '-3'],
  ])('accepts settled source semantics with nullable reported valuation cells',
    (currentPrice, fees, unrealizedPnl) => {
      const input = structuredClone(validCheckpoint);
      input.margin.rows[0] = {
        ...input.margin.rows[0],
        state: 'settled',
        currentPrice,
        fees,
        unrealizedPnl,
        finalSettlementOrPlannedDate: '2025-04-18',
      } as any;
      expect(validateFullBalanceReportCheckpoint(input).margin.rows[0]).toEqual(input.margin.rows[0]);
    });

  it.each(['masked', 'absent'] as const)(
    'accepts independently unavailable stock values marked %s without guessing',
    (state) => {
    const input = structuredClone(validCheckpoint);
    input.domesticStockLots.rows[0] = {
      ...input.domesticStockLots.rows[0],
      acquisitionUnitPriceState: state,
      acquisitionUnitPrice: null,
    } as any;
    expect(validateFullBalanceReportCheckpoint(input).domesticStockLots.rows[0]).toMatchObject({
      acquisitionUnitPriceState: state,
      acquisitionUnitPrice: null,
    });
  });

  it.each([
    ['reported cost missing its unit price', (value: any) => {
      value.domesticStockLots.rows[0].acquisitionUnitPrice = null;
    }],
    ['masked unit price carrying a value', (value: any) => {
      value.domesticStockLots.rows[0].acquisitionUnitPriceState = 'masked';
    }],
    ['absent purchase amount carrying a value', (value: any) => {
      value.domesticStockLots.rows[0].purchaseAmountState = 'absent';
    }],
    ['reported purchase amount missing its value', (value: any) => {
      value.domesticStockLots.rows[0].purchaseAmount = null;
    }],
    ['legacy combined source state', (value: any) => {
      value.domesticStockLots.rows[0].costValueState = 'reported';
    }],
    ['aggregate stock total row', (value: any) => {
      value.domesticStockLots.rows[0].rowKind = 'aggregate_total';
    }],
  ])('rejects inconsistent source-cost evidence: %s', (_label, mutate) => {
    const input = structuredClone(validCheckpoint);
    mutate(input);
    expect(() => validateFullBalanceReportCheckpoint(input))
      .toThrow(FullBalanceReportCheckpointValidationError);
  });

  it.each([
    ['acquisition after statement', (value: any) => {
      value.domesticStockLots.rows[0].acquisitionDate = '2025-04-19';
    }],
    ['contract after statement', (value: any) => {
      value.margin.rows[0].contractDate = '2025-04-19';
    }],
    ['final settlement before contract', (value: any) => {
      value.margin.rows[0].finalSettlementOrPlannedDate = '2025-03-02';
    }],
    ['open missing final settlement or planned date', (value: any) => {
      value.margin.rows[0].finalSettlementOrPlannedDate = null;
    }],
    ['unknown margin state', (value: any) => {
      value.margin.rows[0].state = 'settled_pending_delivery';
    }],
    ['missing repayment term source label', (value: any) => {
      delete value.margin.rows[0].repaymentTermLabel;
    }],
    ['empty repayment term source label', (value: any) => {
      value.margin.rows[0].repaymentTermLabel = '';
    }],
    ['oversized designation source label', (value: any) => {
      value.margin.rows[0].designationLabel = 'x'.repeat(51);
    }],
    ['settled missing final settlement date', (value: any) => {
      value.margin.rows[0].state = 'settled';
      value.margin.rows[0].finalSettlementOrPlannedDate = null;
    }],
    ['invented fund acquisition date', (value: any) => {
      value.fundBalances.rows[0].acquisitionDate = '2024-01-01';
    }],
    ['invented fund acquisition cost', (value: any) => {
      value.fundBalances.rows[0].acquisitionUnitPrice = '10';
    }],
  ])('rejects semantic inconsistency: %s', (_label, mutate) => {
    const input = structuredClone(validCheckpoint);
    mutate(input);
    expect(() => validateFullBalanceReportCheckpoint(input))
      .toThrow(FullBalanceReportCheckpointValidationError);
  });
});
