import { SESSION_COOKIE } from '@/auth/cookies';
import { hasExpectedOrigin } from '@/auth/request-origin';
import { resolveSessionPrincipal, type SessionStore } from '@/auth/session';
import type { NextRequest } from 'next/server';
import {
  FullBalanceReportCheckpointValidationError,
  validateFullBalanceReportCheckpoint,
  type FullBalanceReportCheckpoint,
} from './full-balance-report-checkpoint';
import { FullBalanceReportCheckpointRepositoryError } from './full-balance-report-checkpoint-repository';

export const MAX_FULL_BALANCE_REPORT_CHECKPOINT_BYTES = 256 * 1024;
class PayloadTooLargeError extends Error {}
type SaveResult = {
  created: boolean;
  checkpoint: { id: string; statementDate: string; rowCount: number };
};
type Repository = {
  save(
    principal: NonNullable<Awaited<ReturnType<typeof resolveSessionPrincipal>>>,
    checkpoint: FullBalanceReportCheckpoint,
  ): Promise<SaveResult>;
};

function errorResponse(code: string, status: number) {
  return Response.json({ error: { code } }, {
    status, headers: { 'Cache-Control': 'no-store, private' },
  });
}

async function readJson(request: Request): Promise<unknown> {
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared)
    || Number(declared) > MAX_FULL_BALANCE_REPORT_CHECKPOINT_BYTES)) {
    if (/^\d+$/.test(declared)) throw new PayloadTooLargeError();
    throw new FullBalanceReportCheckpointValidationError();
  }
  if (!request.body) throw new FullBalanceReportCheckpointValidationError();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_FULL_BALANCE_REPORT_CHECKPOINT_BYTES) {
      await reader.cancel();
      throw new PayloadTooLargeError();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
}

export function createFullBalanceReportCheckpointHandlers(input: {
  expectedOrigin: string; sessionStore: SessionStore; repository: Repository;
}) {
  return {
    async POST(request: NextRequest) {
      if (!hasExpectedOrigin(request, input.expectedOrigin)) return errorResponse('invalid_origin', 403);
      const principal = await resolveSessionPrincipal(
        request.cookies.get(SESSION_COOKIE)?.value, input.sessionStore,
      );
      if (!principal) return errorResponse('session_expired', 401);
      if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
        !== 'application/json') return errorResponse('unsupported_media_type', 415);
      let checkpoint: FullBalanceReportCheckpoint;
      try {
        checkpoint = validateFullBalanceReportCheckpoint(await readJson(request));
      } catch (error) {
        if (error instanceof PayloadTooLargeError) return errorResponse('payload_too_large', 413);
        return errorResponse('invalid_checkpoint', 400);
      }
      try {
        const result = await input.repository.save(principal, checkpoint);
        return Response.json({ checkpoint: result.checkpoint }, {
          status: result.created ? 201 : 200,
          headers: { 'Cache-Control': 'no-store, private' },
        });
      } catch (error) {
        if (error instanceof FullBalanceReportCheckpointRepositoryError
          && error.code === 'invalid_account') return errorResponse('invalid_account', 404);
        return errorResponse('checkpoint_unavailable', 503);
      }
    },
  };
}
