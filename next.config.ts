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

const distributionReportContentSecurityPolicy = importContentSecurityPolicy.replace(
  "connect-src 'self'",
  "connect-src 'none'",
);


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

const versionlessOcrAssetHeaders = [
  { key: 'Content-Security-Policy', value: "default-src 'none'" },
  { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/ocr/worker.min.js',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'",
          },
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
      { source: '/ocr/core/:path*', headers: versionlessOcrAssetHeaders },
      { source: '/ocr/lang/:path*', headers: versionlessOcrAssetHeaders },
      {
        source: '/imports/sbi((?!/distribution-report$).*)',
        headers: [
          { key: 'Content-Security-Policy', value: importContentSecurityPolicy },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cache-Control', value: 'no-store' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
      {
        source: '/imports/sbi/distribution-report',
        headers: [
          { key: 'Content-Security-Policy', value: distributionReportContentSecurityPolicy },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cache-Control', value: 'private, no-store' },
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
