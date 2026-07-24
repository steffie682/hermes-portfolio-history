import { SESSION_COOKIE } from '@/auth/cookies';
import { hasExpectedOrigin } from '@/auth/request-origin';
import { resolveSessionPrincipal, type SessionStore } from '@/auth/session';
import type { NextRequest } from 'next/server';
import {
  BalanceReportSnapshotValidationError,
  canonicalizeBalanceReportSnapshot,
  type CanonicalBalanceReportSnapshot,
} from './balance-report-snapshot';
import { BalanceReportSnapshotRepositoryError } from './balance-report-snapshot-repository';

const MAX_SNAPSHOT_BYTES = 128 * 1024;

type SaveResult = {
  created: boolean;
  snapshot: {
    id: string;
    statementDate: string;
    positionCount: number;
  };
};

type Repository = {
  save(principal: NonNullable<Awaited<ReturnType<typeof resolveSessionPrincipal>>>,
    input: CanonicalBalanceReportSnapshot): Promise<SaveResult>;
};

function response(code: string, status: number) {
  return Response.json(
    { error: { code } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

async function readSnapshotJson(request: Request): Promise<unknown> {
  const declared = request.headers.get('content-length');
  if (declared !== null) {
    if (!/^\d+$/.test(declared)) throw new BalanceReportSnapshotValidationError();
    const size = Number(declared);
    if (!Number.isSafeInteger(size) || size > MAX_SNAPSHOT_BYTES) {
      throw new BalanceReportSnapshotValidationError();
    }
  }

  if (!request.body) throw new BalanceReportSnapshotValidationError();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_SNAPSHOT_BYTES) {
      await reader.cancel();
      throw new BalanceReportSnapshotValidationError();
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return JSON.parse(text) as unknown;
}

export function createBalanceReportSnapshotHandlers(input: {
  expectedOrigin: string;
  sessionStore: SessionStore;
  repository: Repository;
}) {
  return {
    async POST(request: NextRequest) {
      if (!hasExpectedOrigin(request, input.expectedOrigin)) return response('invalid_origin', 403);
      const principal = await resolveSessionPrincipal(
        request.cookies.get(SESSION_COOKIE)?.value,
        input.sessionStore,
      );
      if (!principal) return response('session_expired', 401);

      const mediaType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
      if (mediaType !== 'application/json') return response('invalid_snapshot', 400);

      let snapshot: CanonicalBalanceReportSnapshot;
      try {
        snapshot = canonicalizeBalanceReportSnapshot(await readSnapshotJson(request));
      } catch {
        return response('invalid_snapshot', 400);
      }

      try {
        const result = await input.repository.save(principal, snapshot);
        return Response.json(
          {
            snapshot: {
              id: result.snapshot.id,
              statementDate: result.snapshot.statementDate,
              positionCount: result.snapshot.positionCount,
            },
          },
          {
            status: result.created ? 201 : 200,
            headers: { 'Cache-Control': 'no-store' },
          },
        );
      } catch (error) {
        if (error instanceof BalanceReportSnapshotRepositoryError
          && error.code === 'invalid_account') return response('invalid_account', 404);
        return response('snapshot_unavailable', 503);
      }
    },
  };
}
