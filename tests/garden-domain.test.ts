import { describe, expect, it } from 'vitest';
import { createQuoteProvider } from '@/garden/quotes';
import { calculateGarden, validateGardenState, type GardenLot } from '@/garden/domain';

it('marks aggregate valuation overflow unavailable for max-bounds valid holdings and provider quotes', async () => {
  const lots = [
    { ...lot, shares: '1000000', costPerShare: '50000' },
    { ...lot, id: '00000000-0000-4000-8000-000000000002', shares: '1000000', costPerShare: '50000' },
  ];
  expect(validateGardenState({ revision: 0, lots }).lots).toEqual(lots);
  async function quotesAt(close: number) {
    const provider = createQuoteProvider({
      now: () => new Date('2026-09-04T07:00:00Z'),
      fetcher: async () => new Response(JSON.stringify({ chart: { error: null, result: [{
        meta: { symbol: '123A.T', currency: 'JPY', exchangeTimezoneName: 'Asia/Tokyo', dataGranularity: '1d' },
        timestamp: [Date.parse('2026-09-04T00:00:00Z') / 1000],
        indicators: { quote: [{ close: [close] }] },
      }] } })),
    });
    const result = await provider.getQuotes(['123A']);
    expect(result.failedCodes).toEqual([]);
    return result.quotes;
  }
  const atCap = calculateGarden(lots, await quotesAt(50000));
  expect(atCap.totals.value).toBe(100_000_000_000);
  const quotes = await quotesAt(50000.0001);
  expect(quotes['123A'].close).toBe('50000.0001');
  const result = calculateGarden(lots, quotes);
  expect(result.totals).toMatchObject({
    cost: 100_000_000_000, value: null, pnl: null, pnlPct: null,
    missingQuotes: 0, valuationOverflow: true, annualDividend: 60_000,
  });
  for (const row of result.rows) {
    expect(row.quote).toEqual(quotes['123A']);
    expect(row.value).toBe(50_000_000_100);
    expect(row.pnl).toBe(100);
  }
});

it('keeps an over-bound row valuation unknown without hiding its quote or other bounded rows', () => {
  const lots = [
    { ...lot, shares: '1000000', costPerShare: '99999' },
    { ...lot, id: '00000000-0000-4000-8000-000000000002' },
    { ...lot, id: '00000000-0000-4000-8000-000000000003', code: '9999' },
  ];
  const quote = { code: '123A', close: '1000000', date: '2026-09-04', source: 'Synthetic provider' };
  expect(validateGardenState({ revision: 0, lots }).lots).toEqual(lots);
  const result = calculateGarden(lots, { '123A': quote });
  expect(result.rows[0]).toMatchObject({ quote, value: null, pnl: null, pnlPct: null, currentYield: null, annualDividend: 30000 });
  expect(result.rows[1]).toMatchObject({ quote, value: 3000000 });
  expect(result.rows[2]).toMatchObject({ quote: null, value: null });
  expect(result.totals).toMatchObject({ value: null, pnl: null, pnlPct: null, missingQuotes: 1, valuationOverflow: true });
});

export const lot: GardenLot = {
  id: '00000000-0000-4000-8000-000000000001', code: '123A', name: '合成の花',
  account: 'nisa', shares: '3', costPerShare: '0.10', purchasedOn: null,
  confirmedOn: '2026-09-01', purchaseDps: '0.02', currentDps: '0.03',
  priorYearDps: '0.025', dividendAsOf: '2026-09-01', dividendSource: '手入力・合成', memo: '',
};

