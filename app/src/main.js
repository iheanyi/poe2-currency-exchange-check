const { app, BrowserWindow, ipcMain, shell, session } = require('electron');
const crypto = require('node:crypto');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');

const APP_USER_AGENT = 'poe2-currency-arb/0.2.0 (contact: local)';
const DEFAULT_REALM = 'poe2';
const DEFAULT_LEAGUE = 'Runes of Aldur';
const DEFAULT_ROUTE = {
  source: 'perfect-exalted-orb',
  bridge: 'exalted',
  target: 'divine'
};
const DEFAULT_OPTIMIZER = {
  maxHops: 3,
  maxResults: 12,
  beamPerNode: 16,
  globalBeam: 2500,
  edgeFanout: 60,
  resultPoolLimit: 300,
  quantity: 1,
  targetStep: 1
};
const MAX_ALLOWED_OPTIMIZER_IDS = 120;

const REALMS_TTL_MS = 15 * 60_000;
const LEAGUES_TTL_MS = 10 * 60_000;
const CATALOG_TTL_MS = 30 * 60_000;
const SNAPSHOT_TTL_MS = 60_000;
const OFFICIAL_TTL_MS = 60_000;
const OFFICIAL_LEG_DELAY_MS = 900;
const POE2SCOUT_API = 'https://api.poe2scout.com';
const APP_INDEX_PATH = path.join(__dirname, 'index.html');
const APP_INDEX_URL = pathToFileURL(APP_INDEX_PATH).toString();
const TRUSTED_EXTERNAL_HOSTS = new Set([
  'www.pathofexile.com',
  'pathofexile.com',
  'poe2scout.com',
  'www.poe2scout.com'
]);

const metadataCache = new Map();
const snapshotCache = new Map();
const officialCache = new Map();
const inFlightRequests = new Map();
const hostStates = new Map();
let officialBlockedUntil = 0;

const HOST_POLICIES = new Map([
  ['api.poe2scout.com', { minDelayMs: 250, maxRetries: 2 }],
  ['www.pathofexile.com', { minDelayMs: 1200, maxRetries: 1 }]
]);
const DEFAULT_HOST_POLICY = { minDelayMs: 500, maxRetries: 1 };
const RATE_LIMIT_HEADERS = [
  'retry-after',
  'x-rate-limit-ip',
  'x-rate-limit-ip-state',
  'x-rate-limit-account',
  'x-rate-limit-account-state',
  'x-rate-limit-policy',
  'x-rate-limit-rules'
];

function normalizeLocalPath(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isAllowedAppUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl));
    if (parsed.protocol !== 'file:') return false;
    return normalizeLocalPath(fileURLToPath(parsed)) === normalizeLocalPath(APP_INDEX_PATH);
  } catch (_error) {
    return false;
  }
}

async function openSafeExternal(rawUrl) {
  const parsed = new URL(String(rawUrl));
  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new Error('Blocked external URL protocol.');
  }
  if (!TRUSTED_EXTERNAL_HOSTS.has(parsed.hostname)) {
    throw new Error('Blocked external URL host.');
  }
  return shell.openExternal(parsed.toString());
}

function assertTrustedSender(event) {
  const senderUrl = event.senderFrame?.url || event.sender?.getURL?.() || '';
  if (!isAllowedAppUrl(senderUrl)) {
    throw new Error('Blocked IPC from untrusted renderer.');
  }
}

function trustedHandle(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedSender(event);
    return handler(event, ...args);
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 980,
    minHeight: 700,
    title: 'PoE2 Currency Arb',
    backgroundColor: '#101418',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    openSafeExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (isAllowedAppUrl(url)) return;
    event.preventDefault();
    openSafeExternal(url).catch(() => {});
  });
  win.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
  win.loadFile(APP_INDEX_PATH);
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanLeague(league) {
  const value = String(league || DEFAULT_LEAGUE).trim();
  return value.length > 0 ? value : DEFAULT_LEAGUE;
}

function cleanRealm(realm) {
  const value = String(realm || DEFAULT_REALM).trim();
  return value.length > 0 ? value : DEFAULT_REALM;
}

function cleanCurrency(value, fallback) {
  const text = String(value || fallback || '').trim();
  return text.length > 0 ? text : fallback;
}

function normalizeRoute(input = {}) {
  return {
    realm: cleanRealm(input.realm),
    league: cleanLeague(input.league),
    source: cleanCurrency(input.source, DEFAULT_ROUTE.source),
    bridge: cleanCurrency(input.bridge, DEFAULT_ROUTE.bridge),
    target: cleanCurrency(input.target, DEFAULT_ROUTE.target)
  };
}

function cacheHit(cache, key, ttlMs) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.cachedAt > ttlMs) return null;
  return {
    ...hit.value,
    fromCache: true,
    cacheAgeMs: Date.now() - hit.cachedAt,
    cacheTtlMs: ttlMs
  };
}

