import { describe, expect, it } from 'vitest';
import nextConfig from '../next.config';

describe('authenticated import CSP', () => {
  it('allows only same-origin API connections and blocks framing on the sensitive file route', async () => {
    expect(nextConfig.headers).toBeTypeOf('function');
    const entries = await nextConfig.headers!();
    const route = entries.find((entry) => entry.source === '/imports/sbi/:path*');
    const csp = route?.headers.find((header) => header.key === 'Content-Security-Policy')?.value;
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("worker-src 'self'");
    expect(route?.headers).toContainEqual({ key: 'Cache-Control', value: 'no-store' });
  });
});
