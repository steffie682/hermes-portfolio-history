import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { createImportHandlers } from '@/import/http';
import { CommitBatchError } from '@/import/repository';

const accountId = '00000000-0000-4000-8000-000000000001';
const batchId = '10000000-0000-4000-8000-000000000001';

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
  it('maps unresolved distribution details to a stable 409 response', async () => {
    const commitBatch = vi.fn().mockRejectedValue(
      new CommitBatchError('distribution_details_required'),
    );
    const handlers = createImportHandlers({
      expectedOrigin: 'https://portfolio.example',
      sessionStore: { findActiveUserByTokenHash: async () => 'user-a' },
      importRepository: {
        stageSbiTradeHistory: vi.fn(),
        commitBatch,
        resolveDistributionDetails: vi.fn(),
      },
    });

    const response = await handlers.commit(request(undefined, {
      'content-type': 'application/json',
    }), batchId);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'distribution_details_required' },
    });
    expect(commitBatch).toHaveBeenCalledOnce();
  });

  it('authenticates and stages a bounded raw CSV request without caching', async () => {
    const stageSbiTradeHistory = vi.fn().mockResolvedValue({
      batchId: 'batch-a',
      disposition: 'new',
      counts: { new: 1, duplicate: 0, needsReview: 0, rejected: 0 },
    });
    const handlers = createImportHandlers({
      expectedOrigin: 'https://portfolio.example',
      sessionStore: { findActiveUserByTokenHash: async () => 'user-a' },
      importRepository: { stageSbiTradeHistory, commitBatch: vi.fn(), resolveDistributionDetails: vi.fn() },
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
      importRepository: { stageSbiTradeHistory, commitBatch: vi.fn(), resolveDistributionDetails: vi.fn() },
    });

    const response = await handlers.stage(request(new Uint8Array([1]), {
      'content-length': String(10 * 1024 * 1024 + 1),
    }));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: { code: 'file_too_large' } });
    expect(stageSbiTradeHistory).not.toHaveBeenCalled();
  });

  it('returns stable safe codes for session, media, validation, and storage failures', async () => {
    const repository = {
      stageSbiTradeHistory: vi.fn(),
      commitBatch: vi.fn(),
      resolveDistributionDetails: vi.fn(),
    };
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

  it('authenticates, strictly parses, and resolves bounded distribution details', async () => {
    const resolveDistributionDetails = vi.fn().mockResolvedValue({
      batchId,
      sourceRowNumber: 2,
      status: 'new',
    });
    const handlers = createImportHandlers({
      expectedOrigin: 'https://portfolio.example',
      sessionStore: { findActiveUserByTokenHash: async () => 'user-a' },
      importRepository: {
        stageSbiTradeHistory: vi.fn(),
        commitBatch: vi.fn(),
        resolveDistributionDetails,
      },
    });
    const body = {
      sourceRowNumber: 2,
      distributionType: 'ordinary-distribution',
      reinvestmentDate: '2026-07-11',
      individualPrincipalPerTenThousand: '10,000.50',
      reinvestmentAmountYen: '1,234',
      navPerTenThousand: '10,500',
      reinvestmentQuantity: '12.340',
      postReinvestmentBalance: '112.34',
    };
    const response = await handlers.resolveDistributionDetails(new NextRequest(
      `https://portfolio.example/api/imports/${batchId}/distribution-details`,
      {
        method: 'POST',
        headers: {
          origin: 'https://portfolio.example',
          cookie: 'portfolio_session=session-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    ), batchId);

    expect(response.status).toBe(200);
    expect(resolveDistributionDetails).toHaveBeenCalledWith({
      principal: expect.any(Object),
      batchId,
      details: expect.objectContaining({
        individualPrincipalPerTenThousand: '10000.5',
        reinvestmentAmountYen: '1234',
        reinvestmentQuantity: '12.34',
      }),
    });
  });

  it.each([
    ['cross origin', { origin: 'https://evil.example' }, batchId, '{}', 403, 'invalid_request'],
    ['wrong content type', { 'content-type': 'text/plain' }, batchId, '{}', 415, 'invalid_request'],
    ['invalid UUID', {}, 'bad', '{}', 400, 'invalid_request'],
    ['invalid body', {}, batchId, '{"ownerUserId":"user-b"}', 400, 'invalid_request'],
  ])('rejects distribution details for %s with a safe response', async (
    _name, headers, targetBatch, body, status, code,
  ) => {
    const resolveDistributionDetails = vi.fn();
    const handlers = createImportHandlers({
      expectedOrigin: 'https://portfolio.example',
      sessionStore: { findActiveUserByTokenHash: async () => 'user-a' },
      importRepository: {
        stageSbiTradeHistory: vi.fn(),
        commitBatch: vi.fn(),
        resolveDistributionDetails,
      },
    });
    const response = await handlers.resolveDistributionDetails(new NextRequest(
      `https://portfolio.example/api/imports/${targetBatch}/distribution-details`,
      {
        method: 'POST',
        headers: {
          origin: 'https://portfolio.example',
          cookie: 'portfolio_session=session-token',
          'content-type': 'application/json',
          ...headers,
        },
        body,
      },
    ), targetBatch);
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: { code } });
    expect(resolveDistributionDetails).not.toHaveBeenCalled();
  });

  it('rejects a chunked distribution body after crossing 8 KiB', async () => {
    const resolveDistributionDetails = vi.fn();
    const handlers = createImportHandlers({
      expectedOrigin: 'https://portfolio.example',
      sessionStore: { findActiveUserByTokenHash: async () => 'user-a' },
      importRepository: {
        stageSbiTradeHistory: vi.fn(),
        commitBatch: vi.fn(),
        resolveDistributionDetails,
      },
    });
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(5000));
        controller.enqueue(new Uint8Array(5000));
        controller.close();
      },
    });
    const response = await handlers.resolveDistributionDetails(new NextRequest(
      `https://portfolio.example/api/imports/${batchId}/distribution-details`,
      {
        method: 'POST',
        duplex: 'half',
        headers: {
          origin: 'https://portfolio.example',
          cookie: 'portfolio_session=session-token',
          'content-type': 'application/json',
        },
        body: stream,
      },
    ), batchId);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: { code: 'invalid_request' } });
    expect(resolveDistributionDetails).not.toHaveBeenCalled();
  });

});
