import type { NextRequest } from 'next/server';
import { getGardenHandlers } from '@/garden/runtime';
import { gardenFailure } from '@/garden/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  try { return await (await getGardenHandlers()).get(request); }
  catch { return gardenFailure(); }
}
export async function PUT(request: NextRequest) {
  try { return await (await getGardenHandlers()).put(request); }
  catch { return gardenFailure(); }
}