function setCache(cache, key, value) {
  cache.set(key, {
    cachedAt: Date.now(),
    value
  });
  return value;
}

async function fetchJson(url, options = {}) {
  const key = requestKey(url, options);
  if (inFlightRequests.has(key)) return inFlightRequests.get(key);

  const promise = withHostThrottle(url, () => fetchJsonAttempt(url, options))
    .finally(() => inFlightRequests.delete(key));
  inFlightRequests.set(key, promise);
  return promise;
}

function requestKey(url, options) {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = options.headers || {};
  const authorization = headers.Authorization || headers.authorization || '';
  const authKey = authorization
    ? crypto.createHash('sha256').update(String(authorization)).digest('hex').slice(0, 16)
    : '';
  return `${method} ${url} ${authKey} ${options.body || ''}`;
}

function hostPolicy(host) {
  return HOST_POLICIES.get(host) || DEFAULT_HOST_POLICY;
}

function hostState(host) {
  if (!hostStates.has(host)) {
    hostStates.set(host, {
      blockedUntil: 0,
      nextAt: 0,
      queue: Promise.resolve(),
      requestTimes: [],
      rateRules: [],
      lastRateLimit: null
    });
  }
  return hostStates.get(host);
}

async function withHostThrottle(url, task) {
  const host = new URL(url).host;
  const state = hostState(host);
  const policy = hostPolicy(host);
  const run = state.queue.then(async () => {
    const waitMs = Math.max(
      state.blockedUntil - Date.now(),
      state.nextAt - Date.now(),
      localBudgetWaitMs(state),
      0
    );
    if (waitMs > 0) await sleep(waitMs);
    state.nextAt = Date.now() + policy.minDelayMs;
    return task();
  });
  state.queue = run.catch(() => {});
  return run;
}

async function fetchJsonAttempt(url, options = {}) {
  const host = new URL(url).host;
  const policy = hostPolicy(host);

  for (let attempt = 0; attempt <= policy.maxRetries; attempt += 1) {
    const response = await fetch(url, {
      ...options,
      headers: {
        Accept: 'application/json',
        'User-Agent': APP_USER_AGENT,
        ...(options.headers || {})
      }
    });

    recordHostRequest(host);
    captureRateLimitHeaders(host, response);

    const text = await response.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }

    if (response.ok) return body;

    const retryMs = retryAfterMs(response, body, attempt);
    const canRetry = attempt < policy.maxRetries && (response.status === 429 || response.status === 503);
    if (canRetry) {
      blockHost(host, retryMs);
      await sleep(retryMs);
      continue;
    }

    const error = new Error(readApiMessage(body) || `${response.status} ${response.statusText}`);
    error.status = response.status;
    error.retryAfterSeconds = Math.ceil(retryMs / 1000);
    error.body = body;
    error.rateLimit = hostState(host).lastRateLimit;
    throw error;
  }

  throw new Error(`Request failed after retries: ${url}`);
}

function captureRateLimitHeaders(host, response) {
  const state = hostState(host);
  const headers = {};
  for (const name of RATE_LIMIT_HEADERS) {
    const value = response.headers.get(name);
    if (value) headers[name] = value;
  }

  const rateRules = parseRateLimitRules(response);
  if (rateRules.length) {
    state.rateRules = rateRules;
    const activeTimeoutMs = activeTimeoutFromRules(rateRules);
    if (activeTimeoutMs > 0) blockHost(host, activeTimeoutMs);
  }

  if (Object.keys(headers).length > 0) {
    state.lastRateLimit = {
      capturedAt: new Date().toISOString(),
      headers,
      rateRules,
      blockedUntil: state.blockedUntil || null
    };
  }
}

function recordHostRequest(host) {
  const state = hostState(host);
  const now = Date.now();
  state.requestTimes.push(now);
  const maxPeriodMs = Math.max(...state.rateRules.map((rule) => rule.periodSeconds * 1000), 5 * 60_000);
  state.requestTimes = state.requestTimes.filter((timestamp) => now - timestamp < maxPeriodMs);
}

function localBudgetWaitMs(state) {
  if (!state.rateRules.length) return 0;
  const now = Date.now();
  const maxPeriodMs = Math.max(...state.rateRules.map((rule) => rule.periodSeconds * 1000), 0);
  state.requestTimes = state.requestTimes.filter((timestamp) => now - timestamp < maxPeriodMs);

  let waitMs = 0;
  for (const rule of state.rateRules) {
    if (!rule.limit || !rule.periodSeconds) continue;
    const periodMs = rule.periodSeconds * 1000;
    const recent = state.requestTimes.filter((timestamp) => now - timestamp < periodMs);
    if (recent.length >= rule.limit) {
      waitMs = Math.max(waitMs, recent[0] + periodMs - now + 250);
    }
  }
  return waitMs;
}

