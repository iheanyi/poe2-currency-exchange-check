const POE2SCOUT_API = 'https://api.poe2scout.com';
const DEFAULT_REALM = 'poe2';
const DEFAULT_LEAGUE = 'Runes of Aldur';
const DEFAULT_PER_PAGE = 250;
const CACHE_MAX_CHARS = 90000;
const AUTO_REFRESH_HANDLER = 'refreshPoe2ScoutAuto';
const AUTO_REFRESH_MINUTES = 15;

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('PoE2 Arb')
    .addItem('Refresh all POE2Scout data', 'refreshPoe2ScoutAll')
    .addItem('Refresh snapshot pairs only', 'refreshPoe2ScoutPairs')
    .addItem('Refresh catalog only', 'refreshPoe2ScoutCatalog')
    .addSeparator()
    .addItem('Install auto-refresh (15 min)', 'installPoe2AutoRefresh')
    .addItem('Remove auto-refresh', 'removePoe2AutoRefresh')
    .addItem('Show auto-refresh status', 'showPoe2AutoRefreshStatus')
    .addToUi();
}

function refreshPoe2ScoutAll() {
  return withPoe2Lock_(function () {
    const spreadsheet = SpreadsheetApp.getActive();
    const league = getLeague_(spreadsheet);
    const categories = fetchCategories_(league, false);
    const currencies = fetchCurrencies_(league, categories, false);
    const directionalPairs = makeDirectionalPairs_(fetchSnapshotPairs_(league, true));

    writeCurrencies_(spreadsheet, currencies);
    writePairs_(spreadsheet, directionalPairs);
    repairCalculator_(spreadsheet);
    stampNotes_(spreadsheet, league, categories.length, currencies.length, directionalPairs.length, 'Manual full refresh');
    SpreadsheetApp.flush();
  });
}

function refreshPoe2ScoutPairs() {
  return withPoe2Lock_(function () {
    return refreshPoe2ScoutPairs_(SpreadsheetApp.getActive(), 'Manual snapshot refresh');
  });
}

function refreshPoe2ScoutCatalog() {
  return withPoe2Lock_(function () {
    const spreadsheet = SpreadsheetApp.getActive();
    const league = getLeague_(spreadsheet);
    const categories = fetchCategories_(league, false);
    const currencies = fetchCurrencies_(league, categories, false);

    writeCurrencies_(spreadsheet, currencies);
    repairCalculator_(spreadsheet);
    stampNotes_(spreadsheet, league, categories.length, currencies.length, null, 'Manual catalog refresh');
    SpreadsheetApp.flush();
  });
}

function refreshPoe2ScoutAuto() {
  return withPoe2Lock_(function () {
    const count = refreshPoe2ScoutPairs_(SpreadsheetApp.getActive(), 'Auto snapshot refresh');
    PropertiesService.getDocumentProperties().setProperty('POE2_AUTO_REFRESH_LAST_RUN', new Date().toISOString());
    return count;
  });
}

function installPoe2AutoRefresh() {
  return withPoe2Lock_(function () {
    removeTriggersByHandler_(AUTO_REFRESH_HANDLER);
    const trigger = ScriptApp.newTrigger(AUTO_REFRESH_HANDLER)
      .timeBased()
      .everyMinutes(AUTO_REFRESH_MINUTES)
      .create();

    const properties = PropertiesService.getDocumentProperties();
    properties.setProperty('POE2_AUTO_REFRESH', 'on');
    properties.setProperty('POE2_AUTO_REFRESH_MINUTES', String(AUTO_REFRESH_MINUTES));
    properties.setProperty('POE2_AUTO_REFRESH_TRIGGER_UID', trigger.getUniqueId ? trigger.getUniqueId() : '');
    properties.setProperty('POE2_AUTO_REFRESH_UPDATED', new Date().toISOString());

    const spreadsheet = SpreadsheetApp.getActive();
    stampNotes_(spreadsheet, getLeague_(spreadsheet), null, null, null, 'Auto refresh installed');
    SpreadsheetApp.flush();
    toast_('POE2Scout pairs will refresh about every ' + AUTO_REFRESH_MINUTES + ' minutes.', 'PoE2 Arb');
  });
}

