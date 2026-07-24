import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function filesBelow(path: string, prefix = ''): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const relative = join(prefix, entry.name);
    return entry.isDirectory() ? filesBelow(join(path, entry.name), relative) : [relative];
  }).sort();
}

function digest(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

describe('OCR static asset preparation', () => {
  it('recreates the exact pinned worker, six LSTM core assets, and Japanese data tree', () => {
    const target = mkdtempSync(join(tmpdir(), 'sbi-ocr-assets-'));
    mkdirSync(join(target, 'stale'), { recursive: true });
    writeFileSync(join(target, 'stale/asset.txt'), 'must disappear');
    const environment = { ...process.env, OCR_PUBLIC_DIR: target };
    execFileSync(process.execPath, ['scripts/prepare-ocr-assets.mjs'], { env: environment });
    const expected = [
      'core/tesseract-core-lstm.wasm',
      'core/tesseract-core-lstm.wasm.js',
      'core/tesseract-core-relaxedsimd-lstm.wasm',
      'core/tesseract-core-relaxedsimd-lstm.wasm.js',
      'core/tesseract-core-simd-lstm.wasm',
      'core/tesseract-core-simd-lstm.wasm.js',
      'lang/jpn.traineddata.gz',
      'worker.min.js',
    ];
    expect(filesBelow(target)).toEqual(expected);
    const first = expected.map((file) => digest(join(target, file)));

    execFileSync(process.execPath, ['scripts/prepare-ocr-assets.mjs'], { env: environment });
    expect(filesBelow(target)).toEqual(expected);
    expected.forEach((file, index) => {
      expect(digest(join(target, file))).toBe(first[index]);
    });
  });

  it('copies nonempty binary assets with WASM and gzip magic bytes', () => {
    const target = mkdtempSync(join(tmpdir(), 'sbi-ocr-assets-magic-'));
    execFileSync(process.execPath, ['scripts/prepare-ocr-assets.mjs'], {
      env: { ...process.env, OCR_PUBLIC_DIR: target },
    });
    for (const name of [
      'tesseract-core-lstm.wasm',
      'tesseract-core-simd-lstm.wasm',
      'tesseract-core-relaxedsimd-lstm.wasm',
    ]) {
      const bytes = readFileSync(join(target, 'core', name));
      expect(bytes.length).toBeGreaterThan(0);
      expect([...bytes.subarray(0, 4)]).toEqual([0x00, 0x61, 0x73, 0x6d]);
    }
    const language = readFileSync(join(target, 'lang/jpn.traineddata.gz'));
    expect(language.length).toBeGreaterThan(0);
    expect([...language.subarray(0, 2)]).toEqual([0x1f, 0x8b]);
    expect(readFileSync(join(target, 'worker.min.js')).length).toBeGreaterThan(0);
  });

  it('pins every copied package version in the application manifest', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(manifest.dependencies).toMatchObject({
      'tesseract.js': '7.0.0',
      'tesseract.js-core': '7.0.0',
      '@tesseract.js-data/jpn': '1.0.0',
    });
  });
});
