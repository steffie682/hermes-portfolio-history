import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deviceEnrollmentBootstrapScript } from '@/app/add-device/device-enrollment-bootstrap';
import DeviceEnrollmentTarget from '@/app/add-device/device-enrollment-target';
import AddDevicePage from '@/app/add-device/page';

const { push, startRegistration } = vi.hoisted(() => ({
  push: vi.fn(),
  startRegistration: vi.fn().mockResolvedValue({ id: 'smartphone-credential' }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock('@simplewebauthn/browser', () => ({ startRegistration }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
  delete window.__portfolioDeviceEnrollmentPreparation;
});

describe('device enrollment target UI', () => {
  it('clears the fragment, moves the grant to an HttpOnly cookie, and verifies without resending it', async () => {
    const grantToken = 'g'.repeat(43);
    window.history.replaceState(null, '', `/add-device#${grantToken}`);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ options: { challenge: 'registration' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    new Function(deviceEnrollmentBootstrapScript)();
    expect(window.location.hash).toBe('');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    render(<DeviceEnrollmentTarget />);
    const button = await screen.findByRole('button', { name: 'このスマホを追加する' });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/passkey/device-enrollment/options');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ grantToken });

    fireEvent.click(button);
    await waitFor(() => expect(push).toHaveBeenCalledWith('/imports/sbi'));
    expect(startRegistration).toHaveBeenCalled();
    expect(fetchMock.mock.calls[1][0]).toBe('/api/auth/passkey/device-enrollment/verify');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      response: { id: 'smartphone-credential' },
    });
    expect(document.body.textContent).not.toContain(grantToken);
  });
  it('guides the user to normal login when this phone already has the passkey', async () => {
    window.__portfolioDeviceEnrollmentPreparation = Promise.resolve({
      options: { challenge: 'registration' } as never,
    });
    startRegistration.mockRejectedValueOnce(
      new DOMException('A matching passkey already exists', 'InvalidStateError'),
    );

    render(<DeviceEnrollmentTarget />);
    const button = await screen.findByRole('button', { name: 'このスマホを追加する' });
    fireEvent.click(button);

    expect(
      await screen.findByText('このスマホではすでにPasskeyを利用できます。通常ログインをお試しください。'),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: '通常ログインを試す' }).getAttribute('href')).toBe('/login');
  });

  it('places the fragment-clearing bootstrap before the hydrated target UI', () => {
    const markup = renderToStaticMarkup(<AddDevicePage />);
    expect(markup.indexOf('data-device-enrollment-bootstrap')).toBeGreaterThanOrEqual(0);
    expect(markup.indexOf('data-device-enrollment-bootstrap')).toBeLessThan(
      markup.indexOf('QRコードを確認しています'),
    );
  });

});
