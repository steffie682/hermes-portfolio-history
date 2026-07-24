import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('PDF operator diagnostic client wiring', () => {
  it('keeps operator probing wired for the balance-report inspector', () => {
    const path = 'src/app/imports/sbi/balance-report/client.tsx';
    const source = readFileSync(path, 'utf8');

    expect(source.match(/import\('pdfjs-dist\/legacy\/build\/pdf\.mjs'\)/g)).toHaveLength(1);
    expect(source).toMatch(/extractPdfStructure\([\s\S]*?signal,[\s\S]*?pdfjs\.OPS,[\s\S]*?pdfjs\.normalizeUnicode,[\s\S]*?\)/);
  });

  it('does not opt the distribution inspector into operator probing', () => {
    const source = readFileSync('src/app/imports/sbi/distribution-report/client.tsx', 'utf8');

    expect(source.match(/import\('pdfjs-dist\/legacy\/build\/pdf\.mjs'\)/g)).toHaveLength(1);
    expect(source).toMatch(/extractPdfStructure\(\s*source,\s*pdfjs\.getDocument[\s\S]*?signal,\s*\)/);
    expect(source).not.toContain('pdfjs.OPS');
    expect(source).not.toContain('pdfjs.normalizeUnicode');
  });

  it('keeps the pasted-text path free of network, storage, clipboard, forms, and dangerous HTML', () => {
    const source = readFileSync('src/app/imports/sbi/distribution-report/client.tsx', 'utf8');

    for (const forbidden of [
      'fetch(', 'XMLHttpRequest', 'sendBeacon', 'clipboard', 'console.',
      'localStorage', 'sessionStorage', 'indexedDB', 'caches.', 'document.cookie',
      '<form', 'dangerouslySetInnerHTML',
    ]) {
      expect(source).not.toContain(forbidden);
    }
    expect(source).toMatch(/<textarea[^>]*ref=\{pastedText\}[^>]*\/>/);
    expect(source).not.toMatch(/<textarea[^>]*(?:value|onChange)=/);
  });

  it('keeps balance OCR app source free of network, persistence, logs, clipboard, and dangerous HTML', () => {
    const paths = [
      'src/app/imports/sbi/balance-report/client.tsx',
      'src/import/sbi/browser-ocr.ts',
      'src/import/sbi/ocr-safe-report.ts',
    ];
    const source = paths.map((path) => readFileSync(path, 'utf8')).join('\n');
    const forbidden = [
      /\bfetch\s*\(/,
      /\bXMLHttpRequest\b/,
      /\bnavigator\.sendBeacon\b/,
      /\bWebSocket\b/,
      /\bEventSource\b/,
      /\blocalStorage\b/,
      /\bsessionStorage\b/,
      /\bindexedDB\b/,
      /\bcaches\./,
      /\bclipboard\b/i,
      /\bconsole\./,
      /dangerouslySetInnerHTML/,
    ];
    forbidden.forEach((pattern) => expect(source).not.toMatch(pattern));
    expect(source).not.toContain('<form');
    expect(source).toContain("validateSameOriginUrl('/ocr/worker.min.js', '/ocr/worker.min.js')");
    expect(source).toContain("validateSameOriginUrl('/ocr/core', '/ocr/core')");
    expect(source).toContain("validateSameOriginUrl('/ocr/lang', '/ocr/lang')");
    expect(source).toContain("cacheMethod: 'none'");
    expect(source).toContain('workerBlobURL: false');
    expect(source).toContain('gzip: true');
  });
});
