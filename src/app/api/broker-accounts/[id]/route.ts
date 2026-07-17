import { getAuthRuntime } from '@/auth/runtime';
import { createBrokerAccountHandlers } from '@/broker-accounts/http';
import type { NextRequest } from 'next/server';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const { config, repository } = await getAuthRuntime();
    return createBrokerAccountHandlers(repository, config.origin).get(request, id);
  } catch {
    return Response.json({ error: 'Operation failed' }, { status: 500 });
  }
}
