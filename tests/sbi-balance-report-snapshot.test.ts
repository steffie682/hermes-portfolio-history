import { describe, expect, it } from 'vitest';
import {
  BalanceReportSnapshotValidationError,
  canonicalizeBalanceReportSnapshot,
  fingerprintBalanceReportSnapshot,
} from '@/import/sbi/balance-report-snapshot';

const synthetic = {
  brokerAccountId: '11111111-1111-4111-8111-111111111111',
  statementDate: '2026-07-23',
  confirmedCompleteFromOriginal: true,
  confirmedNoPositions: false,
  positions: [{
    sourcePage: 2,
    sourceRow: 1,
    side: 'buy',
    securityCode: 'A1B2',
    securityName: '  合成テスト銘柄  ',
    quantity: '00042',
    unitPriceYen: '00120.5000',
    openedOn: '2026-07-01',
    dueOn: '2026-12-25',
  }],
};

describe('SBI balance report snapshot domain', () => {
  it('canonicalizes confirmed typed values before fingerprinting', () => {
    const canonical = canonicalizeBalanceReportSnapshot(synthetic);
    expect(canonical.positions[0]).toMatchObject({
      securityName: '合成テスト銘柄',
      quantity: '42',
      unitPriceYen: '120.5',
    });
    expect(canonical.confirmedCompleteFromOriginal).toBeUndefined();
    expect(canonical.confirmedNoPositions).toBeUndefined();
    expect(canonical).not.toHaveProperty('purpose');
  });

  it('accepts only an explicitly confirmed zero-position checkpoint', () => {
    const zero = canonicalizeBalanceReportSnapshot({
      ...synthetic,
      confirmedNoPositions: true,
      positions: [],
    });
    expect(zero.positions).toEqual([]);
    expect(fingerprintBalanceReportSnapshot('synthetic-owner', zero))
      .not.toBe(fingerprintBalanceReportSnapshot(
        'synthetic-owner',
        canonicalizeBalanceReportSnapshot(synthetic),
      ));
  });

  it('produces an owner-scoped stable fingerprint for equivalent spellings', () => {
    const owner = 'synthetic-owner';
    const first = fingerprintBalanceReportSnapshot(owner, canonicalizeBalanceReportSnapshot(synthetic));
    const second = fingerprintBalanceReportSnapshot(owner, canonicalizeBalanceReportSnapshot({
      ...synthetic,
      positions: [{ ...synthetic.positions[0], quantity: '42', unitPriceYen: '120.5' }],
    }));
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toBe(first);
    expect(fingerprintBalanceReportSnapshot('other-owner', canonicalizeBalanceReportSnapshot(synthetic)))
      .not.toBe(first);
  });

  it.each([
    [{ ...synthetic, extra: true }, 'unknown key'],
    [{ ...synthetic, purpose: 'opening' }, 'legacy purpose is an unknown key'],
    [{ ...synthetic, confirmedCompleteFromOriginal: false }, 'confirmation'],
    [{ ...synthetic, confirmedFromOriginal: true }, 'old confirmation is unknown'],
    [{ ...synthetic, statementDate: '2026-02-30' }, 'date'],
    [{ ...synthetic, positions: [] }, 'accidental empty positions'],
    [{ ...synthetic, confirmedNoPositions: true }, 'zero confirmation with positions'],
    [{ ...synthetic, confirmedNoPositions: undefined }, 'required zero confirmation'],
    [{
      ...synthetic,
      positions: [
        synthetic.positions[0],
        { ...synthetic.positions[0], sourceRow: 2 },
      ],
    }, 'economically identical positions with distinct locators are legitimate'],
    [{ ...synthetic, positions: Array.from({ length: 101 }, () => synthetic.positions[0]) }, 'positions'],
    [{ ...synthetic, positions: [{ ...synthetic.positions[0], sourcePage: 0 }] }, 'source page'],
    [{ ...synthetic, positions: [{ ...synthetic.positions[0], sourceRow: 0 }] }, 'source row'],
    [{ ...synthetic, positions: [{ ...synthetic.positions[0], securityCode: 'abc1' }] }, 'security code'],
    [{ ...synthetic, positions: [{ ...synthetic.positions[0], securityName: 'bad\tname' }] }, 'safe text'],
    [{ ...synthetic, positions: [{ ...synthetic.positions[0], securityName: '\tbad name' }] }, 'leading control'],
    [{ ...synthetic, positions: [{ ...synthetic.positions[0], securityName: 'bad\u202ename' }] }, 'safe text'],
    [{ ...synthetic, positions: [{ ...synthetic.positions[0], quantity: '0' }] }, 'quantity'],
    [{ ...synthetic, positions: [{ ...synthetic.positions[0], quantity: '1'.repeat(19) }] }, 'quantity'],
    [{ ...synthetic, positions: [{ ...synthetic.positions[0], unitPriceYen: '1.1234567' }] }, 'unit price'],
    [{ ...synthetic, positions: [{ ...synthetic.positions[0], dueOn: '2026-06-30' }] }, 'due date'],
    [{
      ...synthetic,
      positions: [{
        ...synthetic.positions[0],
        openedOn: '2026-07-24',
        dueOn: '2026-12-25',
      }],
    }, 'opened after statement date'],
    [{
      ...synthetic,
      positions: [{
        ...synthetic.positions[0],
        openedOn: '2026-07-01',
        dueOn: '2026-07-22',
      }],
    }, 'due before statement date'],
  ])('rejects malformed or unsafe input: $1', (input, label) => {
    if (label === 'economically identical positions with distinct locators are legitimate') {
      expect(canonicalizeBalanceReportSnapshot(input).positions).toHaveLength(2);
      return;
    }
    expect(label).toBeTruthy();
    expect(() => canonicalizeBalanceReportSnapshot(input)).toThrow(BalanceReportSnapshotValidationError);
  });

  it('rejects duplicate source page and row locators', () => {
    expect(() => canonicalizeBalanceReportSnapshot({
      ...synthetic,
      positions: [
        synthetic.positions[0],
        { ...synthetic.positions[0], securityCode: 'C3D4' },
      ],
    })).toThrow(BalanceReportSnapshotValidationError);
  });
});
