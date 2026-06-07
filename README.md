# PoE2 Currency Exchange Check

Desktop and Google Sheets tooling for one practical trade question:

> I have X. I want Y. Do I trade direct, or route through another currency and keep the leftover value?

The default example models `Perfect Exalted Orb -> Divine Orb` versus `Perfect Exalted Orb -> Exalted Orb -> Divine Orb`, but the app and sheet are built around POE2Scout currency IDs so other supported currencies can be selected too.

## What is included

- `app/` - Electron desktop app with a React/Vite renderer, shadcn-style local UI primitives, TanStack Query-backed IPC data fetching, POE2Scout catalog/snapshot refresh, optional official trade-site leg checks, manual rate overrides, searchable currency typeaheads, and bounded best-path search.
- `spreadsheet/poe2-currency-exchange-check.xlsx` - Google Sheets-ready static snapshot template.
- `spreadsheet/google-sheets-refresh.gs` - Apps Script companion that can call POE2Scout with `UrlFetchApp`, refresh sheet tabs, and install/remove a 15-minute snapshot auto-refresh trigger.

## Desktop quick start

```powershell
cd app
npm install
npm start
```

Useful checks:

```powershell
npm run check
npm audit --audit-level=low
```

`npm start` builds the Vite renderer first, then opens Electron.

## Google Sheets quick start

1. Upload `spreadsheet/poe2-currency-exchange-check.xlsx` to Google Drive and open it as Google Sheets.
2. Open `Extensions -> Apps Script`.
3. Paste `spreadsheet/google-sheets-refresh.gs` into the bound script project and save.
4. Reload the sheet.
5. Use the `PoE2 Arb` menu to refresh data or install auto-refresh.

The auto-refresh job updates snapshot pairs only every 15 minutes. Full catalog refresh remains manual so the sheet does not crawl every category on a timer.

## Why no OAuth in the desktop MVP?

The live desktop workflow uses POE2Scout and the trade-site exchange endpoint, neither of which benefits from a user login in this local app. Grinding Gear Games' documented Currency Exchange developer API is historical hourly data and uses the `service:cxapi` scope, which is for confidential clients, not public desktop clients. Keeping OAuth out of the MVP avoids client IDs, token storage, and a larger security surface.

See [docs/api-and-caching.md](docs/api-and-caching.md) for the API/caching notes.

## Security posture

- Electron renderer uses `nodeIntegration: false`, `contextIsolation: true`, and `sandbox: true`.
- Content Security Policy blocks remote scripts and unexpected embedding.
- IPC handlers validate the renderer URL.
- Navigation/new windows are blocked except for trusted external links opened in the system browser.
- Dependency installation is through `npm`; committed lockfile is included for the app.
- `npm audit --audit-level=low` is expected to pass for the current dependency set.

## License

MIT. This project is not affiliated with or endorsed by Grinding Gear Games.
