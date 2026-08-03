'use client';

import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { countBalanceReportOcrCandidates, type BalanceReportOcrCandidates } from '@/import/sbi/balance-report-ocr-candidates';

export type BalanceReportAccountSummary = { id: string; displayName: string };

export type SavedSnapshotSummary = {
  id: string; statementDate: string; rowCount?: number; positionCount?: number; unresolvedSectionCount?: number;
};
type Mode = '' | 'zero' | 'rows' | 'missing';
type Draft = Record<string, string>;
type SectionName = 'deposits' | 'collateral' | 'domesticStockLots' | 'fundBalances' | 'margin';

const empty = {
  deposits: (): Draft => ({ kind: 'cash_deposit', amount: '', sourcePage: '', sourceRow: '' }),
  collateral: (): Draft => ({ kind: 'margin_guarantee', amount: '', sourcePage: '', sourceRow: '' }),
  domesticStockLots: (): Draft => ({
    securityCode: '', securityName: '', acquisitionDate: '', quantity: '',
    rowKind: 'acquisition_lot',
    acquisitionUnitPriceState: 'reported', acquisitionUnitPrice: '',
    purchaseAmountState: 'reported', purchaseAmount: '',
    referencePrice: '', evaluationAmount: '', sourcePage: '', sourceRow: '',
  }),
  fundBalances: (): Draft => ({
    securityCode: '', securityName: '', units: '', referencePrice: '', evaluationAmount: '',
    referencePriceUnit: '', sourcePage: '', sourceRow: '',
  }),
  margin: (): Draft => ({
    state: 'open', securityCode: '', securityName: '', repaymentTermLabel: '',
    designationLabel: '', quantity: '', market: 'tokyo', side: 'buy', contractDate: '',
    contractUnitPrice: '', currentPrice: '', fees: '',
    unrealizedPnl: '', finalSettlementOrPlannedDate: '',
    sourcePage: '', sourceRow: '',
  }),
};
const titles: Record<SectionName, string> = {
  deposits: '預り金・現金残高', collateral: '担保・保証金残高',
  domesticStockLots: '国内株式の取得明細', fundBalances: '自動積立・投資信託残高',
  margin: '信用取引の建玉残高',
};

function Field({ row, name, label, type = 'text', required = true, max, onChange }: {
  row: Draft; name: string; label: string; type?: string; required?: boolean; max?: number;
  onChange(name: string, value: string): void;
}) {
  return <label>{label}<input type={type} required={required} max={max} value={row[name] ?? ''}
    onChange={(event) => onChange(name, event.currentTarget.value)} /></label>;
}