function removePoe2AutoRefresh() {
  return withPoe2Lock_(function () {
    const removed = removeTriggersByHandler_(AUTO_REFRESH_HANDLER);
    const properties = PropertiesService.getDocumentProperties();
    properties.setProperty('POE2_AUTO_REFRESH', 'off');
    properties.setProperty('POE2_AUTO_REFRESH_UPDATED', new Date().toISOString());

    const spreadsheet = SpreadsheetApp.getActive();
    stampNotes_(spreadsheet, getLeague_(spreadsheet), null, null, null, 'Auto refresh removed');
    SpreadsheetApp.flush();
    toast_('Removed ' + removed + ' auto-refresh trigger' + (removed === 1 ? '' : 's') + '.', 'PoE2 Arb');
  });
}

function showPoe2AutoRefreshStatus() {
  const spreadsheet = SpreadsheetApp.getActive();
  stampNotes_(spreadsheet, getLeague_(spreadsheet), null, null, null, 'Status check');
  SpreadsheetApp.flush();
  toast_(getAutoRefreshStatus_(), 'PoE2 Arb auto-refresh');
}

function refreshPoe2ScoutPairs_(spreadsheet, refreshMode) {
  const league = getLeague_(spreadsheet);
  const directionalPairs = makeDirectionalPairs_(fetchSnapshotPairs_(league, true));

  writePairs_(spreadsheet, directionalPairs);
  repairCalculator_(spreadsheet);
  stampNotes_(spreadsheet, league, null, null, directionalPairs.length, refreshMode);
  SpreadsheetApp.flush();
  return directionalPairs.length;
}

function withPoe2Lock_(callback) {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) {
    throw new Error('Another POE2Scout refresh is already running for this sheet.');
  }
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function getLeague_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName('Calculator');
  const value = sheet ? String(sheet.getRange('B4').getDisplayValue()).trim() : '';
  return value || DEFAULT_LEAGUE;
}

function poe2ScoutUrl_(parts, params) {
  const url = POE2SCOUT_API + '/' + parts.map(encodeURIComponent).join('/');
  const query = [];
  Object.keys(params || {}).forEach(function (key) {
    const value = params[key];
    if (value !== undefined && value !== null && value !== '') {
      query.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
    }
  });
  return query.length ? url + '?' + query.join('&') : url;
}

function fetchJson_(url, ttlSeconds, forceFresh) {
  const cache = CacheService.getDocumentCache();
  const key = cacheKey_(url);
  if (!forceFresh) {
    const cached = cache.get(key);
    if (cached) return JSON.parse(cached);
  }

  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true,
    headers: {
      Accept: 'application/json',
      'User-Agent': 'poe2-currency-arb-google-sheets/0.1.0 (local)'
    }
  });
  const code = response.getResponseCode();
  const text = response.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('POE2Scout request failed: HTTP ' + code + ' for ' + url + ' - ' + text.slice(0, 300));
  }
  if (ttlSeconds > 0 && text.length <= CACHE_MAX_CHARS) {
    cache.put(key, text, ttlSeconds);
  }
  return JSON.parse(text);
}

function cacheKey_(value) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value);
  return 'poe2:' + Utilities.base64EncodeWebSafe(bytes).slice(0, 42);
}

function fetchCategories_(league, forceFresh) {
  const data = fetchJson_(
    poe2ScoutUrl_([DEFAULT_REALM, 'Leagues', league, 'Items', 'Categories']),
    1800,
    forceFresh
  );
  return Array.isArray(data.CurrencyCategories) ? data.CurrencyCategories : [];
}

