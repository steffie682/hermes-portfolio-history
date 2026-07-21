import { createImportHandlers } from '@/import/http';
import { getImportRuntime } from '@/import/runtime';
import type { NextRequest } from 'next/server';

function failure() {
  return Response.json(
    { error: { code: 'service_unavailable' } },
    { status: 500, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: NextRequest) {
  try {
    const { config, repository, importRepository } = await getImportRuntime();
    return createImportHandlers({
      expectedOrigin: config.origin,
      sessionStore: repository.sessionStore,
      importRepository,
    }).stage(request);
  } catch {
    return failure();
  }
}