function parseRateLimitRules(response) {
  const names = splitHeaderList(response.headers.get('x-rate-limit-rules'));
  const inferredNames = names.length ? names : ['ip', 'account', 'client'];
  const rules = [];

  for (const name of inferredNames) {
    const ruleName = name.trim().toLowerCase();
    if (!ruleName) continue;
    const limits = parseRateTriples(response.headers.get(`x-rate-limit-${ruleName}`));
    const states = parseRateTriples(response.headers.get(`x-rate-limit-${ruleName}-state`));

    for (let index = 0; index < limits.length; index += 1) {
      const limit = limits[index];
      const state = states[index] || {};
      rules.push({
        rule: ruleName,
        limit: limit.first,
        periodSeconds: limit.second,
        timeoutSeconds: limit.third,
        current: state.first ?? null,
        activeTimeoutSeconds: state.third ?? 0
      });
    }
  }

  return rules;
}

function splitHeaderList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseRateTriples(value) {
  return splitHeaderList(value)
    .map((part) => {
      const [first, second, third] = part.split(':').map(Number);
      if (![first, second, third].every(Number.isFinite)) return null;
      return { first, second, third };
    })
    .filter(Boolean);
}

function activeTimeoutFromRules(rules) {
  return Math.max(...rules.map((rule) => Number(rule.activeTimeoutSeconds || 0) * 1000), 0);
}

function retryAfterMs(response, body, attempt) {
  const activeTimeoutMs = activeTimeoutFromRules(parseRateLimitRules(response));
  if (activeTimeoutMs > 0) return activeTimeoutMs;

  const header = response.headers.get('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const dateMs = Date.parse(header);
    if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  }

  const bodySeconds = readRetrySeconds(body);
  if (bodySeconds) return bodySeconds * 1000;
  return (attempt + 1) * 1500;
}

function blockHost(host, waitMs) {
  const state = hostState(host);
  state.blockedUntil = Math.max(state.blockedUntil, Date.now() + waitMs);
}

function rateLimitForHost(host) {
  return hostState(host).lastRateLimit;
}

function readApiMessage(body) {
  if (!body) return '';
  if (typeof body === 'string') return body;
  if (body.error && body.error.message) return body.error.message;
  if (body.detail && typeof body.detail === 'string') return body.detail;
  return '';
}

function readRetrySeconds(body) {
  const message = readApiMessage(body);
  const match = message.match(/wait\s+(\d+)\s+seconds/i);
  return match ? Number(match[1]) : null;
}