function fetchCurrencies_(league, categories, forceFresh) {
  const rows = [];
  const seen = {};
  categories.forEach(function (category) {
    let page = 1;
    let pages = 1;
    do {
      const data = fetchJson_(
        poe2ScoutUrl_([DEFAULT_REALM, 'Leagues', league, 'Currencies', 'ByCategory'], {
          Category: category.ApiId,
          Page: page,
          PerPage: DEFAULT_PER_PAGE
        }),
        1800,
        forceFresh
      );
      (Array.isArray(data.Items) ? data.Items : []).forEach(function (item) {
        if (!item.ApiId || seen[item.ApiId]) return;
        seen[item.ApiId] = true;
        rows.push([
          item.ApiId,
          item.Text || item.ApiId,
          item.CategoryApiId || category.ApiId || '',
          category.Label || category.ApiId || '',
          toNumber_(item.CurrentPrice),
          toNumber_(item.CurrentQuantity),
          item.IconUrl || '',
          item.CurrencyItemId || '',
          item.ItemId || ''
        ]);
      });
      pages = Number(data.Pages) || 1;
      page += 1;
      Utilities.sleep(250);
    } while (page <= pages);
  });
  rows.sort(function (a, b) {
    return String(a[1]).localeCompare(String(b[1]));
  });
  return rows;
}

function fetchSnapshotPairs_(league, forceFresh) {
  const pairs = fetchJson_(
    poe2ScoutUrl_([DEFAULT_REALM, 'Leagues', league, 'SnapshotPairs']),
    60,
    forceFresh
  );
  return Array.isArray(pairs) ? pairs : [];
}

function makeDirectionalPairs_(pairs) {
  const rows = [];
  pairs.forEach(function (pair) {
    const one = pair.CurrencyOne || {};
    const two = pair.CurrencyTwo || {};
    const oneRelative = toNumber_(pair.CurrencyOneData && pair.CurrencyOneData.RelativePrice);
    const twoRelative = toNumber_(pair.CurrencyTwoData && pair.CurrencyTwoData.RelativePrice);
    if (!one.ApiId || !two.ApiId || !oneRelative || !twoRelative) return;

    rows.push(makePairRow_(pair, one, two, oneRelative / twoRelative, 'CurrencyOneData', 'CurrencyTwoData'));
    rows.push(makePairRow_(pair, two, one, twoRelative / oneRelative, 'CurrencyTwoData', 'CurrencyOneData'));
  });
  rows.sort(function (a, b) {
    return String(a[0]).localeCompare(String(b[0]));
  });
  return rows;
}

function makePairRow_(pair, from, to, rate, fromDataKey, toDataKey) {
  const fromData = pair[fromDataKey] || {};
  const toData = pair[toDataKey] || {};
  return [
    from.ApiId + '|' + to.ApiId,
    from.ApiId,
    from.Text || from.ApiId,
    to.ApiId,
    to.Text || to.ApiId,
    rate,
    pair.CurrencyExchangeSnapshotPairId || '',
    toNumber_(pair.Volume),
    toNumber_(fromData.VolumeTraded),
    toNumber_(toData.VolumeTraded),
    toNumber_(fromData.HighestStock),
    toNumber_(toData.HighestStock),
    pair.CurrencyExchangeSnapshotId || ''
  ];
}

function writeCurrencies_(spreadsheet, rows) {
  const sheet = getOrCreateSheet_(spreadsheet, 'Currencies');
  const headers = [['ApiId', 'Text', 'CategoryApiId', 'Category', 'CurrentPrice', 'CurrentQuantity', 'IconUrl', 'CurrencyItemId', 'ItemId']];
  writeTable_(sheet, 2, 1, headers[0].length, headers.concat(rows));
  sheet.getRange(2, 1, 1, headers[0].length).setFontWeight('bold').setBackground('#16323A').setFontColor('#FFFFFF');
  sheet.getRange(3, 5, Math.max(1, rows.length), 2).setNumberFormat('0.00');
}

