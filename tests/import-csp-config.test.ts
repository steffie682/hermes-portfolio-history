import { describe, expect, it } from 'vitest';
import nextConfig from '../next.config';

describe('authenticated import CSP', () => {
  it('blocks browser connections and framing on the sensitive file route', async () => {
    expect(nextConfig.headers).toBeTypeOf('function');
    const entries = await nextConfig.headers!();
    const route = entries.find((entry) => entry.source === '/imports/sbi');
    const csp = route?.headers.find((header) => header.key === 'Content-Security-Policy')?.value;
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'none'");
  });
});
