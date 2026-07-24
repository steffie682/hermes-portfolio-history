import { describe, expect, it } from 'vitest';
import { tryToParsePath } from 'next/dist/lib/try-to-parse-path';
import nextConfig from '../next.config';

function sourceMatches(source: string, pathname: string): boolean {
  const { error, regexStr } = tryToParsePath(source);
  if (error || !regexStr) return false;
  return new RegExp(regexStr).test(pathname);
}

describe('authenticated import CSP', () => {
  it('serves the OCR worker under a restrictive worker response policy', async () => {
    const entries = await nextConfig.headers!();
    const route = entries.find((entry) => entry.source === '/ocr/worker.min.js');
    const csp = route?.headers.find((header) => header.key === 'Content-Security-Policy')?.value;
    expect(csp).toBe(
      "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'",
    );
    expect(csp).not.toContain('blob:');
    expect(route?.headers).toContainEqual({ key: 'X-Content-Type-Options', value: 'nosniff' });
    expect(route?.headers).toContainEqual({
      key: 'Cache-Control',
      value: 'public, max-age=0, must-revalidate',
    });
  });

  it.each(['/ocr/core/:path*', '/ocr/lang/:path*'])(
    'serves %s only under a restrictive static-asset policy',
    async (source) => {
      const entries = await nextConfig.headers!();
      const route = entries.find((entry) => entry.source === source);
      const csp = route?.headers.find((header) => header.key === 'Content-Security-Policy')?.value;
      expect(csp).toBe("default-src 'none'");
      expect(route?.headers).toContainEqual({ key: 'X-Content-Type-Options', value: 'nosniff' });
      expect(route?.headers).toContainEqual({
        key: 'Cache-Control',
        value: 'public, max-age=0, must-revalidate',
      });
    },
  );

  it('blocks every connection and private-caches nothing on the distribution inspector route', async () => {
    expect(nextConfig.headers).toBeTypeOf('function');
    const entries = await nextConfig.headers!();
    const route = entries.find((entry) => entry.source === '/imports/sbi/distribution-report');
    const csp = route?.headers.find((header) => header.key === 'Content-Security-Policy')?.value;
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("worker-src 'self'");
    expect(route?.headers).toContainEqual({ key: 'Cache-Control', value: 'private, no-store' });
  });

  it('allows only same-origin API connections and blocks framing on the sensitive file route', async () => {
    expect(nextConfig.headers).toBeTypeOf('function');
    const entries = await nextConfig.headers!();
    const route = entries.find((entry) => entry.source !== '/imports/sbi/distribution-report'
      && sourceMatches(entry.source, '/imports/sbi/balance-report'));
    const csp = route?.headers.find((header) => header.key === 'Content-Security-Policy')?.value;
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("worker-src 'self'");
    expect(route?.headers).toContainEqual({ key: 'Cache-Control', value: 'no-store' });
    expect(sourceMatches(route?.source ?? '', '/imports/sbi')).toBe(true);
    expect(sourceMatches(route?.source ?? '', '/imports/sbi/balance-report')).toBe(true);
    expect(sourceMatches(route?.source ?? '', '/imports/sbi/example-batch')).toBe(true);
    expect(sourceMatches(route?.source ?? '', '/imports/sbi/distribution-report')).toBe(false);
  });
});
