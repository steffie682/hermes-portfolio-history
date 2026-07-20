import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DeviceEnrollmentSource from '@/app/settings/devices/device-enrollment-source';

const { startAuthentication } = vi.hoisted(() => ({
  startAuthentication: vi.fn().mockResolvedValue({ id: 'desktop-credential' }),
}));
vi.mock('@simplewebauthn/browser', () => ({ startAuthentication }));
vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }: { value: string }) => <div data-testid="local-qr" data-value={value} />,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('device enrollment source UI', () => {
  it('re-authenticates before showing a locally generated five-minute QR', async () => {
    const grantToken = 'g'.repeat(43);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ options: { challenge: 'auth' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        grantToken,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    render(<DeviceEnrollmentSource />);
    fireEvent.click(screen.getByRole('button', { name: 'スマホを追加する' }));

    const qr = await screen.findByTestId('local-qr');
    expect(startAuthentication).toHaveBeenCalled();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/auth/passkey/login/options',
      '/api/auth/passkey/login/verify',
      '/api/auth/passkey/device-enrollment/grant',
    ]);
    expect(qr.getAttribute('data-value')).toBe(`http://localhost:3000/add-device#${grantToken}`);
    expect(screen.getByText('5分以内にスマホで読み取ってください')).toBeTruthy();
    expect(document.body.textContent).not.toContain(grantToken);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  });
});