function writePairs_(spreadsheet, rows) {
  const sheet = getOrCreateSheet_(spreadsheet, 'Pairs');
  const headers = [[
    'Key', 'FromApiId', 'From', 'ToApiId', 'To', 'Rate', 'PairId',
    'VolumeBaseValue', 'FromVolume', 'ToVolume', 'FromStock', 'ToStock', 'SnapshotId'
  ]];
  writeTable_(sheet, 2, 1, headers[0].length, headers.concat(rows));
  sheet.getRange(2, 1, 1, headers[0].length).setFontWeight('bold').setBackground('#16323A').setFontColor('#FFFFFF');
  sheet.getRange(3, 6, Math.max(1, rows.length), 1).setNumberFormat('0.000000');
  sheet.getRange(3, 8, Math.max(1, rows.length), 5).setNumberFormat('0');
}

function writeTable_(sheet, startRow, startCol, colCount, values) {
  const lastRow = Math.max(sheet.getLastRow(), startRow);
  sheet.getRange(startRow, startCol, Math.max(1, lastRow - startRow + 1), colCount).clearContent();
  if (values.length) {
    sheet.getRange(startRow, startCol, values.length, colCount).setValues(values);
  }
  sheet.setFrozenRows(2);
}

function repairCalculator_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName('Calculator');
  const currencies = spreadsheet.getSheetByName('Currencies');
  if (!sheet || !currencies) return;

  const lastCurrencyRow = Math.max(3, currencies.getLastRow());
  const validation = SpreadsheetApp.newDataValidation()
    .requireValueInRange(currencies.getRange(3, 1, lastCurrencyRow - 2, 1), true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange('B5:B7').setDataValidation(validation);

  sheet.getRange('B12').setFormula('=IFERROR(INDEX(Currencies!$B:$B,MATCH($B$5,Currencies!$A:$A,0)),$B$5)');
  sheet.getRange('B13').setFormula('=IFERROR(INDEX(Currencies!$B:$B,MATCH($B$6,Currencies!$A:$A,0)),$B$6)');
  sheet.getRange('B14').setFormula('=IFERROR(INDEX(Currencies!$B:$B,MATCH($B$7,Currencies!$A:$A,0)),$B$7)');
  sheet.getRange('B17').setFormula('=IF(ISNUMBER($E$5),$E$5,IF(COUNTIFS(Pairs!$B:$B,$B$5,Pairs!$D:$D,$B$7)>0,SUMIFS(Pairs!$F:$F,Pairs!$B:$B,$B$5,Pairs!$D:$D,$B$7),""))');
  sheet.getRange('B18').setFormula('=IF(ISNUMBER($E$6),$E$6,IF(COUNTIFS(Pairs!$B:$B,$B$5,Pairs!$D:$D,$B$6)>0,SUMIFS(Pairs!$F:$F,Pairs!$B:$B,$B$5,Pairs!$D:$D,$B$6),""))');
  sheet.getRange('B19').setFormula('=IF(ISNUMBER($E$7),$E$7,IF(COUNTIFS(Pairs!$B:$B,$B$6,Pairs!$D:$D,$B$7)>0,SUMIFS(Pairs!$F:$F,Pairs!$B:$B,$B$6,Pairs!$D:$D,$B$7),""))');
  sheet.getRange('B20').setFormula('=IF(AND(ISNUMBER(B18),ISNUMBER(B19)),B18*B19,"")');
  sheet.getRange('B21').setFormula('=IF(AND(ISNUMBER(B17),ISNUMBER(B20)),B20-B17,"")');
  sheet.getRange('B22').setFormula('=IF(AND(ISNUMBER(B17),B17<>0,ISNUMBER(B21)),B21/B17,"")');
  sheet.getRange('B23').setFormula('=IF(B21="","Missing rate",IF(B21>0,"Trade through middle","Trade direct"))');
  sheet.getRange('E17').setFormula('=IF(ISNUMBER($B$17),INT(($B$8*$B$17)/$B$9)*$B$9,"")');
  sheet.getRange('E18').setFormula('=IF(ISNUMBER($B$17),$B$8*$B$17,"")');
  sheet.getRange('E19').setFormula('=IF(AND(ISNUMBER(E18),ISNUMBER(E17)),E18-E17,"")');
  sheet.getRange('E20').setFormula('=IF(ISNUMBER($B$18),$B$8*$B$18,"")');
  sheet.getRange('E21').setFormula('=IF(ISNUMBER($B$19),INT((E20*$B$19)/$B$9)*$B$9,"")');
  sheet.getRange('E22').setFormula('=IF(AND(ISNUMBER(E21),ISNUMBER($B$19),$B$19>0),MAX(0,E20-E21/$B$19),"")');
  sheet.getRange('E23').setFormula('=IF(AND(ISNUMBER(E22),ISNUMBER($B$19)),E22*$B$19,"")');
  sheet.getRange('E24').setFormula('=IF(AND(ISNUMBER(E21),ISNUMBER(E23)),E21+E23,"")');
  sheet.getRange('E25').setFormula('=IF(ISNUMBER(E22),E22,"")');
  sheet.getRange('E26').setFormula('=IF(AND(ISNUMBER(E17),ISNUMBER(E21)),E21-E17,"")');
  sheet.getRange('E27').setFormula('=IF(AND(ISNUMBER(E24),ISNUMBER(E17)),E24-E17,"")');
  sheet.getRange('E28').setFormula('=IF(AND(ISNUMBER($B$17),ISNUMBER($B$20)),$B$8*$B$20-$B$8*$B$17,"")');
  sheet.getRange('E29').setFormula('=IF(E27="","Missing prices",IF(E27>0,"Trade through middle",IF(E27<0,"Trade direct","Even after leftovers")))');
  sheet.getRange('B10').setFormula('=$E$29');
  sheet.getRange('I5').setFormula('=$E$17');
  sheet.getRange('I6').setFormula('=$E$21');
}

