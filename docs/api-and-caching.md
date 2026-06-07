# API and Caching Notes

Checked on 2026-06-07.

## Official developer API

Grinding Gear Games documents `https://api.pathofexile.com` as the developer API host. The documented Currency Exchange endpoint is:

```text
GET /currency-exchange[/<realm>][/<id>]
```

The docs list `poe2` as a valid realm for this endpoint. It returns aggregate Currency Exchange trade history grouped into hourly digests, and the docs note that current-hour data is not available through this endpoint.

The endpoint requires `service:cxapi`. GGG's authorization docs place `service:*` scopes under confidential clients with the client-credentials grant, while public desktop clients cannot use service scopes. That is why this repo does not include OAuth in the desktop MVP.

Sources:

- https://www.pathofexile.com/developer/docs/reference#currencyexchange
- https://www.pathofexile.com/developer/docs/authorization

## Desktop data flow

- POE2Scout catalog/categories/currencies: cached for 30 minutes.
- POE2Scout snapshot pairs: cached for 60 seconds.
- Official trade-site exchange leg checks: cached for 60 seconds per `league + have + want`.
- Duplicate in-flight requests are coalesced.
- Requests are queued per host.
- Official trade-site responses are inspected for `X-Rate-Limit-*` and `Retry-After` headers; when a limit is reported, the app delays later official calls locally.

The desktop app only checks the three selected official legs when the user presses `Official Listings`, which keeps it much lighter than broad scraping.

## Google Sheets data flow

- Apps Script uses `UrlFetchApp` and `CacheService`.
- Document lock prevents overlapping refreshes in the same sheet.
- Manual full refresh can update currencies and pairs.
- Scheduled auto-refresh updates snapshot pairs only every 15 minutes.
- The `Notes` sheet records refresh time, mode, auto-refresh state, and last auto run.

## Future backend option

A hosted backend could use a confidential OAuth client with `service:cxapi` for official hourly historical exchange data. That would be useful for trend/history views, but it would not replace POE2Scout or trade-site checks for current practical exchange decisions.
