import { describe, expect, it } from 'vitest';
import { importReasonLabel } from '@/import/reason-label';

describe('safe import reason labels', () => {
  it('maps persisted reason codes to actionable Japanese without exposing raw internals', () => {
    expect(importReasonLabel('missing-transaction-type')).toBe('取引種類が空欄です');
    expect(importReasonLabel('missing-security-name')).toBe('銘柄名が空欄です');
    expect(importReasonLabel('future-internal-code')).toBe('自動判定できないため確認が必要です');
  });
});
