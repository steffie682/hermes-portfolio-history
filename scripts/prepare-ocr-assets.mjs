import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = resolve(process.env.OCR_PUBLIC_DIR ?? join(projectRoot, 'public/ocr'));
const packages = [
  ['tesseract.js', '7.0.0'],
  ['tesseract.js-core', '7.0.0'],
  ['@tesseract.js-data/jpn', '1.0.0'],
];

for (const [name, expectedVersion] of packages) {
  const manifestPath = join(projectRoot, 'node_modules', name, 'package.json');
  if (!existsSync(manifestPath)) throw new Error(`Missing OCR dependency: ${name}`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.version !== expectedVersion) {
    throw new Error(`Unexpected OCR dependency version: ${name}`);
  }
}

const copies = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm', 'core/tesseract-core-lstm.wasm'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'core/tesseract-core-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm', 'core/tesseract-core-simd-lstm.wasm'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'core/tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm', 'core/tesseract-core-relaxedsimd-lstm.wasm'],
  ['node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'core/tesseract-core-relaxedsimd-lstm.wasm.js'],
  ['node_modules/@tesseract.js-data/jpn/4.0.0_best_int/jpn.traineddata.gz', 'lang/jpn.traineddata.gz'],
];

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(outputRoot, { recursive: true });

for (const [sourceRelative, destinationRelative] of copies) {
  const source = join(projectRoot, sourceRelative);
  if (!existsSync(source)) throw new Error(`Missing OCR asset: ${sourceRelative}`);
  const destination = join(outputRoot, destinationRelative);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
}