describe('garden calculations', () => {
  it('requires dated manual DPS provenance and rejects future dates using JST today', () => {
    const now = new Date('2026-09-01T15:00:00Z'); // JST September 2
    for (const change of [{ confirmedOn: '2026-09-03' }, { purchasedOn: '2026-09-03' }, { dividendAsOf: '2026-09-03' },
      { dividendAsOf: null }, { dividendSource: null }]) {
      expect(() => validateGardenState({ revision: 0, lots: [{ ...lot, ...change }] }, now)).toThrow('Invalid garden');
    }
    expect(validateGardenState({ revision: 0, lots: [{ ...lot, confirmedOn: '2026-09-02' }] }, now).lots[0].confirmedOn).toBe('2026-09-02');
  });
  it('fails closed for malformed calculation inputs, overflow and mismatched quotes', () => {
    expect(() => calculateGarden([{ ...lot, costPerShare: '1e2' }], {})).toThrow('Invalid garden');
    expect(() => validateGardenState({ revision: 0, lots: [{ ...lot, shares: '1000000', costPerShare: '1000000' }] })).toThrow('Invalid garden');
    for (const invalid of [{ code: '9999', close: '1', date: '2026-09-01', source: 'Synthetic' },
      { code: '123A', close: '-1', date: '2026-09-01', source: 'Synthetic' },
      { code: '123A', close: '1', date: '2026-02-30', source: 'Synthetic' }]) {
      expect(calculateGarden([lot], { '123A': invalid }).totals.value).toBeNull();
    }
  });
  it('never claims complete totals with missing data or an empty portfolio', () => {
    const second = { ...lot, id: '00000000-0000-4000-8000-000000000002', code: '9999', currentDps: null };
    const result = calculateGarden([lot, second], { '123A': { code: '123A', close: '0.30', date: '2026-09-01', source: 'Synthetic' } });
    expect(result.rows[0].value).toBe(0.9);
    expect(result.totals).toMatchObject({ cost: 0.6, value: null, pnl: null, annualDividend: null, yieldOnCost: null, missingQuotes: 1, missingDividends: 1 });
    expect(calculateGarden([], {}).totals).toMatchObject({ cost: 0, value: null, pnl: null, annualDividend: null });
    expect(calculateGarden([{ ...lot, costPerShare: '0', currentDps: '0', purchaseDps: '0', priorYearDps: null }], {}).rows[0])
      .toMatchObject({ annualDividend: 0, yieldOnCost: null, dividendGrowth: null, yearDividendGrowth: null });
  });

  it('validates exact bounded state without repairing malformed financial values', () => {
    expect(validateGardenState({ revision: 0, lots: [lot] })).toEqual({ revision: 0, lots: [lot] });
    for (const field of ['costPerShare', 'purchaseDps', 'currentDps', 'priorYearDps']) {
      for (const invalid of ['', ' 1', '01', '1e2', '-1', 'NaN', 'Infinity', '1,000', '1.00001', '1000000.0001', 1]) {
        expect(() => validateGardenState({ revision: 0, lots: [{ ...lot, [field]: invalid }] }), `${field}:${invalid}`).toThrow('Invalid garden');
      }
    }
    for (const change of [
      { shares: '0' }, { shares: '1.5' }, { shares: '1000001' }, { costPerShare: null },
      { purchasedOn: '2026-02-30' }, { confirmedOn: null }, { dividendAsOf: '2026-13-01' },
      { purchasedOn: '2026-09-02' }, { code: '12A3' }, { code: '123B' }, { id: 'not-uuid' },
      { memo: 'x'.repeat(1001) }, { name: 'bad\u202e' }, { ownerUserId: 'victim' }, { account: 'margin' },
    ]) expect(() => validateGardenState({ revision: 0, lots: [{ ...lot, ...change }] })).toThrow('Invalid garden');
    for (const state of [null, {}, { revision: -1, lots: [] }, { revision: 1.5, lots: [] },
      { revision: 2147483647, lots: [] }, { revision: 0, lots: [lot, lot] },
      { revision: 0, lots: Array(201).fill(lot) }, { revision: 0, lots: [], ownerUserId: 'victim' }]) {
      expect(() => validateGardenState(state)).toThrow('Invalid garden');
    }
  });

  it('computes decimal JPY and DPS-based growth without floating-point accumulation', () => {
    const result = calculateGarden([lot], { '123A': { code: '123A', close: '0.30', date: '2026-09-01', source: 'Synthetic' } });
    expect(result.rows[0]).toEqual({ lot, quote: { code: '123A', close: '0.30', date: '2026-09-01', source: 'Synthetic' },
      cost: 0.3, value: 0.9, pnl: 0.6, pnlPct: 200, annualDividend: 0.09,
      yieldOnCost: 30, currentYield: 10, dividendGrowth: 50, yearDividendGrowth: 20 });
    expect(result.totals).toEqual({ cost: 0.3, value: 0.9, pnl: 0.6, pnlPct: 200,
      annualDividend: 0.09, yieldOnCost: 30, missingQuotes: 0, missingDividends: 0 });
  });
});