function stampNotes_(spreadsheet, league, categoryCount, currencyCount, pairCount, refreshMode) {
  const sheet = getOrCreateSheet_(spreadsheet, 'Notes');
  const now = new Date();
  sheet.getRange('F4:G12').setValues([
    ['Google Sheets refresh', now],
    ['League', league],
    ['Categories refreshed', categoryCount === null ? '' : categoryCount],
    ['Currencies refreshed', currencyCount === null ? '' : currencyCount],
    ['Directional pairs refreshed', pairCount === null ? '' : pairCount],
    ['Refresh mode', refreshMode || 'Manual refresh'],
    ['Transport', 'Apps Script UrlFetchApp + document cache + document lock'],
    ['Auto refresh', getAutoRefreshStatus_()],
    ['Last auto run', PropertiesService.getDocumentProperties().getProperty('POE2_AUTO_REFRESH_LAST_RUN') || '']
  ]);
  sheet.getRange('F4:G4').setFontWeight('bold').setBackground('#16323A').setFontColor('#FFFFFF');
}

function getAutoRefreshStatus_() {
  const triggers = ScriptApp.getProjectTriggers().filter(function (trigger) {
    return trigger.getHandlerFunction && trigger.getHandlerFunction() === AUTO_REFRESH_HANDLER;
  });
  const properties = PropertiesService.getDocumentProperties();
  const configured = properties.getProperty('POE2_AUTO_REFRESH') === 'on';
  if (triggers.length) {
    return 'On, every ' + AUTO_REFRESH_MINUTES + ' minutes (' + triggers.length + ' trigger' + (triggers.length === 1 ? '' : 's') + ')';
  }
  return configured ? 'Configured on, but no trigger found' : 'Off';
}

function removeTriggersByHandler_(handlerName) {
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction && trigger.getHandlerFunction() === handlerName) {
      ScriptApp.deleteTrigger(trigger);
      removed += 1;
    }
  });
  return removed;
}

function toast_(message, title) {
  try {
    SpreadsheetApp.getActive().toast(message, title || 'PoE2 Arb', 5);
  } catch (_error) {
    // Time-driven triggers cannot display UI; the Notes sheet still records status.
  }
}

function getOrCreateSheet_(spreadsheet, name) {
  return spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
}

function toNumber_(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