function RowFields({ section, row, sourcePageCount, change }: {
  section: SectionName; row: Draft; sourcePageCount: number; change(name: string, value: string): void;
}) {
  const locator = <><Field row={row} name="sourcePage" label="元PDFのページ" type="number"
    max={sourcePageCount} onChange={change} />
    <Field row={row} name="sourceRow" label="ページ内の明細番号（上から）" type="number" onChange={change} /></>;
  if (section === 'deposits' || section === 'collateral') return <>{locator}
    <label>原本の種類<select value={row.kind} onChange={(e) => change('kind', e.currentTarget.value)}>
      {(section === 'deposits'
        ? [['cash_deposit', '預り金・現金']]
        : [
          ['margin_guarantee', '信用取引保証金'],
          ['stock_lending_collateral', '貸株担保金'],
          ['futures_options_margin', '先物・オプション取引証拠金'],
        ]).map(([value, label]) =>
          <option key={value} value={value}>{label}</option>)}
    </select></label><Field row={row} name="amount" label="原本記載額" onChange={change} /></>;
  const security = <><Field row={row} name="securityCode" label="銘柄コード" onChange={change} />
    <Field row={row} name="securityName" label="銘柄名" onChange={change} /></>;
  if (section === 'domesticStockLots') return <>{locator}{security}
    <Field row={row} name="acquisitionDate" label="取得日" type="date" onChange={change} />
    <Field row={row} name="quantity" label="数量" onChange={change} />
    <label>取得単価の原本状態<select value={row.acquisitionUnitPriceState}
      onChange={(e) => change('acquisitionUnitPriceState', e.currentTarget.value)}>
      <option value="reported">記載あり</option><option value="masked">伏字</option><option value="absent">記載なし</option>
    </select></label>
    {row.acquisitionUnitPriceState === 'reported' ?
      <Field row={row} name="acquisitionUnitPrice" label="取得単価" onChange={change} />
      : <p>取得単価は推測せず保存します。</p>}
    <label>買付金額の原本状態<select value={row.purchaseAmountState}
      onChange={(e) => change('purchaseAmountState', e.currentTarget.value)}>
      <option value="reported">記載あり</option><option value="masked">伏字</option><option value="absent">記載なし</option>
    </select></label>
    {row.purchaseAmountState === 'reported' ?
      <Field row={row} name="purchaseAmount" label="買付金額" onChange={change} />
      : <p>買付金額は推測せず保存します。</p>}
    <Field row={row} name="referencePrice" label="参考価格（記載がある場合）" required={false} onChange={change} />
    <Field row={row} name="evaluationAmount" label="評価額（記載がある場合）" required={false} onChange={change} /></>;
  if (section === 'fundBalances') return <>{locator}{security}
    <Field row={row} name="units" label="口数" onChange={change} />
    <Field row={row} name="referencePrice" label="参考価格" onChange={change} />
    <Field row={row} name="referencePriceUnit" label="参考価格の単位（記載がある場合）" required={false} onChange={change} />
    <Field row={row} name="evaluationAmount" label="評価額" onChange={change} />
    <p>報告書にない取得日・取得価額は入力しません。</p></>;
  return <>{locator}
    <p>原本列「銘柄名（弁済期限）」を、銘柄名と弁済期限に分けて入力します。</p>
    <p>原本列「数量・市場」を、数量と市場に分けて入力します。</p>
    <p>原本列「区分」を、売買と決済状態に分けて入力します。</p>
    {security}
    <Field row={row} name="repaymentTermLabel" label="弁済期限（原本表記）" onChange={change} />
    <Field row={row} name="designationLabel" label="指定表示（記載がある場合）" required={false} onChange={change} />
    <label>状態<select value={row.state} onChange={(e) => change('state', e.currentTarget.value)}>
      <option value="open">未決済</option>
      <option value="settled">決済ずみ</option>
    </select></label>
    <label>市場<select value={row.market} onChange={(e) => change('market', e.currentTarget.value)}>
      <option value="tokyo">東京</option><option value="private">私設取引システム</option>
      <option value="nagoya">名古屋</option><option value="fukuoka">福岡</option>
      <option value="sapporo">札幌</option>
    </select></label>
    <label>売買<select value={row.side} onChange={(e) => change('side', e.currentTarget.value)}>
      <option value="buy">買</option><option value="sell">売</option></select></label>
    <Field row={row} name="quantity" label="数量" onChange={change} />
    <Field row={row} name="contractDate" label="約定年月日" type="date" onChange={change} />
    <Field row={row} name="contractUnitPrice" label="約定単価" onChange={change} />
    <Field row={row} name="currentPrice" label="作成基準日現在の時価（記載がある場合）" required={false} onChange={change} />
    <Field row={row} name="fees" label="手数料その他経費（記載がある場合）" required={false} onChange={change} />
    <Field row={row} name="unrealizedPnl" label="評価損益（記載がある場合）" required={false} onChange={change} />
    <p>原本が空欄の項目は、値を推測せず空欄のまま保存します。</p>
    <Field row={row} name="finalSettlementOrPlannedDate"
      label="最終決済期日または決済予定日" type="date" onChange={change} /></>;
}

function rowsFromOcrCandidates(initial?: BalanceReportOcrCandidates): Record<SectionName, Draft[]> {
  return {
    deposits: [], collateral: [], margin: [],
    domesticStockLots: initial?.domesticStockLots.map((row) => ({
      securityCode: row.securityCode ?? '', securityName: row.securityName ?? '',
      acquisitionDate: row.acquisitionDate ?? '', quantity: row.quantity ?? '',
      rowKind: row.rowKind ?? 'acquisition_lot',
      acquisitionUnitPriceState: row.acquisitionUnitPriceState ?? 'reported',
      acquisitionUnitPrice: row.acquisitionUnitPrice ?? '',
      purchaseAmountState: row.purchaseAmountState ?? 'reported', purchaseAmount: row.purchaseAmount ?? '',
      referencePrice: row.referencePrice ?? '', evaluationAmount: row.evaluationAmount ?? '',
      sourcePage: row.sourcePage ?? '', sourceRow: row.sourceRow ?? '',
    })) ?? [],
    fundBalances: initial?.fundBalances.map((row) => ({
      securityCode: row.securityCode ?? '', securityName: row.securityName ?? '', units: row.units ?? '',
      referencePrice: row.referencePrice ?? '', referencePriceUnit: row.referencePriceUnit ?? '',
      evaluationAmount: row.evaluationAmount ?? '', sourcePage: row.sourcePage ?? '', sourceRow: row.sourceRow ?? '',
    })) ?? [],
  };
}

