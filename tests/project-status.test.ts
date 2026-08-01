import { describe, expect, it } from 'vitest';
import { getProjectStatus } from '@/lib/project-status';

describe('getProjectStatus', () => {
  it('reports implemented evidence features separately from unfinished calculations', () => {
    expect(getProjectStatus()).toEqual({
      stage: 'evidence-overview',
      implementedFeatures: [
        'passkey-authentication',
        'private-sbi-import',
        'append-only-ledger',
        'balance-evidence-overview',
      ],
      unimplementedFeatures: [
        'total-assets',
        'net-contributions',
        'investment-profit-loss',
        'dividend-yoc',
      ],
    });
  });
});
