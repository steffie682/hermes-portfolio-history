import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { createImportHandlers } from '@/import/http';

const accountId = '00000000-0000-4000-8000-000000000001';

function request(body = new Uint8Array([1, 2, 3]), headers: Record<string, string> = {}) {
  return new NextRequest('https://portfolio.example/api/imports/sbi', {
    method: 'POST',
    headers: {
      origin: 'https://portfolio.example',
      cookie: 'portfolio_session=session-token',
      'content-type': 'text/csv',
      'x-broker-account-id': accountId,
      ...headers,
    },
    body,
  });
}

describe('import HTTP handlers', () => {
  it('authenticates and stages a bounded raw CSV request without caching', async () => {
    const stageSbiTradeHistory = vi.fn().mockResolvedValue({
      batchId: 'batch-a',
      disposition: 'new',
      counts: { new: 1, duplicate: 0, needsReview: 0, rejected: 0 },
    });
    const handlers = createImportHandlers({
      expectedOrigin: 'https://portfolio.example',
      sessionStore: { findActiveUserByTokenHash: async () => 'user-a' },
      importRepository: { stageSbiTradeHistory, commitBatch: vi.fn() },
    });

    const response = await handlers.stage(request());

    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toMatchObject({ batchId: 'batch-a' });
    expect(stageSbiTradeHistory).toHaveBeenCalledWith(expect.objectContaining({
      brokerAccountId: accountId,
      mediaType: 'text/csv',
    }));
    expect(Array.from(stageSbiTradeHistory.mock.calls[0][0].bytes)).toEqual([1, 2, 3]);
  });

  it('rejects an oversized declared body before invoking the repository', async () => {
    const stageSbiTradeHistory = vi.fn();
    const handlers = createImportHandlers({
      expectedOrigin: 'https://portfolio.example',
      sessionStore: { findActiveUserByTokenHash: async () => 'user-a' },
      importRepository: { stageSbiTradeHistory, commitBatch: vi.fn() },
    });

    const response = await handlers.stage(request(new Uint8Array([1]), {
      'content-length': String(10 * 1024 * 1024 + 1),
    }));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: { code: 'file_too_large' } });
    expect(stageSbiTradeHistory).not.toHaveBeenCalled();
  });

  it('returns stable safe codes for session, media, validation, and storage failures', async () => {
    const repository = { stageSbiTradeHistory: vi.fn(), commitBatch: vi.fn() };
    const unauthenticated = createImportHandlers({
      expectedOrigin: 'https://portfolio.example',
      sessionStore: { findActiveUserByTokenHash: async () => null },
      importRepository: repository,
    });
    const expired = await unauthenticated.stage(request());
    expect(expired.status).toBe(401);
    await expect(expired.json()).resolves.toEqual({ error: { code: 'session_expired' } });

    const handlers = createImportHandlers({
      expectedOrigin: 'https://portfolio.example',
      sessionStore: { findActiveUserByTokenHash: async () => 'user-a' },
      importRepository: repository,
    });
    repository.stageSbiTradeHistory.mockResolvedValueOnce({
      batchId: 'batch-csv',
      disposition: 'new',
      counts: { new: 1, duplicate: 0, needsReview: 0, rejected: 0 },
    });
    const applicationCsv = await handlers.stage(request(new Uint8Array([1]), { 'content-type': 'application/csv' }));
    expect(applicationCsv.status).toBe(201);

    const media = await handlers.stage(request(new Uint8Array([1]), { 'content-type': 'application/pdf' }));
    expect(media.status).toBe(415);
    await expect(media.json()).resolves.toEqual({ error: { code: 'unsupported_file_type' } });

    repository.stageSbiTradeHistory.mockRejectedValueOnce(new Error('SBI約定履歴CSVに対応する14列の見出しがありません'));
    const invalid = await handlers.stage(request());
    expect(invalid.status).toBe(422);
    await expect(invalid.json()).resolves.toEqual({ error: { code: 'invalid_file' } });

    repository.stageSbiTradeHistory.mockRejectedValueOnce(new Error('blob unavailable'));
    const unavailable = await handlers.stage(request());
    expect(unavailable.status).toBe(503);
    await expect(unavailable.json()).resolves.toEqual({ error: { code: 'storage_unavailable' } });
  });

});
