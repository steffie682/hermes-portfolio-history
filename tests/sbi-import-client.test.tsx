import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SbiImportClient from '@/app/imports/sbi/import-client';

const HEADER = '約定日,銘柄,銘柄コード,市場,取引,期限,預り,課税,約定数量,約定単価,手数料/諸経費等,税額,受渡日,受渡金額/決済損益';

function csvBytes(transactionTypes: string[]) {
  const rows = transactionTypes.map((transactionType, index) =>
    `2000/01/${String(index + 1).padStart(2, '0')},[合成銘柄],0000,東証,${transactionType},--,特定,申告,1,100,--,--,2000/01/${String(index + 2).padStart(2, '0')},100`,
  );
  return new TextEncoder().encode(
    ['[安全なダミー]', '[安全なダミー]', '[安全なダミー]', '[安全なダミー]', HEADER, ...rows].join('\n'),
  );
}

function fileLike(bytes: Uint8Array, arrayBuffer = vi.fn().mockResolvedValue(bytes.buffer)) {
  return { size: bytes.byteLength, arrayBuffer } as unknown as File;
}

function choose(file: File) {
  fireEvent.change(screen.getByLabelText('SBI約定履歴CSV'), { target: { files: [file] } });
}

const ACCOUNT = {
  id: '00000000-0000-4000-8000-000000000001',
  broker: 'sbi',
  displayName: 'SBI証券',
};

