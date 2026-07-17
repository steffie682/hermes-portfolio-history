import { getAuthRuntime } from '@/auth/runtime';
import { createBrokerAccountHandlers } from '@/broker-accounts/http';
import type { NextRequest } from 'next/server';

function operationFailure() {
  return Response.json({ error: 'Operation failed' }, { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const { config, repository } = await getAuthRuntime();
    return createBrokerAccountHandlers(repository, config.origin).list(request);
  } catch {
    return operationFailure();
  }
}

export async function POST(request: NextRequest) {
  try {
    const { config, repository } = await getAuthRuntime();
    return createBrokerAccountHandlers(repository, config.origin).create(request);
  } catch {
    return operationFailure();
  }
}
