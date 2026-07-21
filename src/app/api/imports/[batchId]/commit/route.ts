import { createImportHandlers } from '@/import/http';
import { getImportRuntime } from '@/import/runtime';
import type { NextRequest } from 'next/server';

function failure() {
  return Response.json(
    { error: { code: 'service_unavailable' } },
    { status: 500, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ batchId: string }> },
) {
  try {
    const [{ batchId }, runtime] = await Promise.all([
      context.params,
      getImportRuntime(),
    ]);
    return createImportHandlers({
      expectedOrigin: runtime.config.origin,
      sessionStore: runtime.repository.sessionStore,
      importRepository: runtime.importRepository,
    }).commit(request, batchId);
  } catch {
    return failure();
  }
}