function poe2ScoutUrl(parts, params = {}) {
  const url = new URL(`${POE2SCOUT_API}/${parts.map(encodeURIComponent).join('/')}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function officialExchangeUrl(league) {
  return `https://www.pathofexile.com/api/trade2/exchange/poe2/${encodeURIComponent(league)}`;
}

async function fetchRealms() {
  const key = 'realms';
  const cached = cacheHit(metadataCache, key, REALMS_TTL_MS);
  if (cached) return cached.realms;
  const realms = await fetchJson(`${POE2SCOUT_API}/Realms`);
  setCache(metadataCache, key, { realms });
  return realms;
}

async function fetchLeagues(realm = DEFAULT_REALM) {
  const clean = cleanRealm(realm);
  const key = `leagues:${clean}`;
  const cached = cacheHit(metadataCache, key, LEAGUES_TTL_MS);
  if (cached) return cached.leagues;
  const leagues = await fetchJson(poe2ScoutUrl([clean, 'Leagues']));
  setCache(metadataCache, key, { leagues });
  return leagues;
}

async function fetchCurrencyCategories(realm = DEFAULT_REALM, league = DEFAULT_LEAGUE) {
  const clean = normalizeRoute({ realm, league });
  const key = `categories:${clean.realm}:${clean.league}`;
  const cached = cacheHit(metadataCache, key, CATALOG_TTL_MS);
  if (cached) return cached.categories;

  const data = await fetchJson(poe2ScoutUrl([clean.realm, 'Leagues', clean.league, 'Items', 'Categories']));
  const categories = Array.isArray(data?.CurrencyCategories) ? data.CurrencyCategories : [];
  setCache(metadataCache, key, { categories });
  return categories;
}

async function fetchCurrenciesByCategory(realm, league, categoryApiId) {
  const key = `currencies:${realm}:${league}:${categoryApiId}`;
  const cached = cacheHit(metadataCache, key, CATALOG_TTL_MS);
  if (cached) return cached.items;

  const items = [];
  let page = 1;
  let pages = 1;
  do {
    const data = await fetchJson(poe2ScoutUrl(
      [realm, 'Leagues', league, 'Currencies', 'ByCategory'],
      {
        Category: categoryApiId,
        Page: page,
        PerPage: 250
      }
    ));
    if (Array.isArray(data?.Items)) items.push(...data.Items);
    pages = Number(data?.Pages) || 1;
    page += 1;
  } while (page <= pages);

  setCache(metadataCache, key, { items });
  return items;
}

async function fetchCurrencyCatalog(realm = DEFAULT_REALM, league = DEFAULT_LEAGUE) {
  const clean = normalizeRoute({ realm, league });
  const key = `catalog:${clean.realm}:${clean.league}`;
  const cached = cacheHit(metadataCache, key, CATALOG_TTL_MS);
  if (cached) return cached;

  const categories = await fetchCurrencyCategories(clean.realm, clean.league);
  const grouped = [];
  const seen = new Map();

  for (const category of categories) {
    const items = await fetchCurrenciesByCategory(clean.realm, clean.league, category.ApiId);
    const normalizedItems = items
      .filter((item) => item.ApiId && item.Text)
      .map((item) => ({
        apiId: item.ApiId,
        text: item.Text,
        categoryApiId: item.CategoryApiId || category.ApiId,
        categoryLabel: category.Label || category.ApiId,
        iconUrl: item.IconUrl || '',
        currentPrice: toNumber(item.CurrentPrice),
        currentQuantity: toNumber(item.CurrentQuantity),
        baseCurrencyApiId: item.BaseCurrencyApiId || item.BaseCurrency?.ApiId || '',
        baseCurrencyText: item.BaseCurrencyText || item.BaseCurrency?.Text || '',
        valueTraded: toNumber(item.ValueTraded),
        stockValue: toNumber(item.StockValue),
        priceLogs: item.PriceLogs || [],
        itemMetadata: item.ItemMetadata || null,
        currencyItemId: item.CurrencyItemId,
        itemId: item.ItemId
      }));

    for (const item of normalizedItems) {
      if (!seen.has(item.apiId)) seen.set(item.apiId, item);
    }

    grouped.push({
      apiId: category.ApiId,
      label: category.Label || category.ApiId,
      items: normalizedItems
    });
  }

  const currencies = Array.from(seen.values()).sort((a, b) => a.text.localeCompare(b.text));
  const value = {
    realm: clean.realm,
    league: clean.league,
    fetchedAt: new Date().toISOString(),
    fromCache: false,
    cacheAgeMs: 0,
    cacheTtlMs: CATALOG_TTL_MS,
    categories: grouped,
    currencies,
    defaults: DEFAULT_ROUTE
  };

  return setCache(metadataCache, key, value);
}

async function fetchBootstrap(realm = DEFAULT_REALM, league = DEFAULT_LEAGUE) {
  const clean = normalizeRoute({ realm, league });
  const [realms, leagues, catalog] = await Promise.all([
    fetchRealms(),
    fetchLeagues(clean.realm),
    fetchCurrencyCatalog(clean.realm, clean.league)
  ]);

  return {
    realms,
    leagues,
    catalog,
    defaults: {
      realm: clean.realm,
      league: clean.league,
      ...DEFAULT_ROUTE
    }
  };
}

async function fetchSnapshotPairs(realm, league) {
  const key = `snapshot-pairs:${realm}:${league}`;
  const cached = cacheHit(snapshotCache, key, SNAPSHOT_TTL_MS);
  if (cached) return cached;

  const pairs = await fetchJson(poe2ScoutUrl([realm, 'Leagues', league, 'SnapshotPairs']));
  if (!Array.isArray(pairs)) throw new Error('POE2Scout returned an unexpected snapshot shape.');

  const value = {
    pairs,
    fetchedAt: new Date().toISOString(),
    fromCache: false,
    cacheAgeMs: 0,
    cacheTtlMs: SNAPSHOT_TTL_MS
  };
  return setCache(snapshotCache, key, value);
}

function findPair(pairs, one, two) {
  return pairs.find((pair) => {
    const first = pair.CurrencyOne?.ApiId;
    const second = pair.CurrencyTwo?.ApiId;
    return (first === one && second === two) || (first === two && second === one);
  });
}

function relativePrice(pair, apiId) {
  if (!pair) return null;
  if (pair.CurrencyOne?.ApiId === apiId) return toNumber(pair.CurrencyOneData?.RelativePrice);
  if (pair.CurrencyTwo?.ApiId === apiId) return toNumber(pair.CurrencyTwoData?.RelativePrice);
  return null;
}

function volumeTraded(pair, apiId) {
  if (!pair) return null;
  if (pair.CurrencyOne?.ApiId === apiId) return pair.CurrencyOneData?.VolumeTraded ?? null;
  if (pair.CurrencyTwo?.ApiId === apiId) return pair.CurrencyTwoData?.VolumeTraded ?? null;
  return null;
}

function highestStock(pair, apiId) {
  if (!pair) return null;
  if (pair.CurrencyOne?.ApiId === apiId) return pair.CurrencyOneData?.HighestStock ?? null;
  if (pair.CurrencyTwo?.ApiId === apiId) return pair.CurrencyTwoData?.HighestStock ?? null;
  return null;
}

function valueTraded(pair, apiId) {
  if (!pair) return null;
  if (pair.CurrencyOne?.ApiId === apiId) return pair.CurrencyOneData?.ValueTraded ?? null;
  if (pair.CurrencyTwo?.ApiId === apiId) return pair.CurrencyTwoData?.ValueTraded ?? null;
  return null;
}

function stockValue(pair, apiId) {
  if (!pair) return null;
  if (pair.CurrencyOne?.ApiId === apiId) return pair.CurrencyOneData?.StockValue ?? null;
  if (pair.CurrencyTwo?.ApiId === apiId) return pair.CurrencyTwoData?.StockValue ?? null;
  return null;
}

function rateBetween(pair, have, want) {
  if (have === want) return 1;
  const haveRelative = relativePrice(pair, have);
  const wantRelative = relativePrice(pair, want);
  if (!haveRelative || !wantRelative) return null;
  return haveRelative / wantRelative;
}

function makeSnapshotLeg(pair, have, want, label) {
  return {
    label,
    have,
    want,
    rate: rateBetween(pair, have, want),
    haveRelativeBase: have === want ? 1 : relativePrice(pair, have),
    wantRelativeBase: have === want ? 1 : relativePrice(pair, want),
    haveVolumeTraded: have === want ? null : volumeTraded(pair, have),
    wantVolumeTraded: have === want ? null : volumeTraded(pair, want),
    haveHighestStock: have === want ? null : highestStock(pair, have),
    wantHighestStock: have === want ? null : highestStock(pair, want),
    haveValueTraded: have === want ? null : valueTraded(pair, have),
    wantValueTraded: have === want ? null : valueTraded(pair, want),
    haveStockValue: have === want ? null : stockValue(pair, have),
    wantStockValue: have === want ? null : stockValue(pair, want),
    pairId: pair?.CurrencyExchangeSnapshotPairId ?? null,
    snapshotId: pair?.CurrencyExchangeSnapshotId ?? null,
    volumeBaseValue: toNumber(pair?.Volume)
  };
}

function computeRoutes(legs) {
  const direct = legs.direct?.rate ?? null;
  const sourceToBridge = legs.sourceToBridge?.rate ?? null;
  const bridgeToTarget = legs.bridgeToTarget?.rate ?? null;
  const viaBridge = sourceToBridge && bridgeToTarget ? sourceToBridge * bridgeToTarget : null;
  const edge = direct && viaBridge ? viaBridge - direct : null;
  const edgePct = direct && edge !== null ? (edge / direct) * 100 : null;

  return {
    directTargetPerSource: direct,
    sourceToBridge,
    bridgeToTarget,
    viaBridgeTargetPerSource: viaBridge,
    edgeTargetPerSource: edge,
    edgePct,
    bestRoute: edge === null ? 'unknown' : edge > 0 ? 'via-bridge' : 'direct'
  };
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isSafeCurrencyId(value) {
  return /^[a-z0-9][a-z0-9-]{0,79}$/.test(value);
}

function floorToStep(value, step) {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return value;
  return Number((Math.floor((value + Number.EPSILON) / step) * step).toFixed(10));
}

function normalizeOptimizerInput(input = {}) {
  const route = normalizeRoute(input);
  const rawAllowed = Array.isArray(input.allowedApiIds)
    ? input.allowedApiIds.map((item) => String(item).trim()).filter(Boolean)
    : String(input.allowedApiIds || '')
      .split(/[,\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  const allowed = [...new Set(rawAllowed.filter(isSafeCurrencyId))].slice(0, MAX_ALLOWED_OPTIMIZER_IDS);

  return {
    ...route,
    quantity: positiveNumber(input.quantity, DEFAULT_OPTIMIZER.quantity),
    targetStep: positiveNumber(input.targetStep, DEFAULT_OPTIMIZER.targetStep),
    maxHops: clampInteger(input.maxHops, DEFAULT_OPTIMIZER.maxHops, 1, 5),
    maxResults: clampInteger(input.maxResults, DEFAULT_OPTIMIZER.maxResults, 1, 50),
    beamPerNode: clampInteger(input.beamPerNode, DEFAULT_OPTIMIZER.beamPerNode, 2, 100),
    globalBeam: clampInteger(input.globalBeam, DEFAULT_OPTIMIZER.globalBeam, 100, 5_000),
    edgeFanout: clampInteger(input.edgeFanout, DEFAULT_OPTIMIZER.edgeFanout, 4, 120),
    resultPoolLimit: clampInteger(
      input.resultPoolLimit,
      Math.max(DEFAULT_OPTIMIZER.resultPoolLimit, DEFAULT_OPTIMIZER.maxResults * 8),
      50,
      1_000
    ),
    allowedApiIds: allowed
  };
}

function edgeFromPair(pair, from, to) {
  const rate = rateBetween(pair, from, to);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return {
    from,
    to,
    rate,
    logRate: Math.log(rate),
    pairId: pair.CurrencyExchangeSnapshotPairId ?? null,
    snapshotId: pair.CurrencyExchangeSnapshotId ?? null,
    volumeBaseValue: toNumber(pair.Volume),
    fromVolumeTraded: volumeTraded(pair, from),
    toVolumeTraded: volumeTraded(pair, to),
    fromHighestStock: highestStock(pair, from),
    toHighestStock: highestStock(pair, to),
    fromValueTraded: valueTraded(pair, from),
    toValueTraded: valueTraded(pair, to),
    fromStockValue: stockValue(pair, from),
    toStockValue: stockValue(pair, to)
  };
}

function buildSnapshotGraph(pairs, allowedSet) {
  const graph = new Map();
  const addEdge = (edge) => {
    if (!edge) return;
    if (allowedSet && (!allowedSet.has(edge.from) || !allowedSet.has(edge.to))) return;
    if (!graph.has(edge.from)) graph.set(edge.from, []);
    graph.get(edge.from).push(edge);
  };

  for (const pair of pairs) {
    const one = pair.CurrencyOne?.ApiId;
    const two = pair.CurrencyTwo?.ApiId;
    if (!one || !two) continue;
    addEdge(edgeFromPair(pair, one, two));
    addEdge(edgeFromPair(pair, two, one));
  }

  for (const edges of graph.values()) {
    edges.sort((a, b) => b.logRate - a.logRate);
  }
  return graph;
}

function pathLiquidity(edges) {
  const numeric = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
  const volumes = edges.flatMap((edge) => [
    numeric(edge.volumeBaseValue),
    numeric(edge.fromVolumeTraded),
    numeric(edge.toVolumeTraded)
  ]).filter((value) => value !== null);
  const stocks = edges.flatMap((edge) => [
    numeric(edge.fromHighestStock),
    numeric(edge.toHighestStock)
  ]).filter((value) => value !== null);

  return {
    minVolume: volumes.length ? Math.min(...volumes) : null,
    minStock: stocks.length ? Math.min(...stocks) : null
  };
}

function makeOptimizerResult(state, options) {
  const rawTotal = options.quantity * state.rate;
  const actionableTotal = floorToStep(rawTotal, options.targetStep);
  const { minVolume, minStock } = pathLiquidity(state.edges);
  const finalEdge = state.edges.at(-1);
  const prefixRate = finalEdge
    ? state.edges.slice(0, -1).reduce((rate, edge) => rate * edge.rate, 1)
    : 1;
  const finalInputTotal = finalEdge ? options.quantity * prefixRate : 0;
  const finalInputSpent = finalEdge?.rate > 0 ? actionableTotal / finalEdge.rate : 0;
  const leftoverAmount = state.edges.length > 1 ? Math.max(0, finalInputTotal - finalInputSpent) : 0;
  const leftoverTargetValue = finalEdge ? leftoverAmount * finalEdge.rate : 0;
  return {
    path: state.path,
    hops: state.edges.length,
    rawTargetPerSource: state.rate,
    rawTargetTotal: rawTotal,
    actionableTargetTotal: actionableTotal,
    targetStep: options.targetStep,
    leftoverCurrency: finalEdge?.from || options.source,
    leftoverAmount,
    leftoverTargetValue,
    finalInputTotal,
    edgeCount: state.edges.length,
    minVolume,
    minStock,
    legs: state.edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      rate: edge.rate,
      pairId: edge.pairId,
      volumeBaseValue: edge.volumeBaseValue,
      fromVolumeTraded: edge.fromVolumeTraded,
      toVolumeTraded: edge.toVolumeTraded,
      fromHighestStock: edge.fromHighestStock,
      toHighestStock: edge.toHighestStock
    }))
  };
}

function pruneStates(states, beamPerNode, globalBeam) {
  const byNode = new Map();
  for (const state of states) {
    if (!byNode.has(state.node)) byNode.set(state.node, []);
    byNode.get(state.node).push(state);
  }

  const pruned = [];
  for (const bucket of byNode.values()) {
    bucket.sort((a, b) => b.logRate - a.logRate);
    pruned.push(...bucket.slice(0, beamPerNode));
  }

  pruned.sort((a, b) => b.logRate - a.logRate);
  return pruned.slice(0, globalBeam);
}

function sortOptimizerResults(results) {
  results.sort((a, b) => (
    b.actionableTargetTotal - a.actionableTargetTotal
    || b.leftoverTargetValue - a.leftoverTargetValue
    || b.rawTargetTotal - a.rawTargetTotal
    || a.hops - b.hops
  ));
}

function optimizeSnapshotPaths(pairs, options) {
  const allowedSet = options.allowedApiIds.length
    ? new Set([...options.allowedApiIds, options.source, options.target])
    : null;
  const graph = buildSnapshotGraph(pairs, allowedSet);
  const start = {
    node: options.source,
    path: [options.source],
    edges: [],
    rate: 1,
    logRate: 0
  };
  let frontier = [start];
  const results = [];
  let exploredStates = 0;
  const frontierSpillLimit = Math.max(options.globalBeam * 3, options.beamPerNode * 50);
  const resultPoolLimit = Math.max(options.maxResults, options.resultPoolLimit);

  for (let hop = 1; hop <= options.maxHops; hop += 1) {
    const nextFrontier = [];
    for (const state of frontier) {
      const edges = (graph.get(state.node) || []).slice(0, options.edgeFanout);
      for (const edge of edges) {
        if (edge.to !== options.target && state.path.includes(edge.to)) continue;
        const nextRate = state.rate * edge.rate;
        if (!Number.isFinite(nextRate) || nextRate <= 0) continue;
        const nextState = {
          node: edge.to,
          path: [...state.path, edge.to],
          edges: [...state.edges, edge],
          rate: nextRate,
          logRate: state.logRate + edge.logRate
        };
        exploredStates += 1;
        if (edge.to === options.target) {
          results.push(makeOptimizerResult(nextState, options));
          if (results.length > resultPoolLimit * 2) {
            sortOptimizerResults(results);
            results.length = resultPoolLimit;
          }
        } else if (hop < options.maxHops) {
          nextFrontier.push(nextState);
          if (nextFrontier.length > frontierSpillLimit) {
            nextFrontier.splice(
              0,
              nextFrontier.length,
              ...pruneStates(nextFrontier, options.beamPerNode, options.globalBeam)
            );
          }
        }
      }
    }
    frontier = pruneStates(nextFrontier, options.beamPerNode, options.globalBeam);
  }

  sortOptimizerResults(results);

  return {
    results: results.slice(0, options.maxResults),
    exploredStates,
    graphNodeCount: graph.size,
    graphEdgeCount: Array.from(graph.values()).reduce((total, edges) => total + edges.length, 0),
    searchMode: options.allowedApiIds.length ? 'allowlist-exhaustive-with-pruning' : 'full-market-beam'
  };
}

async function fetchSnapshotRoute(routeInput) {
  const route = normalizeRoute(routeInput);
  const snapshot = await fetchSnapshotPairs(route.realm, route.league);
  const pairs = snapshot.pairs;

  const directPair = findPair(pairs, route.source, route.target);
  const sourceBridgePair = findPair(pairs, route.source, route.bridge);
  const bridgeTargetPair = findPair(pairs, route.bridge, route.target);

  const legs = {
    direct: makeSnapshotLeg(directPair, route.source, route.target, 'Direct'),
    sourceToBridge: makeSnapshotLeg(sourceBridgePair, route.source, route.bridge, 'Source -> Bridge'),
    bridgeToTarget: makeSnapshotLeg(bridgeTargetPair, route.bridge, route.target, 'Bridge -> Target')
  };

  return {
    marketSource: 'poe2scout-snapshot',
    ...route,
    fetchedAt: snapshot.fetchedAt,
    fromCache: snapshot.fromCache,
    cacheAgeMs: snapshot.cacheAgeMs,
    cacheTtlMs: SNAPSHOT_TTL_MS,
    legs,
    routes: computeRoutes(legs),
    rateLimit: rateLimitForHost('api.poe2scout.com')
  };
}

async function fetchOptimizedSnapshotRoutes(input) {
  const options = normalizeOptimizerInput(input);
  const snapshot = await fetchSnapshotPairs(options.realm, options.league);
  const optimized = optimizeSnapshotPaths(snapshot.pairs, options);

  return {
    marketSource: 'poe2scout-snapshot-optimizer',
    ...options,
    fetchedAt: snapshot.fetchedAt,
    fromCache: snapshot.fromCache,
    cacheAgeMs: snapshot.cacheAgeMs,
    cacheTtlMs: SNAPSHOT_TTL_MS,
    rateLimit: rateLimitForHost('api.poe2scout.com'),
    ...optimized
  };
}

async function fetchOfficialLeg(league, have, want) {
  const key = `official:${league}:${have}:${want}`;
  const cached = cacheHit(officialCache, key, OFFICIAL_TTL_MS);
  if (cached) return cached;

  const now = Date.now();
  if (officialBlockedUntil > now) {
    const seconds = Math.ceil((officialBlockedUntil - now) / 1000);
    const error = new Error(`Official trade API cooldown: ${seconds}s remaining.`);
    error.status = 429;
    error.retryAfterSeconds = seconds;
    throw error;
  }

  if (have === want) {
    return {
      label: `${have} -> ${want}`,
      have,
      want,
      rate: 1,
      total: null,
      queryId: null,
      offers: [],
      fromCache: false,
      cacheAgeMs: 0,
      cacheTtlMs: OFFICIAL_TTL_MS
    };
  }

  const body = JSON.stringify({
    exchange: {
      status: { option: 'online' },
      have: [have],
      want: [want]
    },
    engine: 'new'
  });

  try {
    const response = await fetchJson(officialExchangeUrl(league), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });

    const offers = readOfficialOffers(response, have, want);
    const best = offers[0] || null;
    const value = {
      label: `${have} -> ${want}`,
      have,
      want,
      rate: best?.rate ?? null,
      total: response?.total ?? null,
      queryId: response?.id ?? null,
      offers,
      fromCache: false,
      cacheAgeMs: 0,
      cacheTtlMs: OFFICIAL_TTL_MS
    };

    return setCache(officialCache, key, value);
  } catch (error) {
    if (error.status === 429) {
      const waitMs = ((error.retryAfterSeconds || 60) + 2) * 1000;
      officialBlockedUntil = Date.now() + waitMs;
    }
    throw error;
  }
}

