import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('PDF operator diagnostic client wiring', () => {
  it.each([
    'src/app/imports/sbi/distribution-report/client.tsx',
    'src/app/imports/sbi/balance-report/client.tsx',
  ])('passes OPS from the existing dynamic PDF.js import in %s', (path) => {
    const source = readFileSync(path, 'utf8');

    expect(source.match(/import\('pdfjs-dist\/legacy\/build\/pdf\.mjs'\)/g)).toHaveLength(1);
    expect(source).toMatch(/extractPdfStructure\([\s\S]*?signal,[\s\S]*?pdfjs\.OPS,[\s\S]*?\)/);
  });
});
