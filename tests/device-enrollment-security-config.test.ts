import { describe, expect, it } from 'vitest';
import nextConfig from '../next.config';

describe('device enrollment route security', () => {
  it('allows only same-origin API connections and forbids framing/referrers/caching', async () => {
    const entries = await nextConfig.headers!();
    for (const source of [
      '/add-device',
      '/settings/devices',
      '/api/auth/passkey/device-enrollment/:path*',
    ]) {
      const route = entries.find((entry) => entry.source === source);
      const value = (key: string) => route?.headers.find((header) => header.key === key)?.value;
      expect(value('Content-Security-Policy')).toContain("connect-src 'self'");
      expect(value('Content-Security-Policy')).toContain("frame-ancestors 'none'");
      expect(value('Referrer-Policy')).toBe('no-referrer');
      expect(value('Cache-Control')).toBe('no-store');
      expect(value('X-Content-Type-Options')).toBe('nosniff');
    }
  });
});