function readOfficialOffers(response, have, want) {
  const result = response?.result;
  const rows = result && !Array.isArray(result) && typeof result === 'object'
    ? Object.values(result)
    : [];

  const offers = [];
  for (const row of rows) {
    const listing = row?.listing;
    for (const offer of listing?.offers || []) {
      const exchange = offer.exchange;
      const item = offer.item;
      if (exchange?.currency !== have || item?.currency !== want) continue;

      const haveAmount = toNumber(exchange.amount);
      const wantAmount = toNumber(item.amount);
      if (!haveAmount || !wantAmount) continue;

      offers.push({
        rate: wantAmount / haveAmount,
        haveAmount,
        wantAmount,
        wantStock: toNumber(item.stock),
        indexed: listing.indexed || null,
        account: listing.account?.name || null,
        status: listing.account?.online?.status || 'online',
        whisper: listing.whisper || null
      });
    }
  }

  offers.sort((a, b) => b.rate - a.rate);
  return offers.slice(0, 12);
}

async function fetchOfficialRoute(routeInput) {
  const route = normalizeRoute(routeInput);
  const errors = [];
  const direct = await safeOfficialLeg(route.league, route.source, route.target, errors);
  await sleep(OFFICIAL_LEG_DELAY_MS);
  const sourceToBridge = await safeOfficialLeg(route.league, route.source, route.bridge, errors);
  await sleep(OFFICIAL_LEG_DELAY_MS);
  const bridgeToTarget = await safeOfficialLeg(route.league, route.bridge, route.target, errors);

  const legs = { direct, sourceToBridge, bridgeToTarget };
  return {
    marketSource: 'official-trade-listings',
    ...route,
    fetchedAt: new Date().toISOString(),
    fromCache: [direct, sourceToBridge, bridgeToTarget].every((leg) => leg?.fromCache),
    cacheAgeMs: 0,
    cacheTtlMs: OFFICIAL_TTL_MS,
    blockedUntil: Math.max(officialBlockedUntil, hostState('www.pathofexile.com').blockedUntil) || null,
    errors,
    legs,
    routes: computeRoutes(legs),
    rateLimit: rateLimitForHost('www.pathofexile.com')
  };
}

async function safeOfficialLeg(league, have, want, errors) {
  try {
    return await fetchOfficialLeg(league, have, want);
  } catch (error) {
    errors.push({
      leg: `${have}->${want}`,
      message: error.message,
      status: error.status || null,
      retryAfterSeconds: error.retryAfterSeconds || null
    });
    return {
      label: `${have} -> ${want}`,
      have,
      want,
      rate: null,
      total: null,
      queryId: null,
      offers: [],
      error: error.message
    };
  }
}

trustedHandle('meta:bootstrap', (_event, route) => fetchBootstrap(route?.realm, route?.league));
trustedHandle('meta:catalog', (_event, route) => {
  const clean = normalizeRoute(route);
  return fetchCurrencyCatalog(clean.realm, clean.league);
});
trustedHandle('rates:snapshotRoute', (_event, route) => fetchSnapshotRoute(route));
trustedHandle('rates:officialRoute', (_event, route) => fetchOfficialRoute(route));
trustedHandle('rates:optimizeSnapshot', (_event, input) => fetchOptimizedSnapshotRoutes(input));
trustedHandle('app:openExternal', (_event, url) => openSafeExternal(url));
