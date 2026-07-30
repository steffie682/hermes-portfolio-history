import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { BatchCommitButton } from '@/app/imports/sbi/[batchId]/batch-commit-button';

const batchId = '10000000-0000-4000-8000-000000000001';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  refresh.mockReset();
});

describe('batch commit button', () => {
  it('commits the saved batch without requiring the original CSV again', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      batchId, status: 'committed', committed: 2,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    render(<BatchCommitButton batchId={batchId} />);
    fireEvent.click(screen.getByRole('button', { name: '取込を確定' }));
    expect((await screen.findByRole('status')).textContent).toBe('確定済み 2件');
    expect(fetchMock).toHaveBeenCalledWith(`/api/imports/${batchId}/commit`, { method: 'POST' });
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });

  it.each([
    ['session_expired', 'ログイン期限が切れました'],
    ['invalid_import', '保存済みの取込が見つかりません'],
    ['commit_unavailable', '一時的に利用できません'],
    ['service_unavailable', '一時的に利用できません'],
  ])('shows an actionable message for %s', async (code, expected) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      error: { code },
    }), { status: 409, headers: { 'content-type': 'application/json' } }));
    render(<BatchCommitButton batchId={batchId} />);
    fireEvent.click(screen.getByRole('button', { name: '取込を確定' }));
    expect((await screen.findByRole('alert')).textContent).toContain(expected);
  });

  it('uses a safe retry message for a malformed success response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      batchId: '20000000-0000-4000-8000-000000000002', committed: 2,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    render(<BatchCommitButton batchId={batchId} />);
    fireEvent.click(screen.getByRole('button', { name: '取込を確定' }));
    const message = (await screen.findByRole('alert')).textContent ?? '';
    expect(message).toContain('もう一度確定できます');
    expect(message).not.toContain('資料待ち');
  });

  it('ignores rapid repeated clicks while a commit is in flight', async () => {
    let resolve!: (response: Response) => void;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise((done) => { resolve = done; }));
    render(<BatchCommitButton batchId={batchId} />);
    const button = screen.getByRole('button', { name: '取込を確定' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolve(new Response(JSON.stringify({ batchId, committed: 1 }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    expect(await screen.findByText('確定済み 1件')).toBeTruthy();
  });

  it('keeps the saved work resumable when unresolved evidence blocks commit', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'distribution_details_required' },
    }), { status: 409, headers: { 'content-type': 'application/json' } }));
    render(<BatchCommitButton batchId={batchId} />);
    fireEvent.click(screen.getByRole('button', { name: '取込を確定' }));
    expect((await screen.findByRole('alert')).textContent).toContain('分配金・再投資の詳細');
    expect((screen.getByRole('button', { name: '取込を確定' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
