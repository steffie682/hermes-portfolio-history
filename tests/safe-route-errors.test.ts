import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/auth/runtime', () => ({
  getAuthRuntime: vi.fn().mockRejectedValue(new Error('sensitive database detail')),
}));

import { POST as deleteAccount } from '@/app/api/account/delete/route';
import { GET as listBrokerAccounts } from '@/app/api/broker-accounts/route';

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
});
