import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import GardenClient from "../src/app/garden/client";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { GardenLot, GardenState } from "@/garden/domain";
import { GardenView } from "../src/app/garden/view";
import GardenPage from "../src/app/garden/page";
import nextConfig from "../next.config";

const editableLot: GardenLot = {
  id: "00000000-0000-4000-8000-000000000001", code: "123A", name: "合成の花",
  account: "nisa", shares: "3", costPerShare: "0.10", purchasedOn: null,
  confirmedOn: "2026-09-01", purchaseDps: null, currentDps: null,
  priorYearDps: null, dividendAsOf: null, dividendSource: null, memo: "",
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

it("locks editor synchronously through deferred PUT body completion without discarding another draft", async () => {
  const response = deferred<{ ok: boolean; status: number; json: () => Promise<GardenState> }>();
  const body = deferred<GardenState>();
  const other = { ...editableLot, id: "00000000-0000-4000-8000-000000000002", name: "別の合成の花" };
  const f = vi.fn(async (_url: string, options?: RequestInit) => options?.method === "PUT"
    ? response.promise : { ok: true, json: async () => ({ quotes: {}, failedCodes: [] }) });
  vi.stubGlobal("fetch", f);
  await act(async () => { render(<GardenClient initialState={{ revision: 0, lots: [editableLot, other] }} />); });
  fireEvent.click(screen.getByRole("button", { name: "合成の花の保有記録を編集" }));
  fireEvent.change(screen.getByLabelText("購入メモ"), { target: { value: "保存する下書き" } });
  fireEvent.click(screen.getByRole("checkbox"));
  const form = screen.getByLabelText("購入メモ").closest("form")!;
  // Same React batch: disabled props have not committed yet; handlers need a ref guard.
  act(() => {
    fireEvent.submit(form);
    fireEvent.change(screen.getByLabelText("購入メモ"), { target: { value: "保存中の変更" } });
    fireEvent.change(screen.getByLabelText("口座区分"), { target: { value: "taxable" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "別の合成の花の保有記録を編集" }));
    fireEvent.click(screen.getByRole("button", { name: "入力を閉じる" }));
    fireEvent.submit(form);
  });
  expect((screen.getByLabelText("購入メモ") as HTMLInputElement).value).toBe("保存する下書き");
  expect((screen.getByLabelText("口座区分") as HTMLSelectElement).value).toBe("nisa");
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  for (const control of form.querySelectorAll("input, select, button")) {
    expect(control.hasAttribute("disabled")).toBe(true);
  }
  for (const edit of screen.getAllByRole("button", { name: /の保有記録を編集/ })) {
    expect(edit.hasAttribute("disabled")).toBe(true);
  }
  expect(f.mock.calls.filter((c) => c[1]?.method === "PUT")).toHaveLength(1);
  await act(async () => { response.resolve({ ok: true, status: 200, json: () => body.promise }); });
  expect(screen.getByRole("button", { name: "保存中…" }).hasAttribute("disabled")).toBe(true);
  expect((screen.getByLabelText("購入メモ") as HTMLInputElement).value).toBe("保存する下書き");
  const sent = JSON.parse(f.mock.calls.find((c) => c[1]?.method === "PUT")![1]!.body as string);
  await act(async () => { body.resolve({ ...sent, revision: 1 }); });
  expect(screen.getByText("保有記録を保存しました。")).toBeTruthy();
  expect(screen.queryByLabelText("購入メモ")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "合成の花の保有記録を編集" }));
  expect((screen.getByLabelText("購入メモ") as HTMLInputElement).value).toBe("保存する下書き");
  expect(screen.getByLabelText("購入メモ").hasAttribute("disabled")).toBe(false);
});
it.each([
  [409, /別の画面で更新されています/],
  [401, /ログインの有効期限が切れました/],
  [500, /保存を確認できませんでした/],
] as const)("preserves draft and error and unlocks after deferred PUT failure %s", async (status, message) => {
  const response = deferred<{ ok: boolean; status: number }>();
  vi.stubGlobal("fetch", vi.fn(async (_url: string, options?: RequestInit) => options?.method === "PUT"
    ? response.promise : { ok: true, json: async () => ({ quotes: {}, failedCodes: [] }) }));
  await act(async () => { render(<GardenClient initialState={{ revision: 0, lots: [editableLot] }} />); });
  fireEvent.click(screen.getByRole("button", { name: "合成の花の保有記録を編集" }));
  fireEvent.change(screen.getByLabelText("購入メモ"), { target: { value: "失敗時も残す下書き" } });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "非公開で保存" }));
  expect(screen.getByLabelText("購入メモ").hasAttribute("disabled")).toBe(true);
  await act(async () => { response.resolve({ ok: false, status }); });
  expect(screen.getByRole("alert").textContent).toMatch(message);
  expect((screen.getByLabelText("購入メモ") as HTMLInputElement).value).toBe("失敗時も残す下書き");
  expect(screen.queryByText("保有記録を保存しました。")).toBeNull();
  expect(screen.getByRole("button", { name: "非公開で保存" }).hasAttribute("disabled")).toBe(false);
  fireEvent.change(screen.getByLabelText("購入メモ"), { target: { value: "修正した下書き" } });
  expect((screen.getByLabelText("購入メモ") as HTMLInputElement).value).toBe("修正した下書き");
  expect(screen.getByRole("alert").textContent).toMatch(message);
});

