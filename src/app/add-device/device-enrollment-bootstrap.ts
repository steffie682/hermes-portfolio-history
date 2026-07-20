import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';

export type DeviceEnrollmentPreparation =
  | { options: PublicKeyCredentialCreationOptionsJSON }
  | { error: true };

declare global {
  interface Window {
    __portfolioDeviceEnrollmentPreparation?: Promise<DeviceEnrollmentPreparation>;
  }
}

export const deviceEnrollmentBootstrapScript = `(() => {
  const grantToken = window.location.hash.slice(1);
  window.history.replaceState(
    null,
    '',
    window.location.pathname + window.location.search,
  );
  const preparation = /^[A-Za-z0-9_-]{43}$/.test(grantToken)
    ? fetch('/api/auth/passkey/device-enrollment/options', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grantToken }),
      })
        .then(async (response) => {
          if (!response.ok) return { error: true };
          const body = await response.json();
          return { options: body.options };
        })
        .catch(() => ({ error: true }))
    : Promise.resolve({ error: true });
  Object.defineProperty(window, '__portfolioDeviceEnrollmentPreparation', {
    value: preparation,
    configurable: true,
    writable: true,
  });
})();`;
