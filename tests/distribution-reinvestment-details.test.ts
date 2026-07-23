import { describe, expect, it } from 'vitest';
import {
  compareCanonicalDecimals,
  parseDistributionReinvestmentDetails,
} from '@/import/sbi/distribution-reinvestment-details';

const valid = {
  sourceRowNumber: 2,
  distributionType: 'ordinary-distribution',
  reinvestmentDate: '2026-07-11',
  individualPrincipalPerTenThousand: ' 10,000.5000 ',
  reinvestmentAmountYen: '1,234',
  navPerTenThousand: '10,500.00',
  reinvestmentQuantity: '12.3400',
  postReinvestmentBalance: '112.34',
};

describe('distribution reinvestment manual details', () => {
  it('strictly parses the allowlisted shape and returns canonical decimals', () => {
    expect(parseDistributionReinvestmentDetails(valid)).toEqual({
      sourceRowNumber: 2,
      distributionType: 'ordinary-distribution',
      reinvestmentDate: '2026-07-11',
      individualPrincipalPerTenThousand: '10000.5',
      reinvestmentAmountYen: '1234',
      navPerTenThousand: '10500',
      reinvestmentQuantity: '12.34',
      postReinvestmentBalance: '112.34',
    });
  });

  it.each([
    [{ ...valid, sourceRowNumber: 0 }],
    [{ ...valid, distributionType: 'special-distribution' }],
    [{ ...valid, reinvestmentDate: '2026-02-30' }],
    [{ ...valid, navPerTenThousand: '12,34' }],
    [{ ...valid, navPerTenThousand: '+100' }],
    [{ ...valid, navPerTenThousand: '1e3' }],
    [{ ...valid, navPerTenThousand: '100円' }],
    [{ ...valid, navPerTenThousand: `10\u202e00` }],
    [{ ...valid, navPerTenThousand: `10\u008500` }],
    [{ ...valid, reinvestmentAmountYen: '1.5' }],
    [{ ...valid, reinvestmentQuantity: '0' }],
    [{ ...valid, postReinvestmentBalance: '12.339' }],
    [{ ...valid, fundName: 'not accepted' }],
    [{ ...valid, navPerTenThousand: '1'.repeat(65) }],
  ])('rejects malformed, unsafe, out-of-bound, or non-allowlisted input %#', (input) => {
    expect(() => parseDistributionReinvestmentDetails(input)).toThrow('invalid-distribution-details');
  });

  it('rejects an object whose JSON representation exceeds 8 KiB', () => {
    expect(() => parseDistributionReinvestmentDetails({
      ...valid,
      ignored: 'x'.repeat(8192),
    })).toThrow('invalid-distribution-details');
  });

  it('compares canonical decimal values exactly without binary floating point', () => {
    expect(compareCanonicalDecimals('10000000000000000000.0001', '10000000000000000000.0001')).toBe(0);
    expect(compareCanonicalDecimals('9999999999999999999.9999', '10000000000000000000')).toBe(-1);
    expect(compareCanonicalDecimals('12.340', '12.34')).toBe(0);
  });
});
