# Google Sheets Template

The workbook is a polished static snapshot model. The companion Apps Script makes a native Google Sheets copy live by calling POE2Scout with `UrlFetchApp`.

## Install the refresh script

1. Upload `poe2-currency-exchange-check.xlsx` to Google Drive.
2. Open it as Google Sheets.
3. Go to `Extensions -> Apps Script`.
4. Paste `google-sheets-refresh.gs` into the bound script project and save.
5. Reload the sheet and use the `PoE2 Arb` menu.

## Menu actions

- `Refresh all POE2Scout data` updates catalog currencies and snapshot pairs.
- `Refresh snapshot pairs only` updates current pair rates.
- `Refresh catalog only` updates currencies/categories.
- `Install auto-refresh (15 min)` creates a time-driven trigger for pair snapshots.
- `Remove auto-refresh` deletes the installed trigger.
- `Show auto-refresh status` writes status to the `Notes` sheet and shows a toast.

The scheduled trigger refreshes snapshot pairs only. That is intentional: current rates change often, while the full currency catalog is much heavier and rarely needs timed polling.
