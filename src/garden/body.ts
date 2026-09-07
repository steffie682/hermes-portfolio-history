export class GardenBodyError extends Error {
  constructor(public readonly status: number) { super('Invalid request'); }
}
// Enforces actual UTF-8 bytes even without Content-Length. Never buffers an unbounded body.
export async function readGardenJson(input: Request | Response, maximum: number): Promise<unknown> {
  const length = input.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum)) throw new GardenBodyError(413);
  const reader = input.body?.getReader();
  if (!reader) throw new GardenBodyError(400);
  const chunks: Uint8Array[] = [];
  let total = 0;
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { reject(new GardenBodyError(408)); void reader.cancel().catch(() => {}); }, 3000);
  });
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      total += value.byteLength;
      if (total > maximum) throw new GardenBodyError(413);
      chunks.push(value);
    }
    const buffer = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)); }
    catch { throw new GardenBodyError(400); }
  } finally { clearTimeout(timer!); void reader.cancel().catch(() => {}); reader.releaseLock(); }
}
