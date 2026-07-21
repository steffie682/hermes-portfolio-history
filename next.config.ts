import type { NextConfig } from 'next';

const importContentSecurityPolicy = [
  "default-src 'self'",
  "connect-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');


const deviceEnrollmentContentSecurityPolicy = [
  "default-src 'self'",
  "connect-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const deviceEnrollmentHeaders = [
  { key: 'Content-Security-Policy', value: deviceEnrollmentContentSecurityPolicy },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Cache-Control', value: 'no-store' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/imports/sbi/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: importContentSecurityPolicy },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cache-Control', value: 'no-store' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
      { source: '/add-device', headers: deviceEnrollmentHeaders },
      { source: '/settings/devices', headers: deviceEnrollmentHeaders },
      {
        source: '/api/auth/passkey/device-enrollment/:path*',
        headers: deviceEnrollmentHeaders,
      },
    ];
  },
};

export default nextConfig;
