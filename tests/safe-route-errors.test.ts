import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/auth/runtime', () => ({
  getAuthRuntime: vi.fn().mockRejectedValue(new Error('sensitive database detail')),
}));

import { POST as deleteAccount } from '@/app/api/account/delete/route';
import { GET as listBrokerAccounts } from '@/app/api/broker-accounts/route';
import { POST as saveBalanceReportSnapshot } from '@/app/api/imports/sbi/balance-report-snapshots/route';

describe('safe route error responses', () => {
  it('does not expose internal authentication or database errors', async () => {
    for (const response of [
      await deleteAccount(
        new NextRequest('https://app.example.com/api/account/delete', {
          method: 'POST',
        }),
      ),
      await listBrokerAccounts(
        new NextRequest('https://app.example.com/api/broker-accounts'),
      ),
    ]) {
      expect(response.status).toBe(500);
      expect(await response.text()).toBe('{"error":"Operation failed"}');
    }
  });

  it('maps balance report snapshot route setup failures to an unavailable response', async () => {
    const response = await saveBalanceReportSnapshot(
      new NextRequest('https://app.example.com/api/imports/sbi/balance-report-snapshots', {
        method: 'POST',
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: 'snapshot_unavailable' } });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
