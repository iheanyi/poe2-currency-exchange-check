# PoE2 Currency Arb

Small Electron app for answering one practical exchange question:

- I have `X`.
- I want `Y`.
- Should I trade direct, or trade through a middle currency and keep the leftovers?

The default example is:

- I have `2 Perfect Exalted Orbs`.
- I want `Divine Orbs`.
- Try through `Exalted Orbs`.

## Run

```powershell
npm install
npm start
```

Use npm for dependency installation. `npm start` builds the React/Vite renderer, then opens Electron. Do not copy `node_modules` between builds; if Electron launch files are missing or stale, run `npm install` again in this folder.

## UI stack

- React 19 + Vite renderer.
- TanStack Query for IPC-backed data fetching, cache freshness, and mutation state.
- Local shadcn-style UI primitives for buttons, cards, inputs, badges, and dense app layout.
- Searchable currency typeaheads that match name, API id, and category.
- Electron main/preload stay responsible for API calls, host queues, caching, and rate-limit backoff.

## Notes

- `Reload Catalog` loads leagues, categories, and all paged currency entries from POE2Scout.
- `Refresh Snapshot` uses one POE2Scout snapshot-pairs request for the selected league.
- `Optimize Paths` ranks possible trade paths. Use the allowlist when you only want paths through currencies you are willing to touch.
- `Official Listings` checks only the three selected legs, caches each leg for 60 seconds, and backs off on official trade API rate limits.
- `Buy in chunks of` defaults to `1`, so the app compares whole wanted-currency outcomes and keeps leftovers visible.
- The decision panel also shows raw fractional value. Use `Whole-package edge` for practical whole-currency trades, and `Raw value edge` for the pure value comparison before rounding.
- Manual fields always work, which is useful when the official API is rate-limited or a leg has no listed offers.
- Always confirm the final order in-game before committing the trade.

## Official API check

There are two official surfaces worth separating:

- `https://api.pathofexile.com/currency-exchange[/poe2][/<hour>]` is the documented developer API for hourly currency-exchange summaries. It requires OAuth and is not a live listing endpoint.
- `https://www.pathofexile.com/api/trade2/exchange/poe2/<league>` is the trade-site exchange endpoint used by the app for live listings. It returns rate-limit headers such as `X-Rate-Limit-Policy`, `X-Rate-Limit-Rules`, and `X-Rate-Limit-Ip-State`.

OAuth is intentionally out of the desktop MVP. POE2Scout and the trade-site exchange check do not need a user login, and skipping OAuth keeps the app easier to run and safer to publish.

## Cache strategy

- Realms: 15 minutes.
- Leagues: 10 minutes.
- POE2Scout catalog/categories/currencies: 30 minutes.
- POE2Scout snapshot pairs: 60 seconds.
- Official trade listing legs: 60 seconds per `league + have + want`.
- Duplicate in-flight requests are coalesced.
- Requests are queued per host. When official trade returns `X-Rate-Limit-*` headers, the app stores those buckets and locally delays future requests before crossing the returned rolling windows.

## Best paths

The desktop app can search for better trade paths:

- Nodes are currency ApiIds.
- Each POE2Scout snapshot pair becomes two directed edges with `to units / from unit` rates.
- Search tries short paths instead of only one manually selected middle currency.
- You can restrict the search to a small list of currencies.
- Results show the wanted currency first, then leftover currency from the last step.
- Ties on wanted currency are sorted by leftover value.
- Result cards also show rough liquidity hints from snapshot volume/stock.

The exported `.xlsx` is intentionally a static snapshot. A native Google Sheets copy can be made live with the companion Apps Script refresh action, which repopulates `Currencies` and `Pairs` in the same column shape.

## Security posture

- `npm audit` currently reports 0 vulnerabilities.
- The renderer runs with `nodeIntegration: false`, `contextIsolation: true`, and `sandbox: true`.
- A restrictive Content Security Policy is set in `index.html`.
- Permission prompts and webviews are denied.
- IPC handlers reject calls from unexpected renderer URLs.
- Unexpected navigation and new windows are blocked unless they target trusted `pathofexile.com` or `poe2scout.com` hosts through the system browser.
