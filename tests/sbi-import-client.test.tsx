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

afterEach(() => cleanup());

describe('SBI import client', () => {
  it('classifies a valid file in memory without offering persistence', async () => {
    render(<SbiImportClient />);
    expect(screen.getByText('CSVは外部へ送信されません')).toBeTruthy();
    choose(fileLike(csvBytes(['株式現物買', '信用新規買', '分配金再投資'])));

    expect(await screen.findByText('取引 3件')).toBeTruthy();
    expect(screen.getByText('自動計上候補 1件')).toBeTruthy();
    expect(screen.getByText('信用対応待ち 1件')).toBeTruthy();
    expect(screen.getByText('分配詳細待ち 1件')).toBeTruthy();
    expect(screen.getByText('現物・投信の台帳準備 1 / 1件')).toBeTruthy();
    expect(screen.getByText('開始時点の保有残高が必要です')).toBeTruthy();
    expect(screen.getByRole('link', { name: '取引残高報告書を確認する' }).getAttribute('href')).toBe('/imports/sbi/balance-report');
    expect(screen.getByRole('button', { name: '取込を確定（まだ利用できません）' }).hasAttribute('disabled')).toBe(true);
  });

  it('processes the repository-owned Shift_JIS fixture through the browser path', async () => {
    const bytes = new Uint8Array(await readFile(path.join(process.cwd(), 'tests/fixtures/sbi/trade-history.shift-jis.synthetic.csv')));
    render(<SbiImportClient />);
    choose(fileLike(bytes));

    expect(await screen.findByText('取引 5件')).toBeTruthy();
    expect(screen.getByText('種類の確認待ち 5件')).toBeTruthy();
  });

  it('shows an explicit empty state for a header-only CSV', async () => {
    render(<SbiImportClient />);
    choose(fileLike(csvBytes([])));

    expect(await screen.findByText('取引 0件')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('取引がありません');
    expect(screen.queryByText('すべて自動計上候補として確認できました。')).toBeNull();
  });

  it('rejects an oversized file before allocating its bytes', async () => {
    const arrayBuffer = vi.fn();
    render(<SbiImportClient />);
    choose({ size: 10 * 1024 * 1024 + 1, arrayBuffer } as unknown as File);

    expect((await screen.findByRole('alert')).textContent).toContain('10 MB以下');
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('does not let an older file read overwrite the latest selection', async () => {
    let resolveOlder!: (value: ArrayBuffer) => void;
    const olderBytes = csvBytes(['株式現物買']);
    const olderRead = vi.fn(() => new Promise<ArrayBuffer>((resolve) => { resolveOlder = resolve; }));
    const newerBytes = csvBytes(['株式現物買', '株式現物売']);
    render(<SbiImportClient />);

    choose(fileLike(olderBytes, olderRead));
    choose(fileLike(newerBytes));
    expect(await screen.findByText('取引 2件')).toBeTruthy();

    await act(async () => resolveOlder(olderBytes.buffer));
    expect(screen.getByText('取引 2件')).toBeTruthy();
  });

  it('clears an older preview before validating a replacement that fails', async () => {
    render(<SbiImportClient />);
    choose(fileLike(csvBytes(['株式現物買'])));
    expect(await screen.findByText('取引 1件')).toBeTruthy();

    choose(fileLike(new TextEncoder().encode('not an SBI CSV')));
    await waitFor(() => expect(screen.queryByText('取引 1件')).toBeNull());
    expect((await screen.findByRole('alert')).textContent).toContain('対応する14列の見出しがありません');
  });
});
