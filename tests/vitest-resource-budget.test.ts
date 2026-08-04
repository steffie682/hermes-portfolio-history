import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
const config = readFileSync('vitest.config.ts', 'utf8');

describe('Vitest resource budget', () => {
  it('keeps local and CI test runs below the one-GiB server budget', () => {
    expect(packageJson.scripts.test).toContain('NODE_OPTIONS=--max-old-space-size=512');
    expect(config).toMatch(/maxWorkers:\s*1/);
    expect(config).toMatch(/fileParallelism:\s*false/);
  });
});
