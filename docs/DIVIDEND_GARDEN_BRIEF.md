# 個別株の庭 — 実口座の保有モニター

User すてふぃー(steffie), Discord thread 1531116648449441945 authorized build. New route within existing Passkey/RLS app. No private holdings seeded from chat or virtual PF. No broker access/orders/AI analysis. Ivory, muted rose, sage, tiny floral line art; Monitor composition. Existing SBI import ledger untouched.

## Shared interface
src/garden/domain.ts exports:
GardenLot = { id:string(UUID), code:string(JPX 4-char), name:string, account:'nisa'|'taxable', shares:string, costPerShare:string, purchasedOn:string|null, confirmedOn:string, purchaseDps:string|null, currentDps:string|null, priorYearDps:string|null, dividendAsOf:string|null, dividendSource:string|null, memo:string }
GardenState = { revision:number, lots:GardenLot[] }
Quote = { code:string, close:string, date:string, source:string }
QuoteMap = Record<string, Quote>
calculateGarden(lots:GardenLot[], quotes:QuoteMap) -> {rows:GardenRow[], totals:GardenTotals}
GardenRow = { lot:GardenLot, quote:Quote|null, cost:number, value:number|null, pnl:number|null, pnlPct:number|null, annualDividend:number|null, yieldOnCost:number|null, currentYield:number|null, dividendGrowth:number|null, yearDividendGrowth:number|null }
GardenTotals = { cost:number, value:number|null, pnl:number|null, pnlPct:number|null, annualDividend:number|null, yieldOnCost:number|null, missingQuotes:number, missingDividends:number }
Financial inputs bounded decimal strings (shares positive integer), currency JPY only. Percents in percent units. Unknown/zero denominator => null. Missing ANY quote => full total value/pnl null, individual known values visible. Empty portfolio totals value/pnl/dividend null, not zero-assets claim. purchaseDps/currentDps/priorYearDps use same split-basis annual ordinary dividends, manual verification labelled, company forecast not received cash. Additional purchase does not count as DPS growth. purchasedOn nullable, confirmedOn required. Holding lots = current remaining shares with acquisition basis, NOT authoritative tax ledger. Changes mean explicit holding-record correction, not brokerage trade. Manual dividend source is provenance, NOT verified audit.

## APIs
GET /api/garden => GardenState authenticated no-store
PUT /api/garden body GardenState, CAS revision returns updated persisted state; max 200 lots, bounded request byte read, exact schema; origin/auth required, 409 stale save. Client never chooses owner.
GET /api/garden/quotes authenticated, server uses current principal lots' codes only => {quotes:QuoteMap, failedCodes:string[]}. Fixed Yahoo chart source, validate symbol/currency/data, last completed JST session (exclude today's bar before 15:30). No LLM. At least daily-safe public quote cache; don't shared-cache user holdings.
/garden protected server page passes initialState:GardenState to client. /garden/preview public SYNTHETIC read-only no forms/file picker or private API requests; shares presentation client demo=true.

## Work ownership
Backend child: src/garden/*, src/app/api/garden/*, additive src/db/schema.ts/drizzle, tests/garden-*.test.ts EXCEPT garden-ui.test.tsx.
Main: src/app/garden/client.tsx, garden.module.css, page.tsx, preview/page.tsx, tests/garden-ui.test.tsx, nav/header additions, release operations.
Strict vertical TDD. No full suite/build in child (focused max one worker). No unrelated edits or real secrets/data in Git.

## Daily refresh and initial scope
Numbers/quotes are code-only. Prices may refresh on view; unattended daily schedule only marked active after configured+exercised. Dividend updates manual initially, reuse audit later only if verified source integration exists. No invented historical curve. Whole historical equity reconstruction, automatic SBI sync, received dividend cash totals outside v1; state that honestly. Include lot purchase dates and charts of present allocations/dividend contribution (no fabricated history).

## Release
Immutable independent review, additive migration via existing protected production-migration workflow and dedicated secret, never runtime DB DDL. If manual reviewer approval blocks production, expose verified synthetic design preview + one concrete approval instruction. Code + test gates and source saved on branch. Production feature not complete until migration/deploy/auth/runtime verified.