function renderClient() {
  return render(<SbiImportClient initialAccounts={[ACCOUNT]} />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SBI import client', () => {
  it('classifies a valid file before offering explicit private persistence', async () => {
    renderClient();
    expect(screen.getByText('CSV原本はログイン中の本人専用の非公開領域に保存されます')).toBeTruthy();
    choose(fileLike(csvBytes(['株式現物買', '信用新規買', '分配金再投資'])));

    expect(await screen.findByText('取引 3件')).toBeTruthy();
    expect(screen.getByText('自動計上候補 1件')).toBeTruthy();
    expect(screen.getByText('信用対応待ち 1件')).toBeTruthy();
    expect(screen.getByText('分配詳細待ち 1件')).toBeTruthy();
    expect(screen.getByText('現物・投信の台帳準備 1 / 1件')).toBeTruthy();
    expect(screen.getByText('開始時点の保有残高が必要です')).toBeTruthy();
    expect(screen.getByText('再投資口数の準備 1 / 1件')).toBeTruthy();
    expect(screen.getByText('分配金・税・取得価額の詳細が必要です')).toBeTruthy();
    expect(screen.getByRole('link', { name: '分配金・再投資PDFの構造を確認する' }).getAttribute('href'))
      .toBe('/imports/sbi/distribution-report');
    expect(screen.getByRole('link', { name: '取引残高報告書を確認する' }).getAttribute('href')).toBe('/imports/sbi/balance-report');
    expect(screen.getByRole('button', { name: '非公開で保存して確認' }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: '取込を確定' }).hasAttribute('disabled')).toBe(true);
  });

  it('stages four preview statuses and commits supported events once', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          batchId: '10000000-0000-4000-8000-000000000001',
          disposition: 'new',
          counts: { new: 1, duplicate: 0, needsReview: 0, rejected: 0 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          batchId: '10000000-0000-4000-8000-000000000001',
          status: 'committed',
          committed: 1,
        }),
      });
    vi.stubGlobal('fetch', fetchMock);
    renderClient();
    choose(fileLike(csvBytes(['株式現物買'])));
    expect(await screen.findByText('取引 1件')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '非公開で保存して確認' }));
    expect(await screen.findByText('新規 1件')).toBeTruthy();
    expect(screen.getByText('重複 0件')).toBeTruthy();
    expect(screen.getByText('要確認 0件')).toBeTruthy();
    expect(screen.getByText('拒否 0件')).toBeTruthy();
    expect(screen.getByRole('link', { name: '原本行との対応を確認' }).getAttribute('href'))
      .toBe('/imports/sbi/10000000-0000-4000-8000-000000000001');

    fireEvent.click(screen.getByRole('button', { name: '取込を確定' }));
    expect(await screen.findByText('確定済み 1件')).toBeTruthy();
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/imports/sbi',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(ArrayBuffer),
        headers: expect.objectContaining({ 'X-Broker-Account-Id': ACCOUNT.id }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/imports/10000000-0000-4000-8000-000000000001/commit',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('processes the repository-owned Shift_JIS fixture through the browser path', async () => {
    const bytes = new Uint8Array(await readFile(path.join(process.cwd(), 'tests/fixtures/sbi/trade-history.shift-jis.synthetic.csv')));
    renderClient();
    choose(fileLike(bytes));

    expect(await screen.findByText('取引 5件')).toBeTruthy();
    expect(screen.getByText('種類の確認待ち 5件')).toBeTruthy();
  });

  it('shows an explicit empty state for a header-only CSV', async () => {
    renderClient();
    choose(fileLike(csvBytes([])));

    expect(await screen.findByText('取引 0件')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('取引がありません');
    expect(screen.queryByText('すべて自動計上候補として確認できました。')).toBeNull();
  });

  it('rejects an oversized file before allocating its bytes', async () => {
    const arrayBuffer = vi.fn();
    renderClient();
    choose({ size: 10 * 1024 * 1024 + 1, arrayBuffer } as unknown as File);

    expect((await screen.findByRole('alert')).textContent).toContain('10 MB以下');
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('does not let an older file read overwrite the latest selection', async () => {
    let resolveOlder!: (value: ArrayBuffer) => void;
    const olderBytes = csvBytes(['株式現物買']);
    const olderRead = vi.fn(() => new Promise<ArrayBuffer>((resolve) => { resolveOlder = resolve; }));
    const newerBytes = csvBytes(['株式現物買', '株式現物売']);
    renderClient();

    choose(fileLike(olderBytes, olderRead));
    choose(fileLike(newerBytes));
    expect(await screen.findByText('取引 2件')).toBeTruthy();

    await act(async () => resolveOlder(olderBytes.buffer));
    expect(screen.getByText('取引 2件')).toBeTruthy();
  });

  it('clears an older preview before validating a replacement that fails', async () => {
    renderClient();
    choose(fileLike(csvBytes(['株式現物買'])));
    expect(await screen.findByText('取引 1件')).toBeTruthy();

    choose(fileLike(new TextEncoder().encode('not an SBI CSV')));
    await waitFor(() => expect(screen.queryByText('取引 1件')).toBeNull());
    expect((await screen.findByRole('alert')).textContent).toContain('対応する14列の見出しがありません');
  });
  it('creates the first SBI account without requiring a separate setup screen', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ account: ACCOUNT }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<SbiImportClient initialAccounts={[]} />);

    expect(screen.getByRole('alert').textContent).toContain('先にSBI口座を登録');
    fireEvent.click(screen.getByRole('button', { name: 'SBI口座を登録' }));

    expect(await screen.findByRole('option', { name: 'SBI証券' })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/broker-accounts', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ broker: 'sbi', displayName: 'SBI証券' }),
    }));
  });

  it('does not offer another broker account as an SBI import destination', () => {
    render(<SbiImportClient initialAccounts={[{
      id: '00000000-0000-4000-8000-000000000002',
      broker: 'other',
      displayName: '他社口座',
    }]} />);

    expect(screen.queryByRole('option', { name: '他社口座' })).toBeNull();
    expect(screen.getByRole('button', { name: 'SBI口座を登録' })).toBeTruthy();
  });

  it('locks file and account replacement while staging', async () => {
    let resolveStage!: (value: unknown) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { resolveStage = resolve; })));
    renderClient();
    choose(fileLike(csvBytes(['株式現物買'])));
    expect(await screen.findByText('取引 1件')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '非公開で保存して確認' }));
    expect((screen.getByLabelText('SBI約定履歴CSV') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('保存先口座') as HTMLSelectElement).disabled).toBe(true);

    await act(async () => resolveStage({
      ok: true,
      json: async () => ({
        batchId: '10000000-0000-4000-8000-000000000001',
        disposition: 'new',
        counts: { new: 1, duplicate: 0, needsReview: 0, rejected: 0 },
      }),
    }));
    expect((screen.getByLabelText('SBI約定履歴CSV') as HTMLInputElement).disabled).toBe(false);
  });

  it('disables commit while re-staging an existing preview', async () => {
    let resolveRestage!: (value: unknown) => void;
    const batch = {
      batchId: '10000000-0000-4000-8000-000000000001',
      disposition: 'new',
      counts: { new: 1, duplicate: 0, needsReview: 0, rejected: 0 },
    };
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => batch })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRestage = resolve; })));
    renderClient();
    choose(fileLike(csvBytes(['株式現物買'])));
    expect(await screen.findByText('取引 1件')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '非公開で保存して確認' }));
    expect(await screen.findByText('新規 1件')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '非公開で保存して確認' }));
    expect((screen.getByRole('button', { name: '取込を確定' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => resolveRestage({ ok: true, json: async () => batch }));
  });

  it('locks file and account replacement while committing', async () => {
    let resolveCommit!: (value: unknown) => void;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          batchId: '10000000-0000-4000-8000-000000000001',
          disposition: 'new',
          counts: { new: 1, duplicate: 0, needsReview: 0, rejected: 0 },
        }),
      })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveCommit = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    renderClient();
    choose(fileLike(csvBytes(['株式現物買'])));
    expect(await screen.findByText('取引 1件')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '非公開で保存して確認' }));
    expect(await screen.findByText('新規 1件')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '取込を確定' }));
    expect((screen.getByRole('button', { name: '非公開で保存して確認' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('SBI約定履歴CSV') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('保存先口座') as HTMLSelectElement).disabled).toBe(true);

    await act(async () => resolveCommit({ ok: true, json: async () => ({ batchId: '10000000-0000-4000-8000-000000000001', committed: 1 }) }));
    expect(await screen.findByText('確定済み 1件')).toBeTruthy();
  });


  it('rejects a commit response for a different batch', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          batchId: '10000000-0000-4000-8000-000000000001',
          disposition: 'new',
          counts: { new: 1, duplicate: 0, needsReview: 0, rejected: 0 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          batchId: '20000000-0000-4000-8000-000000000002',
          committed: 1,
        }),
      });
    vi.stubGlobal('fetch', fetchMock);
    renderClient();
    choose(fileLike(csvBytes(['株式現物買'])));
    expect(await screen.findByText('取引 1件')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '非公開で保存して確認' }));
    expect(await screen.findByText('新規 1件')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '取込を確定' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('確定済み 1件')).toBeNull();
  });


  it('shows an actionable message for a server-rejected CSV', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: { code: 'invalid_file' } }),
    }));
    renderClient();
    choose(fileLike(csvBytes(['株式現物買'])));
    expect(await screen.findByText('取引 1件')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '非公開で保存して確認' }));
    expect((await screen.findByRole('alert')).textContent).toContain('SBIの約定履歴CSVを選び直してください');
  });

});