it.each(["row", "aggregate"] as const)("keeps editing usable with an explicit %s valuation overflow warning after quotes arrive", async (kind) => {
  const lots = kind === "row"
    ? [{ ...editableLot, shares: "1000000", costPerShare: "100000" }]
    : [
        { ...editableLot, shares: "1000000", costPerShare: "50000" },
        { ...editableLot, id: "00000000-0000-4000-8000-000000000002", name: "別の合成の花", shares: "1000000", costPerShare: "50000" },
      ];
  const response = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
  vi.stubGlobal("fetch", vi.fn(() => response.promise));
  render(<GardenClient initialState={{ revision: 0, lots }} />);
  fireEvent.click(screen.getByRole("button", { name: "合成の花の保有記録を編集" }));
  fireEvent.change(screen.getByLabelText("購入メモ"), { target: { value: "株価待ちの下書き" } });
  await act(async () => {
    response.resolve({ ok: true, json: async () => ({
      quotes: { "123A": { code: "123A", close: kind === "row" ? "1000000" : "100000", date: "2026-09-04", source: "Synthetic" } },
      failedCodes: [],
    }) });
  });
  expect(screen.getByText(/評価額が計算上限を超えています/)).toBeTruthy();
  expect(screen.queryByText(/株価未取得が/)).toBeNull();
  const summary = screen.getByRole("region", { name: "登録した個別株の集計" });
  expect(summary.querySelector("strong")?.textContent).toBe("—");
  expect(summary.textContent).toContain("含み損益 —");
  expect(screen.queryByRole("img", { name: "保有記録ごとの評価額構成比" })).toBeNull();
  expect(screen.getByText("評価額が計算上限を超えているため、構成比は表示できません。")).toBeTruthy();
  if (kind === "row") expect(screen.getByText(/この記録の評価額・含み損益は表示できません/)).toBeTruthy();
  expect((screen.getByLabelText("購入メモ") as HTMLInputElement).value).toBe("株価待ちの下書き");
  fireEvent.change(screen.getByLabelText("保有株数"), { target: { value: "1" } });
  expect((screen.getByLabelText("保有株数") as HTMLInputElement).value).toBe("1");
  fireEvent.click(screen.getByRole("checkbox"));
  expect(screen.getByRole("button", { name: "非公開で保存" }).hasAttribute("disabled")).toBe(false);
});

