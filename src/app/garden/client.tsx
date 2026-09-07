"use client";
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  calculateGarden,
  validateGardenState,
  type GardenLot,
  type GardenState,
  type QuoteMap,
} from "@/garden/domain";
import { GardenView } from "./view";
import styles from "./garden.module.css";
const today = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(
    new Date(),
  );
const blank = (): GardenLot => ({
  id: crypto.randomUUID(),
  code: "",
  name: "",
  account: "nisa",
  shares: "",
  costPerShare: "",
  purchasedOn: null,
  confirmedOn: today(),
  purchaseDps: null,
  currentDps: null,
  priorYearDps: null,
  dividendAsOf: null,
  dividendSource: null,
  memo: "",
});
export default function GardenClient({
  initialState,
}: {
  initialState: GardenState;
}) {
  const [state, setState] = useState(initialState);
  const [quotes, setQuotes] = useState<QuoteMap>({});
  const [editing, setEditing] = useState<GardenLot | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [quoteMessage, setQuoteMessage] = useState("");
  const requestVersion = useRef(0);
  const saveLock = useRef(false);
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setQuoteMessage("");
    try {
      const r = await fetch("/api/garden/quotes", {
        cache: "no-store",
        credentials: "same-origin",
        signal: AbortSignal.timeout(45000),
      });
      if (!r.ok) throw new Error("quotes");
      const data = await r.json();
      if (version === requestVersion.current) {
        setQuotes(data.quotes ?? {});
        setQuoteMessage(
          data.failedCodes?.length
            ? "一部の株価を取得できませんでした。基準日と未取得表示を確認してください。"
            : "株価を確認しました。銘柄ごとの基準日を表示しています。",
        );
      }
    } catch {
      if (version === requestVersion.current)
        setQuoteMessage(
          "株価を更新できませんでした。表示中の価格は前回取得分です。基準日を確認してください。",
        );
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    return () => {
      requestVersion.current += 1;
    };
  }, [refresh]);
  const open = (lot?: GardenLot) => {
    if (saveLock.current) return;
    setEditing(lot ? { ...lot } : blank());
    setConfirmed(false);
    setMessage("");
    setError("");
  };
  async function persist(lots: GardenLot[]) {
    if (saveLock.current) return;
    saveLock.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const next = validateGardenState({ revision: state.revision, lots });
      const r = await fetch("/api/garden", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
        signal: AbortSignal.timeout(30000),
      });
      if (r.status === 409) {
        setError(
          "別の画面で更新されています。入力は残しています。別タブで最新の記録を確認してから、この画面を開き直してください。",
        );
        return;
      }
      if (r.status === 401) {
        setError(
          "ログインの有効期限が切れました。別タブでログインし直してください。入力はこの画面に残しています。",
        );
        return;
      }
      if (!r.ok) throw new Error("save");
      const saved = validateGardenState(await r.json());
      setState(saved);
      setEditing(null);
      setConfirmed(false);
      setMessage("保有記録を保存しました。");
      void refresh();
    } catch {
      setError(
        "保存を確認できませんでした。入力は残しています。数値・日付・配当の出典を確認してください。通信が途切れた場合は、別タブで保存状態を確認してください。",
      );
    } finally {
      saveLock.current = false;
      setBusy(false);
    }
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    if (saveLock.current || !editing || !confirmed) return;
    void persist(
      state.lots.some((l) => l.id === editing.id)
        ? state.lots.map((l) => (l.id === editing.id ? editing : l))
        : [...state.lots, editing],
    );
  }
  function remove() {
    if (saveLock.current || !editing) return;
    if (
      window.confirm(
        "この画面の保有記録を削除します。証券口座で売却は行いません。削除してよいですか？",
      )
    )
      void persist(state.lots.filter((l) => l.id !== editing.id));
  }
  function update(key: keyof GardenLot, value: string) {
    if (saveLock.current || !editing) return;
    const nullable = [
      "purchasedOn",
      "purchaseDps",
      "currentDps",
      "priorYearDps",
      "dividendAsOf",
      "dividendSource",
    ];
    setEditing({
      ...editing,
      [key]: nullable.includes(key) && value === "" ? null : value,
    });
    setConfirmed(false);
  }
  function input(
    label: string,
    key: keyof GardenLot,
    opts: {
      type?: string;
      required?: boolean;
      hint?: string;
      maxLength?: number;
    } = {},
  ) {
    return (
      <label key={key}>
        {label}
        <input
          aria-label={label}
          disabled={busy}
          type={opts.type ?? "text"}
          required={opts.required}
          value={editing?.[key] ?? ""}
          onChange={(e) => update(key, e.target.value)}
          maxLength={opts.maxLength ?? 32}
          inputMode={
            [
              "shares",
              "costPerShare",
              "purchaseDps",
              "currentDps",
              "priorYearDps",
            ].includes(key)
              ? "decimal"
              : undefined
          }
        />
        {opts.hint ? <small>{opts.hint}</small> : null}
      </label>
    );
  }
  const data = calculateGarden(state.lots, quotes);
  const editor = editing ? (
    <form className={styles.editor} onSubmit={submit}>
      <h2>
        {state.lots.some((l) => l.id === editing.id)
          ? "保有記録を編集"
          : "保有記録を追加"}
      </h2>
      <p>
        現在残っている株数を登録します。これは証券口座への注文ではありません。
      </p>
      <div className={styles.fields}>
        {input("銘柄コード", "code", { required: true, maxLength: 4 })}
        {input("銘柄名", "name", { required: true, maxLength: 100 })}
        <label>
          口座区分
          <select
            aria-label="口座区分"
            disabled={busy}
            value={editing.account}
            onChange={(e) => update("account", e.target.value)}
          >
            <option value="nisa">NISA</option>
            <option value="taxable">特定</option>
          </select>
        </label>
        {input("保有株数", "shares", {
          required: true,
          hint: "この購入分の残り株数。買い増しは別の記録にできます。",
        })}
        {input("取得単価（円）", "costPerShare", {
          required: true,
          hint: "現在の株式分割基準で入力してください。",
        })}
        {input("購入日（任意）", "purchasedOn", { type: "date" })}
        {input("保有情報の確認日", "confirmedOn", {
          type: "date",
          required: true,
        })}
      </div>
      <details open={editing.currentDps !== null}>
        <summary>配当の記録（分からなければ後から入力）</summary>
        <p className={styles.subnote}>
          年間の普通配当を1株あたりで入力します。記念・特別配当を除き、取得時・前年・最新を同じ株式分割基準に揃えてください。配当を入力するときは確認日と出典も必要です。
        </p>
        <div className={styles.fields}>
          {input("取得時の年間普通配当（円／株）", "purchaseDps")}
          {input("最新予想年間普通配当（円／株）", "currentDps")}
          {input("前年の年間普通配当（円／株）", "priorYearDps")}
          {input("配当の確認日", "dividendAsOf", { type: "date" })}
          {input("配当の出典", "dividendSource", {
            maxLength: 300,
            hint: "公式IRのURL・資料名など。ここには口座番号等を入れないでください。",
          })}
        </div>
      </details>
      <div className={styles.fields}>
        <label className={styles.wideField}>
          購入メモ
          <input
            aria-label="購入メモ"
            disabled={busy}
            value={editing.memo}
            maxLength={1000}
            onChange={(e) => update("memo", e.target.value)}
          />
        </label>
      </div>
      <label className={styles.confirm}>
        <input
          type="checkbox"
          disabled={busy}
          checked={confirmed}
          onChange={(e) => {
            if (!saveLock.current) setConfirmed(e.target.checked);
          }}
        />
        株数・取得単価を確認しました。配当を入力した場合は、普通配当と株式分割の基準も確認しました。本人専用のサーバー領域に保存します。
      </label>
      <div className={styles.formActions}>
        <button type="submit" disabled={!confirmed || busy}>
          {busy ? "保存中…" : "非公開で保存"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (saveLock.current) return;
            setEditing(null);
            setError("");
          }}
        >
          入力を閉じる
        </button>
        {state.lots.some((l) => l.id === editing.id) ? (
          <button
            className={styles.delete}
            type="button"
            disabled={busy}
            onClick={remove}
          >
            この記録を削除
          </button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
    </form>
  ) : null;
  return (
    <GardenView
      {...data}
      onEdit={open}
      editingDisabled={busy}
      editor={editor}
      actions={
        <>
          <button
            type="button"
            disabled={busy || editing !== null || state.lots.length >= 200}
            onClick={() => open()}
          >
            保有記録を追加
          </button>
          <button
            type="button"
            disabled={loading || busy}
            onClick={() => void refresh()}
          >
            {loading ? "株価を確認中…" : "株価を更新"}
          </button>
          <span>価格は閲覧時に自動確認 · 配当は本人入力</span>
          {message ? (
            <p role="status" className={styles.notice}>
              {message}
            </p>
          ) : null}
          {quoteMessage ? (
            <p role="status" className={styles.subnote}>
              {quoteMessage}
            </p>
          ) : null}
          {!editing && error ? (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          ) : null}
        </>
      }
    />
  );
}