export default function BalanceReportPositionForm({ accounts, sourcePageCount, initialCandidates, onSaved }: {
  accounts: BalanceReportAccountSummary[];
  sourcePageCount: number;
  initialCandidates?: BalanceReportOcrCandidates;
  onSaved?: () => void;
}) {
  const [brokerAccountId, setBrokerAccountId] = useState(accounts[0]?.id ?? '');
  const [statementDate, setStatementDate] = useState('');
  const [modes, setModes] = useState<Record<SectionName, Mode>>(() => ({
    deposits: '',
    collateral: '',
    domesticStockLots: initialCandidates?.domesticStockLots.length ? 'rows' : '',
    fundBalances: initialCandidates?.fundBalances.length ? 'rows' : '',
    margin: '',
  }));
  const [rows, setRows] = useState<Record<SectionName, Draft[]>>(() => rowsFromOcrCandidates(initialCandidates));
  const [zeroLocators, setZeroLocators] = useState<Record<SectionName | 'futures' | 'options', Draft>>({
    deposits: { sourcePage: '', sourceRow: '' },
    collateral: { sourcePage: '', sourceRow: '' },
    domesticStockLots: { sourcePage: '', sourceRow: '' },
    fundBalances: { sourcePage: '', sourceRow: '' },
    margin: { sourcePage: '', sourceRow: '' },
    futures: { sourcePage: '', sourceRow: '' },
    options: { sourcePage: '', sourceRow: '' },
  });
  const [futures, setFutures] = useState<'' | 'zero' | 'nonzero'>('');
  const [options, setOptions] = useState<'' | 'zero' | 'nonzero'>('');
  const [reviewed, setReviewed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [saved, setSaved] = useState<SavedSnapshotSummary | null>(null);
  const generation = useRef(0);
  const activeSave = useRef<AbortController | null>(null);
  const saveInFlight = useRef(false);
  useEffect(() => () => activeSave.current?.abort(), []);

  function changed(action: () => void) {
    generation.current += 1;
    activeSave.current?.abort();
    setReviewed(false); setSaved(null); setMessage('');
    action();
  }
  function section(name: SectionName): ReactNode {
    return <details><summary>{titles[name]}</summary>
      <fieldset><legend>{titles[name]}の確認</legend>
        <label><input type="radio" name={`${name}-mode`} checked={modes[name] === 'zero'}
          onChange={() => changed(() => { setModes((v) => ({ ...v, [name]: 'zero' })); setRows((v) => ({ ...v, [name]: [] })); })} />
          この欄は0と確認した</label>
        <label><input type="radio" name={`${name}-mode`} checked={modes[name] === 'rows'}
          onChange={() => changed(() => { setModes((v) => ({ ...v, [name]: 'rows' })); setRows((v) => ({ ...v, [name]: v[name].length ? v[name] : [empty[name]()] })); })} />
          原本記載の明細を入力する</label>
        <label><input type="radio" name={`${name}-mode`} checked={modes[name] === 'missing'}
          onChange={() => changed(() => { setModes((v) => ({ ...v, [name]: 'missing' })); setRows((v) => ({ ...v, [name]: [] })); })} />
          {titles[name]}は原本に残高あり・今回は明細未入力</label>
        {modes[name] === 'missing' ? <p className="asset-warning">0件とは扱いません。未解決区分として保存し、資産概要にも未入力と表示します。</p> : null}
        {name === 'domesticStockLots' ? <p>取得明細だけを入力し、括弧付きの銘柄別合計行は二重計上になるため入力しません。</p> : null}
        {name === 'margin' ? <p>区分欄に従い、未決済または決済ずみを明細ごとに選択してください。</p> : null}
        {modes[name] === 'zero' ? <>
          <p>記載行は、対象区分の表で見出しを除いて上から数えた明細番号です。</p>
          <Field row={zeroLocators[name]} name="sourcePage" label={`${titles[name]}の0記載ページ`}
            type="number" max={sourcePageCount} onChange={(field, value) => changed(() =>
              setZeroLocators((all) => ({ ...all, [name]: { ...all[name], [field]: value } })))} />
          <Field row={zeroLocators[name]} name="sourceRow" label={`${titles[name]}の0記載行`}
            type="number" onChange={(field, value) => changed(() =>
              setZeroLocators((all) => ({ ...all, [name]: { ...all[name], [field]: value } })))} />
        </> : null}
        {modes[name] === 'rows' ? rows[name].map((row, index) => <fieldset key={index}>
          <legend>{titles[name]} {index + 1}</legend>
          <RowFields section={name} row={row} sourcePageCount={sourcePageCount}
            change={(field, value) => changed(() =>
            setRows((all) => ({ ...all, [name]: all[name].map((item, i) =>
              i === index ? { ...item, [field]: value } : item) })))} />
          <button type="button" onClick={() => changed(() => setRows((all) => ({
            ...all, [name]: all[name].filter((_, i) => i !== index),
          })))}>この明細を削除</button>
          {index > 0 ? <button type="button" onClick={() => changed(() => setRows((all) => {
            const next = [...all[name]]; [next[index - 1], next[index]] = [next[index], next[index - 1]];
            return { ...all, [name]: next };
          }))}>上へ移動</button> : null}
        </fieldset>) : null}
        {modes[name] === 'rows' && rows[name].length < 100 ? <button type="button"
          onClick={() => changed(() => setRows((v) => ({ ...v, [name]: [...v[name], empty[name]()] })))}>
          明細を追加</button> : null}
      </fieldset>
    </details>;
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saveInFlight.current || !reviewed || futures !== 'zero' || options !== 'zero'
      || Object.values(modes).some((mode) => !mode)) return;
    saveInFlight.current = true;
    const requestGeneration = generation.current;
    const controller = new AbortController();
    activeSave.current?.abort(); activeSave.current = controller;
    setSaving(true); setMessage('');
    const sectionPayload = (name: SectionName) => ({
      evidenceState: modes[name] === 'zero' ? 'explicit_zero' : modes[name] === 'missing' ? 'missing' : 'reported',
      zeroLocator: modes[name] === 'zero' ? {
        sourcePage: Number(zeroLocators[name].sourcePage),
        sourceRow: Number(zeroLocators[name].sourceRow),
      } : null,
      rows: modes[name] === 'zero' ? [] : rows[name].map((row) => {
        const result: Record<string, unknown> = { ...row,
          sourcePage: Number(row.sourcePage), sourceRow: Number(row.sourceRow) };
        for (const key of ['referencePrice', 'evaluationAmount', 'referencePriceUnit', 'currentPrice',
          'fees', 'unrealizedPnl', 'designationLabel']) {
          if (key in result && result[key] === '') result[key] = null;
        }
        if (name === 'domesticStockLots') {
          if (row.acquisitionUnitPriceState !== 'reported') result.acquisitionUnitPrice = null;
          if (row.purchaseAmountState !== 'reported') result.purchaseAmount = null;
        }
        return result;
      }),
    });
    try {
      const response = await fetch('/api/imports/sbi/full-balance-report-checkpoints', {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({
          brokerAccountId, statementDate, sourcePageCount, allRelevantPagesReviewed: true,
          evidence: { kind: 'generic_as_of', confirmation: 'manual' },
          deposits: sectionPayload('deposits'), collateral: sectionPayload('collateral'),
          domesticStockLots: sectionPayload('domesticStockLots'), fundBalances: sectionPayload('fundBalances'),
          margin: sectionPayload('margin'),
          futures: {
            evidenceState: 'explicit_zero',
            zeroLocator: {
              sourcePage: Number(zeroLocators.futures.sourcePage),
              sourceRow: Number(zeroLocators.futures.sourceRow),
            },
            rows: [],
          },
          options: {
            evidenceState: 'explicit_zero',
            zeroLocator: {
              sourcePage: Number(zeroLocators.options.sourcePage),
              sourceRow: Number(zeroLocators.options.sourceRow),
            },
            rows: [],
          },
        }),
      });
      const result = await response.json() as { checkpoint?: SavedSnapshotSummary; error?: { code?: string } };
      if (requestGeneration !== generation.current || controller.signal.aborted) return;
      if (!response.ok || !result.checkpoint) {
        setMessage(result.error?.code === 'invalid_checkpoint' ? '入力内容を確認してください。'
          : result.error?.code === 'invalid_account' ? '選択したSBI口座を確認できませんでした。'
            : '現在保存できません。時間をおいてもう一度お試しください。');
      } else {
        setSaved(result.checkpoint);
        onSaved?.();
        setMessage(response.status === 200 ? '同じ確認内容はすでに保存されています。' : '確認した残高を保存しました。');
      }
    } catch {
      if (requestGeneration === generation.current && !controller.signal.aborted) setMessage('保存できませんでした。通信状態を確認してください。');
    } finally {
      saveInFlight.current = false;
      if (requestGeneration === generation.current) setSaving(false);
    }
  }

  const unsupported = futures === 'nonzero' || options === 'nonzero';
  return <section className="safe-report-result" aria-labelledby="full-checkpoint-title">
    <h2 id="full-checkpoint-title">取引残高報告書を本人確認して保存</h2>
    <p>報告書基準日時点の汎用的な証拠です。開始残高・終了残高とは扱いません。</p>
    <p>PDFの生バイト、ファイル名、OCR出力、診断用の構造データはサーバーへ送信しません。ただし、このフォームへ入力またはOCR候補から反映し、本人が原本確認した値はサーバーへ送信され、保存されます。</p>
    {initialCandidates && countBalanceReportOcrCandidates(initialCandidates) > 0 ? (
      <p className="asset-warning">端末内OCRで完全に読めた国内株・投信だけを候補入力しました。OCRには誤認識があるため、保存前に全項目を原本と照合し、空欄のページ・行番号は原本から入力してください。</p>
    ) : null}
    <p className="asset-warning">0を選べるのは、対象区分が原本にあり、0と明記されている場合だけです。区分自体が原本に載っていない場合は、0として扱わず保存しません。</p>
    <form onSubmit={(event) => void save(event)}><fieldset disabled={saving}>
      <label>SBI口座<select value={brokerAccountId} onChange={(e) => changed(() => setBrokerAccountId(e.currentTarget.value))}>
        {accounts.map((account) => <option key={account.id} value={account.id}>{account.displayName}</option>)}
      </select></label>
      <label>報告書基準日<input type="date" required value={statementDate}
        onChange={(e) => changed(() => setStatementDate(e.currentTarget.value))} /></label>
      {(['deposits', 'collateral', 'domesticStockLots', 'fundBalances', 'margin'] as SectionName[])
        .map((name) => <Fragment key={name}>{section(name)}</Fragment>)}
      {([['futures', '先物'], ['options', 'オプション']] as const).map(([name, label]) => {
        const value = name === 'futures' ? futures : options;
        const setter = name === 'futures' ? setFutures : setOptions;
        return <fieldset key={name}><legend>{label}</legend>
          <label><input type="radio" name={name} checked={value === 'zero'} onChange={() => changed(() => setter('zero'))} />0と確認した</label>
          <label><input type="radio" name={name} checked={value === 'nonzero'} onChange={() => changed(() => setter('nonzero'))} />残高がある</label>
          {value === 'zero' ? <>
            <Field row={zeroLocators[name]} name="sourcePage" label={`${label}0記載ページ`}
              type="number" max={sourcePageCount} onChange={(field, next) => changed(() =>
                setZeroLocators((all) => ({ ...all, [name]: { ...all[name], [field]: next } })))} />
            <Field row={zeroLocators[name]} name="sourceRow" label={`${label}0記載行`}
              type="number" onChange={(field, next) => changed(() =>
                setZeroLocators((all) => ({ ...all, [name]: { ...all[name], [field]: next } })))} />
          </> : null}
        </fieldset>;
      })}
      {unsupported ? <p role="alert">先物・オプションの残高ありはこの版では未対応のため保存できません。0として扱いません。</p> : null}
      <label><input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.currentTarget.checked)} />
        関係する全ページを元の報告書で確認し、未入力区分は未解決として明示しました</label>
      <button type="submit" disabled={!reviewed || unsupported || futures !== 'zero' || options !== 'zero'
        || Object.values(modes).some((mode) => !mode)}>確認した残高証拠を保存</button>
    </fieldset></form>
    {message ? <p role="status">{message}</p> : null}
    {saved ? <p>直近の保存：{saved.statementDate}・{saved.unresolvedSectionCount
      ? `明細未入力の区分${saved.unresolvedSectionCount}件`
      : `明細${saved.rowCount ?? 0}件`}</p> : null}
  </section>;
}