it.each([
  ["0.10", "0.30", "￥0.1", "￥0.3", "￥0"],
  ["0.0001", "0.0002", "￥0.0001", "￥0.0002", "￥0"],
  ["1234.5678", "1500.0001", "￥1,234.5678", "￥1,500.0001", "￥1,500"],
])("preserves fractional per-share cost %s and quote %s in the holding display", async (costPerShare, close, costText, quoteText, totalText) => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({
    quotes: { "123A": { code: "123A", close, date: "2026-09-04", source: "Synthetic" } }, failedCodes: [],
  }) })));
  await act(async () => {
    render(<GardenClient initialState={{ revision: 0, lots: [{ ...editableLot, shares: "1", costPerShare }] }} />);
  });
  expect(screen.getByText("取得単価").parentElement?.querySelector("b")?.textContent).toBe(costText);
  expect(screen.getByText("終値").parentElement?.querySelector("b")?.textContent).toBe(quoteText);
  expect(screen.getByRole("region", { name: "登録した個別株の集計" }).querySelector("strong")?.textContent).toBe(totalText);
  expect(screen.getByText(/金額は1円単位に四捨五入/)).toBeTruthy();
});

it("sets no-store and a restrictive same-origin policy for private garden routes", async () => {
  const headers = await nextConfig.headers!();
  for (const path of ["/garden/:path*", "/api/garden/:path*"]) {
    const rule = headers.find((h) => h.source === path);
    expect(rule).toBeTruthy();
    expect(rule!.headers).toContainEqual({
      key: "Cache-Control",
      value: "private, no-store",
    });
    expect(
      rule!.headers.find((h) => h.key === "Content-Security-Policy")?.value,
    ).toContain("frame-ancestors 'none'");
  }
});
const pageMocks = vi.hoisted(() => ({
  principal: vi.fn(),
  load: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
}));
vi.mock("@/auth/page-session", () => ({
  resolvePageSessionPrincipal: pageMocks.principal,
}));
vi.mock("@/db/client", () => ({ getDatabase: () => ({}) }));
vi.mock("@/garden/repository", () => ({
  createGardenRepository: () => ({ load: pageMocks.load }),
}));
vi.mock("next/navigation", () => ({ redirect: pageMocks.redirect }));
it("blocks the private page before loading any holdings when logged out", async () => {
  pageMocks.principal.mockResolvedValue(null);
  pageMocks.load.mockClear();
  await expect(GardenPage()).rejects.toThrow("REDIRECT");
  expect(pageMocks.redirect).toHaveBeenCalledWith("/login");
  expect(pageMocks.load).not.toHaveBeenCalled();
});
it("loads only the authenticated principal garden on the private page", async () => {
  const principal = { test: "opaque-only-in-test" };
  pageMocks.principal.mockResolvedValue(principal);
  pageMocks.load.mockResolvedValue({ revision: 0, lots: [] });
  const page = await GardenPage();
  expect(pageMocks.load).toHaveBeenCalledWith(principal);
  expect(page.props.initialState).toEqual({ revision: 0, lots: [] });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("requires confirmation before saving a manual holding with unknown dates preserved", async () => {
  const f = vi.fn(async (_url: string, options?: RequestInit) =>
    options?.method === "PUT"
      ? {
          ok: true,
          status: 200,
          json: async () => ({
            ...JSON.parse(options.body as string),
            revision: 1,
          }),
        }
      : {
          ok: true,
          status: 200,
          json: async () => ({ quotes: {}, failedCodes: [] }),
        },
  );
  vi.stubGlobal("fetch", f);
  render(<GardenClient initialState={{ revision: 0, lots: [] }} />);
  fireEvent.click(screen.getByRole("button", { name: "保有記録を追加" }));
  fireEvent.change(screen.getByLabelText("銘柄コード"), {
    target: { value: "1234" },
  });
  fireEvent.change(screen.getByLabelText("銘柄名"), {
    target: { value: "確認用商事" },
  });
  fireEvent.change(screen.getByLabelText("保有株数"), {
    target: { value: "100" },
  });
  fireEvent.change(screen.getByLabelText("取得単価（円）"), {
    target: { value: "1234.5" },
  });
  fireEvent.change(screen.getByLabelText("保有情報の確認日"), {
    target: { value: "2026-09-04" },
  });
  expect(
    screen
      .getByRole("button", { name: "非公開で保存" })
      .hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "非公開で保存" }));
  expect(await screen.findByText("保有記録を保存しました。")).toBeTruthy();
  const write = f.mock.calls.find((c) => c[1]?.method === "PUT");
  expect(write).toBeTruthy();
  const saved = JSON.parse(write![1]!.body as string);
  expect(saved.revision).toBe(0);
  expect(saved.lots[0].purchasedOn).toBeNull();
  expect(saved.lots[0].currentDps).toBeNull();
  expect(saved.lots[0].shares).toBe("100");
  expect(saved.lots[0].costPerShare).toBe("1234.5");
});
it("keeps edits on a revision conflict and does not claim save success", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, options?: RequestInit) =>
      options?.method === "PUT"
        ? { ok: false, status: 409, json: async () => ({ error: "Conflict" }) }
        : {
            ok: true,
            status: 200,
            json: async () => ({ quotes: {}, failedCodes: [] }),
          },
    ),
  );
  render(<GardenClient initialState={{ revision: 0, lots: [] }} />);
  fireEvent.click(screen.getByRole("button", { name: "保有記録を追加" }));
  for (const [label, value] of [
    ["銘柄コード", "1234"],
    ["銘柄名", "残す入力"],
    ["保有株数", "100"],
    ["取得単価（円）", "1000"],
    ["保有情報の確認日", "2026-09-04"],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "非公開で保存" }));
  expect(await screen.findByText(/別の画面で更新されています/)).toBeTruthy();
  expect((screen.getByLabelText("銘柄名") as HTMLInputElement).value).toBe(
    "残す入力",
  );
  expect(screen.queryByText("保有記録を保存しました。")).toBeNull();
});
const totals = {
  cost: 0,
  value: null,
  pnl: null,
  pnlPct: null,
  annualDividend: null,
  yieldOnCost: null,
  missingQuotes: 0,
  missingDividends: 0,
};
describe("personal dividend garden presentation", () => {
  it("labels synthetic preview and shows an honest empty state, not invented assets", () => {
    render(<GardenView rows={[]} totals={totals} demo />);
    expect(screen.getByText(/サンプル画面/)).toBeTruthy();
    expect(screen.getByText("まだ保有銘柄がありません")).toBeTruthy();
    expect(screen.queryByText("￥0")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
  it("renders lot purchase dates, unknown dividend and loss without calling them zero", () => {
    const lot = {
      id: "11111111-1111-4111-8111-111111111111",
      code: "1234",
      name: "テスト商事",
      account: "nisa" as const,
      shares: "100",
      costPerShare: "1000",
      purchasedOn: "2026-08-01",
      confirmedOn: "2026-09-04",
      purchaseDps: null,
      currentDps: null,
      priorYearDps: null,
      dividendAsOf: null,
      dividendSource: null,
      memo: "購入の理由",
    };
    const row = {
      lot,
      quote: {
        code: "1234",
        close: "900",
        date: "2026-09-04",
        source: "https://finance.yahoo.com",
      },
      cost: 100000,
      value: 90000,
      pnl: -10000,
      pnlPct: -10,
      annualDividend: null,
      yieldOnCost: null,
      currentYield: null,
      dividendGrowth: null,
      yearDividendGrowth: null,
    };
    render(
      <GardenView
        rows={[row]}
        totals={{
          ...totals,
          cost: 100000,
          value: 90000,
          pnl: -10000,
          pnlPct: -10,
          missingDividends: 1,
        }}
        demo
      />,
    );
    expect(screen.getAllByText("テスト商事").length).toBeGreaterThan(0);
    expect(screen.getByText("2026/08/01")).toBeTruthy();
    expect(screen.getAllByText(/-￥10,000/).length).toBeGreaterThan(0);
    expect(screen.getByText(/配当未入力/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "配当で見る" }));
    expect(screen.getByText("前年比増配率")).toBeTruthy();
    expect(screen.getByText(/受取済み配当ではありません/)).toBeTruthy();
  });
});
