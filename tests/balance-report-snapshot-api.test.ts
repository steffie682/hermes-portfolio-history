import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import type { SessionStore } from '@/auth/session';
import { createBalanceReportSnapshotHandlers } from '@/import/sbi/balance-report-snapshot-http';
import { BalanceReportSnapshotRepositoryError } from '@/import/sbi/balance-report-snapshot-repository';

const body = {
  brokerAccountId: '11111111-1111-4111-8111-111111111111',
  statementDate: '2026-07-23',
  confirmedFromOriginal: true,
  confirmedNoPositions: false,
  positions: [{
    sourcePage: 1, side: 'buy', securityCode: 'T3S7', securityName: '合成銘柄',
    quantity: '2', unitPriceYen: '99.5', openedOn: '2026-07-01', dueOn: null,
  }],
};

function request(payload: unknown = body, options: {
  origin?: string;
  cookie?: boolean;
  contentType?: string;
  contentLength?: string;
  rawBody?: BodyInit;
} = {}) {
  return new NextRequest('https://portfolio.example/api/imports/sbi/balance-report-snapshots', {
    method: 'POST',
    headers: {
      'content-type': options.contentType ?? 'application/json',
      ...(options.contentLength === undefined ? {} : { 'content-length': options.contentLength }),
      ...(options.cookie === false ? {} : { cookie: 'portfolio_session=synthetic-token' }),
      ...(options.origin === undefined
        ? { origin: 'https://portfolio.example' }
        : { origin: options.origin }),
    },
    body: options.rawBody ?? JSON.stringify(payload),
  });
}

function setup(active = true) {
  const sessionStore: SessionStore = {
    findActiveUserByTokenHash: vi.fn().mockResolvedValue(active ? 'synthetic-user' : null),
  };
  const repository = {
    save: vi.fn().mockResolvedValue({
      created: true,
      snapshot: {
        id: '22222222-2222-4222-8222-222222222222',
        brokerAccountId: body.brokerAccountId,
        statementDate: body.statementDate,
        status: 'confirmed',
        positionCount: 1,
        createdAt: new Date('2026-07-24T00:00:00Z'),
      },
    }),
  };
  return {
    sessionStore,
    repository,
    handler: createBalanceReportSnapshotHandlers({
      expectedOrigin: 'https://portfolio.example',
      sessionStore,
      repository,
    }),
  };
}

describe('balance report snapshot API', () => {
  it('returns session_expired without an active authenticated session', async () => {
    const { handler } = setup(false);
    const response = await handler.POST(request(body, { cookie: false }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: 'session_expired' } });
  });

  it('requires the exact configured Origin before session lookup', async () => {
    const { handler, repository, sessionStore } = setup(false);
    const response = await handler.POST(request(body, {
      origin: 'https://evil.example',
      cookie: false,
    }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: 'invalid_origin' } });
    expect(sessionStore.findActiveUserByTokenHash).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('requires application/json', async () => {
    const { handler, repository } = setup();
    const response = await handler.POST(request(body, { contentType: 'text/plain' }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: 'invalid_snapshot' } });
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('rejects bodies larger than 128 KiB even without a declared length', async () => {
    const { handler, repository } = setup();
    const response = await handler.POST(request(body, {
      rawBody: `${JSON.stringify(body)}${' '.repeat(128 * 1024)}`,
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: 'invalid_snapshot' } });
    expect(repository.save).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed declared size', { contentLength: 'not-a-size' }],
    ['non-decimal declared size', { contentLength: '1e3' }],
    ['oversized declared size', { contentLength: String(128 * 1024 + 1) }],
    ['malformed JSON', { rawBody: '{"brokerAccountId":' }],
    ['invalid UTF-8', { rawBody: new Uint8Array([0xc3, 0x28]) }],
  ])('returns the stable private error for %s', async (_name, options) => {
    const { handler, repository } = setup();
    const response = await handler.POST(request(body, options));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: 'invalid_snapshot' } });
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('rejects invalid shape and any client-supplied owner', async () => {
    const { handler, repository } = setup();
    const response = await handler.POST(request({ ...body, ownerUserId: 'attacker' }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: 'invalid_snapshot' } });
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('rejects the legacy purpose field as unknown input', async () => {
    const { handler, repository } = setup();
    const response = await handler.POST(request({ ...body, purpose: 'opening' }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: 'invalid_snapshot' } });
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('maps an unavailable account to a private 404', async () => {
    const { handler, repository } = setup();
    repository.save.mockRejectedValueOnce(
      new BalanceReportSnapshotRepositoryError('invalid_account'),
    );
    const response = await handler.POST(request());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: 'invalid_account' } });
  });

  it('maps unexpected repository failures to a retryable unavailable response', async () => {
    const { handler, repository } = setup();
    repository.save.mockRejectedValueOnce(new Error('sensitive database detail'));
    const response = await handler.POST(request());
    const bodyText = await response.clone().text();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: 'snapshot_unavailable' } });
    expect(bodyText).not.toContain('sensitive database detail');
  });

  it('does not treat an untyped invalid_account-shaped failure as a private 404', async () => {
    const { handler, repository } = setup();
    repository.save.mockRejectedValueOnce({ code: 'invalid_account' });
    const response = await handler.POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: 'snapshot_unavailable' } });
  });

  it('returns 201 for a new snapshot and 200 for exact replay without owner IDs', async () => {
    const { handler, repository } = setup();
    const created = await handler.POST(request());
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(JSON.stringify(createdBody)).not.toContain('owner');
    expect(createdBody).not.toHaveProperty('snapshot.purpose');
    expect(repository.save.mock.calls[0][1]).not.toHaveProperty('confirmedFromOriginal');
    expect(repository.save.mock.calls[0][1]).not.toHaveProperty('confirmedNoPositions');
    expect(repository.save.mock.calls[0][1]).not.toHaveProperty('purpose');

    repository.save.mockResolvedValueOnce({
      created: false,
      snapshot: {
        id: '22222222-2222-4222-8222-222222222222',
        brokerAccountId: body.brokerAccountId,
        statementDate: body.statementDate,
        status: 'confirmed',
        positionCount: 1,
        createdAt: new Date('2026-07-24T00:00:00Z'),
      },
    });
    const replay = await handler.POST(request());
    expect(replay.status).toBe(200);
  });

  it('passes an explicitly confirmed zero-position checkpoint to the repository', async () => {
    const { handler, repository } = setup();
    const response = await handler.POST(request({
      ...body,
      confirmedNoPositions: true,
      positions: [],
    }));
    expect(response.status).toBe(201);
    expect(repository.save.mock.calls[0][1]).toMatchObject({ positions: [] });
  });
});
