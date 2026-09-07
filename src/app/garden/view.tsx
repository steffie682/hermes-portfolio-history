"use client";
import React, { useState, type ReactNode } from "react";
import type { GardenLot, GardenRow, GardenTotals } from "@/garden/domain";
import styles from "./garden.module.css";

export const yen = (n: number | null) =>
  n === null
    ? "—"
    : new Intl.NumberFormat("ja-JP", {
        style: "currency",
        currency: "JPY",
        maximumFractionDigits: 0,
      }).format(n);
const perShareYen = (n: number) =>
  new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 4,
  }).format(n);
const percent = (n: number | null, signed = false) =>
  n === null ? "未確認" : `${signed && n > 0 ? "+" : ""}${n.toFixed(2)}%`;
const day = (s: string | null) => (s ? s.replaceAll("-", "/") : "購入日未確認");
const sign = (n: number | null) => (n !== null && n > 0 ? "+" : "");
function Sprig() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 110 155"
      className={styles.sprig}
      fill="none"
    >
      <path
        d="M53 148C72 105 29 72 55 18M58 123C79 124 91 102 91 102C72 101 61 111 58 123ZM54 100C32 101 21 81 21 81C39 80 48 90 54 100ZM47 68C68 69 81 49 81 49C63 46 51 59 47 68ZM48 42C33 38 28 21 28 21C42 24 48 32 48 42Z"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      <path
        d="M55 18C45 11 45 3 52 5C59-2 66 5 62 12C68 20 60 23 55 18Z"
        stroke="currentColor"
        strokeWidth="1.1"
      />
      <path d="M89 24v8m-4-4h8M18 117v6m-3-3h6" stroke="currentColor" />
    </svg>
  );
}
export function GardenFrame({
  demo = false,
  children,
}: {
  demo?: boolean;
  children: ReactNode;
}) {
  return (
    <div id="garden-top" className={styles.garden}>
      <aside className={styles.sidebar}>
        <a className={styles.brand} href={demo ? "#garden-top" : "/garden"}>
          <span className={styles.brandMark}>✧</span>
          <span>
            株の庭<small>My little portfolio</small>
          </span>
        </a>
        <p className={styles.sidebarLabel}>わたしの記録</p>
        <nav aria-label="株の庭メニュー">
          <a
            className={styles.currentNav}
            href={demo ? "#garden-top" : "/garden"}
          >
            保有と配当
          </a>
          <a href="https://hermes-portfolio-history.vercel.app/portfolio">
            SBIの残高証拠
          </a>
          <a href="https://hermes-portfolio-history.vercel.app/settings/devices">
            ログイン端末
          </a>
        </nav>
        <div className={styles.sideBottom}>
          <Sprig />
          <p>
            毎日の値動きも、
            <br />
            配当の小さな成長も。
          </p>
          <span>{demo ? "デザインプレビュー" : "本人専用 · 非公開"}</span>
        </div>
      </aside>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
export function GardenView({
  rows,
  totals,
  demo = false,
  actions,
  editor,
  onEdit,
  editingDisabled = false,
}: {
  rows: GardenRow[];
  totals: GardenTotals;
  demo?: boolean;
  actions?: ReactNode;
  editor?: ReactNode;
  onEdit?: (lot: GardenLot) => void;
  editingDisabled?: boolean;
}) {
  const [tab, setTab] = useState<"holdings" | "dividends">("holdings");
  const [sort, setSort] = useState<"code" | "value" | "growth">("code");
  const sorted = [...rows].sort((a, b) =>
    sort === "value"
      ? (b.value ?? -Infinity) - (a.value ?? -Infinity)
      : sort === "growth"
        ? (b.dividendGrowth ?? -Infinity) - (a.dividendGrowth ?? -Infinity)
        : a.lot.code.localeCompare(b.lot.code),
  );
  const dates = [
    ...new Set(rows.flatMap((r) => (r.quote ? [r.quote.date] : []))),
  ].sort();
  const knownValue = rows.reduce((v, r) => v + (r.value ?? 0), 0);
  const colors = [
    "#a8727d",
    "#6c8978",
    "#c7af89",
    "#8c8499",
    "#8f9ea7",
    "#b79783",
  ];
  const portions = sorted
    .filter((r) => r.value !== null)
    .slice()
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const stops = portions.reduce<{ end: number; stops: string[] }>(
    (acc, r, i) => {
      const end = acc.end + ((r.value ?? 0) / (knownValue || 1)) * 100;
      return {
        end,
        stops: [
          ...acc.stops,
          `${colors[i % colors.length]} ${acc.end}% ${end}%`,
        ],
      };
    },
    { end: 0, stops: [] },
  ).stops;
  return (
    <GardenFrame demo={demo}>
      {demo ? (
        <div className={styles.demoBanner}>
          サンプル画面 ·
          架空の銘柄・数値です。実口座の情報ではありません。入力・保存はできません。
        </div>
      ) : null}
      <header className={styles.header}>
        <div>
          <p className={styles.overline}>MY DIVIDEND GARDEN</p>
          <h1>
            保有と配当の記録<span aria-hidden="true"> ✧</span>
          </h1>
          <p>増えていく配当を、ゆっくり眺める。</p>
        </div>
        <div className={styles.headerRight}>
          <span className={styles.privacy}>{demo ? "SAMPLE" : "PRIVATE"}</span>
          <span>
            {dates.length === 0
              ? "株価はまだ未取得"
              : dates.length === 1
                ? `${day(dates[0])} 終値`
                : `株価日 ${day(dates[0])}〜${day(dates.at(-1)!)}`}
          </span>
        </div>
      </header>
      <section className={styles.summary} aria-label="登録した個別株の集計">
        <div className={styles.mainMetric}>
          <span>登録株式の評価額</span>
          <strong>{yen(totals.value)}</strong>
          <p>取得総額 {rows.length ? yen(totals.cost) : "—"}</p>
          <p
            className={
              totals.pnl !== null && totals.pnl < 0 ? styles.loss : styles.gain
            }
          >
            含み損益 {sign(totals.pnl)}
            {yen(totals.pnl)} <span>{percent(totals.pnlPct, true)}</span>
          </p>
        </div>
        <div className={styles.dividendMetric}>
          <span>
            年間予想普通配当 <i aria-hidden="true">❧</i>
          </span>
          <strong>
            {yen(totals.annualDividend)}
            <small> / 年</small>
          </strong>
          <p>登録株数 × 入力済みの年間普通配当</p>
          <div className={styles.yield}>
            <span>取得利回り</span>
            <b>{percent(totals.yieldOnCost)}</b>
          </div>
        </div>
        <div className={styles.noteMetric}>
          <span className={styles.noteHeading}>この庭について</span>
          <strong>
            {new Set(rows.map((r) => r.lot.code)).size}
            <small> 銘柄</small>
          </strong>
          <p>{rows.length}件の保有記録</p>
          <p>
            値下がりだけでは、
            <br />
            購入理由を変えない。
          </p>
        </div>
      </section>
      {totals.valuationOverflow ? (
        <p role="alert" className={styles.warning}>
          評価額が計算上限を超えています。評価額・含み損益の全体合計は表示できません。保有記録は編集できます。
        </p>
      ) : null}
      {totals.missingQuotes > 0 ? (
        <p className={styles.warning}>
          株価未取得が{totals.missingQuotes}
          件あります。評価額・含み損益の全体合計は表示していません。
        </p>
      ) : null}
      {totals.missingDividends > 0 ? (
        <p className={styles.warning}>
          配当未入力が{totals.missingDividends}
          件あります。予想配当の全体合計は未確認です。
        </p>
      ) : null}
      {actions ? <div className={styles.actions}>{actions}</div> : null}
      {editor}
      <div className={styles.contentGrid}>
        <section className={styles.holdings}>
          <div className={styles.sectionTop}>
            <h2>庭の銘柄</h2>
            <label className={styles.sort}>
              並び順
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as typeof sort)}
              >
                <option value="code">銘柄コード</option>
                <option value="value">評価額が大きい順</option>
                <option value="growth">取得後増配率順</option>
              </select>
            </label>
          </div>
          <div className={styles.tabs} aria-label="表示切替">
            <button
              type="button"
              aria-pressed={tab === "holdings"}
              onClick={() => setTab("holdings")}
            >
              保有で見る
            </button>
            <button
              type="button"
              aria-pressed={tab === "dividends"}
              onClick={() => setTab("dividends")}
            >
              配当で見る
            </button>
          </div>
          {!rows.length ? (
            <div className={styles.empty}>
              <Sprig />
              <h3>まだ保有銘柄がありません</h3>
              <p>
                現在の株数と取得単価から、記録を始められます。
                <br />
                購入日や配当が分からない項目は、後から補えます。
              </p>
            </div>
          ) : (
            <div className={styles.lotList}>
              {sorted.map((r) => (
                <article key={r.lot.id} className={styles.lot}>
                  <div className={styles.lotHeading}>
                    <div>
                      <p>
                        <span className={styles.code}>{r.lot.code}</span>
                        <span className={styles.account}>
                          {r.lot.account === "nisa" ? "NISA" : "特定"}
                        </span>
                      </p>
                      <h3>{r.lot.name}</h3>
                    </div>
                    <div className={styles.lotRight}>
                      <b>
                        {Number(r.lot.shares).toLocaleString("ja-JP")}
                        <small> 株</small>
                      </b>
                      {onEdit && !demo ? (
                        <button
                          type="button"
                          onClick={() => onEdit(r.lot)}
                          disabled={editingDisabled}
                          aria-label={`${r.lot.name}の保有記録を編集`}
                        >
                          編集
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {tab === "holdings" ? (
                    <div className={styles.lotNumbers}>
                      <div>
                        <span>購入日</span>
                        <b>{day(r.lot.purchasedOn)}</b>
                      </div>
                      <div>
                        <span>取得単価</span>
                        <b>{perShareYen(Number(r.lot.costPerShare))}</b>
                      </div>
                      <div>
                        <span>終値</span>
                        <b>{r.quote ? perShareYen(Number(r.quote.close)) : "未取得"}</b>
                      </div>
                      <div>
                        <span>評価額</span>
                        <b>{yen(r.value)}</b>
                      </div>
                      <div>
                        <span>含み損益</span>
                        <b
                          className={
                            r.pnl !== null && r.pnl < 0
                              ? styles.loss
                              : styles.gain
                          }
                        >
                          {sign(r.pnl)}
                          {yen(r.pnl)}
                        </b>
                        <small>{percent(r.pnlPct, true)}</small>
                      </div>
                    </div>
                  ) : (
                    <div className={styles.lotNumbers}>
                      <div>
                        <span>年間予想普通配当</span>
                        <b>{yen(r.annualDividend)}</b>
                      </div>
                      <div>
                        <span>取得利回り</span>
                        <b>{percent(r.yieldOnCost)}</b>
                      </div>
                      <div>
                        <span>現在利回り</span>
                        <b>{percent(r.currentYield)}</b>
                      </div>
                      <div>
                        <span>取得後増配率</span>
                        <b>{percent(r.dividendGrowth, true)}</b>
                      </div>
                      <div>
                        <span>前年比増配率</span>
                        <b>{percent(r.yearDividendGrowth, true)}</b>
                      </div>
                    </div>
                  )}
                  {r.quote && r.value === null ? (
                    <p className={styles.warning}>
                      計算上限を超えたため、この記録の評価額・含み損益は表示できません。
                    </p>
                  ) : null}
                  <details className={styles.details}>
                    <summary>購入メモ・配当の根拠</summary>
                    <p>{r.lot.memo || "購入メモは未入力です。"}</p>
                    <dl>
                      <div>
                        <dt>保有情報の本人確認日</dt>
                        <dd>{day(r.lot.confirmedOn)}</dd>
                      </div>
                      <div>
                        <dt>株価の基準日</dt>
                        <dd>{r.quote ? day(r.quote.date) : "未取得"}</dd>
                      </div>
                      <div>
                        <dt>取得時の普通配当 / 株</dt>
                        <dd>
                          {r.lot.purchaseDps === null
                            ? "未確認"
                            : `${r.lot.purchaseDps}円`}
                        </dd>
                      </div>
                      <div>
                        <dt>最新予想普通配当 / 株</dt>
                        <dd>
                          {r.lot.currentDps === null
                            ? "未確認"
                            : `${r.lot.currentDps}円`}
                        </dd>
                      </div>
                      <div>
                        <dt>前年普通配当 / 株</dt>
                        <dd>
                          {r.lot.priorYearDps === null
                            ? "未確認"
                            : `${r.lot.priorYearDps}円`}
                        </dd>
                      </div>
                      <div>
                        <dt>配当の確認日</dt>
                        <dd>
                          {r.lot.dividendAsOf
                            ? day(r.lot.dividendAsOf)
                            : "未確認"}
                        </dd>
                      </div>
                    </dl>
                    <p className={styles.source}>
                      配当の出典（本人入力）：{r.lot.dividendSource || "未入力"}
                      。自動監査済みを意味しません。
                    </p>
                  </details>
                </article>
              ))}
            </div>
          )}
        </section>
        <aside className={styles.rightColumn}>
          <section className={styles.allocation}>
            <h2>庭のバランス</h2>
            <p>評価額による構成比</p>
            {totals.value !== null && totals.value > 0 ? (
              <>
                <div
                  className={styles.donut}
                  style={{ background: `conic-gradient(${stops.join(",")})` }}
                  role="img"
                  aria-label="保有記録ごとの評価額構成比"
                >
                  <div>
                    <b>{new Set(rows.map((r) => r.lot.code)).size}</b>
                    <span>銘柄</span>
                  </div>
                </div>
                <ul>
                  {portions.map((r, i) => (
                    <li key={r.lot.id}>
                      <span
                        style={{ background: colors[i % colors.length] }}
                        aria-hidden="true"
                      />
                      <span>
                        {r.lot.name}
                        <small>
                          {r.lot.account === "nisa" ? "NISA" : "特定"}
                        </small>
                      </span>
                      <b>{percent(((r.value ?? 0) / knownValue) * 100)}</b>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className={styles.allocationEmpty}>
                {totals.valuationOverflow ? (
                  "評価額が計算上限を超えているため、構成比は表示できません。"
                ) : (
                  <>全件の株価が揃うと<br />構成比を表示します。</>
                )}
              </p>
            )}
          </section>
          <section className={styles.readingNote}>
            <span aria-hidden="true">✧</span>
            <h2>配当の読み方</h2>
            <p>予想配当は、受取済み配当ではありません。</p>
            <p>
              取得後増配率は、同じ株式分割基準の「1株あたり普通配当」を比べます。買い増しによる配当総額の増加とは別の数字です。
            </p>
            <p>記念・特別配当は入力に含めません。</p>
          </section>
        </aside>
      </div>
      <footer className={styles.footer}>
        <p>
          取得単価・終値は小数第4位まで表示し、評価額・損益・年間予想配当などの金額は1円単位に四捨五入して表示しています。
        </p>
        <p>
          株価の基準日と、保有・配当情報の確認日は別です。登録範囲だけの集計で、証券口座の全資産・税務上の損益ではありません。
        </p>
        <p>売買の自動実行なし · 価格取得と計算にLLMは使用しません</p>
        <a href="https://hermes-portfolio-history.vercel.app/">
          資産履歴管理へ戻る
        </a>
      </footer>
    </GardenFrame>
  );
}
