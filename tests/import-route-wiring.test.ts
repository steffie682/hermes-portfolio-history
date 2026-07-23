import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const routes = [
  'src/app/api/imports/sbi/route.ts',
  'src/app/api/imports/[batchId]/commit/route.ts',
  'src/app/api/imports/[batchId]/distribution-details/route.ts',
];

describe('import route release wiring', () => {
  it('keeps financial data directories ignored without excluding API source', async () => {
    const ignore = await readFile('.gitignore', 'utf8');
    expect(ignore).toContain('\n/imports/\n');
    expect(ignore).not.toContain('\nimports/\n');
    for (const route of routes) {
      await expect(readFile(route, 'utf8')).resolves.toContain('export async function POST');
    }
  });
});
