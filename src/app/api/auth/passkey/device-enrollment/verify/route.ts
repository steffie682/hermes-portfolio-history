import { createDeviceEnrollmentHandlers } from '@/auth/device-enrollment-http';
import { getAuthRuntime } from '@/auth/runtime';
import type { NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { config, repository } = await getAuthRuntime();
    return createDeviceEnrollmentHandlers(repository, config).verify(request);
  } catch {
    return Response.json(
      { error: 'Operation failed' },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    );
  }
}
