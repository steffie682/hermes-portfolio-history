import { SESSION_COOKIE } from '@/auth/cookies';
import { hasExpectedOrigin } from '@/auth/request-origin';
import {
  resolveSessionPrincipal,
  type AuthenticatedPrincipal,
  type SessionStore,
} from '@/auth/session';
import type { NextRequest } from 'next/server';
import { MAX_SBI_SOURCE_BYTES } from './source-file-intake';

interface ImportRepository {
  stageSbiTradeHistory(input: {
    principal: AuthenticatedPrincipal;
    brokerAccountId: string;
    mediaType: string;
    bytes: Uint8Array;
  }): Promise<{
    batchId: string;
    disposition: 'new' | 'duplicate';
    counts: { new: number; duplicate: number; needsReview: number; rejected: number };
  }>;
  commitBatch(input: {
    principal: AuthenticatedPrincipal;
    batchId: string;
  }): Promise<{ batchId: string; status: 'committed'; committed: number }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ImportErrorCode =
  | 'invalid_request'
  | 'session_expired'
  | 'invalid_account'
  | 'unsupported_file_type'
  | 'file_too_large'
  | 'invalid_file'
  | 'storage_unavailable'
  | 'invalid_import'
  | 'commit_unavailable';

function json(body: unknown, status: number) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function errorResponse(code: ImportErrorCode, status: number) {
  return json({ error: { code } }, status);
}

async function readBoundedBody(request: Request) {
  const declared = request.headers.get('content-length');
  if (declared !== null) {
    const size = Number(declared);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('invalid-size');
    if (size > MAX_SBI_SOURCE_BYTES) throw new Error('too-large');
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_SBI_SOURCE_BYTES) {
      await reader.cancel();
      throw new Error('too-large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function createImportHandlers(dependencies: {
  expectedOrigin: string;
  sessionStore: SessionStore;
  importRepository: ImportRepository;
}) {
  async function authenticate(request: NextRequest) {
    return resolveSessionPrincipal(
      request.cookies.get(SESSION_COOKIE)?.value,
      dependencies.sessionStore,
    );
  }

  return {
    async stage(request: NextRequest) {
      if (!hasExpectedOrigin(request, dependencies.expectedOrigin)) {
        return errorResponse('invalid_request', 403);
      }
      const principal = await authenticate(request);
      if (!principal) return errorResponse('session_expired', 401);
      const brokerAccountId = request.headers.get('x-broker-account-id');
      if (!brokerAccountId || !UUID.test(brokerAccountId)) {
        return errorResponse('invalid_account', 400);
      }
      const mediaType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
      if (!mediaType || !['text/csv', 'application/csv', 'application/vnd.ms-excel'].includes(mediaType)) {
        return errorResponse('unsupported_file_type', 415);
      }
      try {
        const bytes = await readBoundedBody(request);
        const result = await dependencies.importRepository.stageSbiTradeHistory({
          principal,
          brokerAccountId,
          mediaType,
          bytes,
        });
        return json(result, result.disposition === 'new' ? 201 : 200);
      } catch (error) {
        if (error instanceof Error && (error.message === 'too-large' || error.message === 'invalid-size')) {
          return errorResponse('file_too_large', 413);
        }
        if (error instanceof Error && error.message.startsWith('SBI約定履歴CSV')) {
          return errorResponse('invalid_file', 422);
        }
        if (error instanceof Error && error.message === 'Broker account is unavailable') {
          return errorResponse('invalid_account', 400);
        }
        return errorResponse('storage_unavailable', 503);
      }
    },
    async commit(request: NextRequest, batchId: string) {
      if (!hasExpectedOrigin(request, dependencies.expectedOrigin)) {
        return errorResponse('invalid_request', 403);
      }
      const principal = await authenticate(request);
      if (!principal) return errorResponse('session_expired', 401);
      if (!UUID.test(batchId)) return errorResponse('invalid_import', 400);
      try {
        return json(await dependencies.importRepository.commitBatch({ principal, batchId }), 200);
      } catch (error) {
        if (error instanceof Error && error.message === 'Import batch is unavailable') {
          return errorResponse('invalid_import', 404);
        }
        return errorResponse('commit_unavailable', 503);
      }
    },
  };
}
