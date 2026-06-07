const ids = {
  leagueSelect: document.getElementById('leagueSelect'),
  catalogButton: document.getElementById('catalogButton'),
  snapshotButton: document.getElementById('snapshotButton'),
  officialButton: document.getElementById('officialButton'),
  optimizeButton: document.getElementById('optimizeButton'),
  openScoutButton: document.getElementById('openScoutButton'),
  openTradeButton: document.getElementById('openTradeButton'),
  statusPill: document.getElementById('statusPill'),
  sourceText: document.getElementById('sourceText'),
  catalogText: document.getElementById('catalogText'),
  cacheText: document.getElementById('cacheText'),
  updatedText: document.getElementById('updatedText'),
  sourceSelect: document.getElementById('sourceSelect'),
  bridgeSelect: document.getElementById('bridgeSelect'),
  targetSelect: document.getElementById('targetSelect'),
  quantityInput: document.getElementById('quantityInput'),
  targetStepInput: document.getElementById('targetStepInput'),
  directRateLabel: document.getElementById('directRateLabel'),
  firstRateLabel: document.getElementById('firstRateLabel'),
  secondRateLabel: document.getElementById('secondRateLabel'),
  directRateInput: document.getElementById('directRateInput'),
  firstRateInput: document.getElementById('firstRateInput'),
  secondRateInput: document.getElementById('secondRateInput'),
  clearButton: document.getElementById('clearButton'),
  sampleButton: document.getElementById('sampleButton'),
  edgePerInput: document.getElementById('edgePerInput'),
  totalEdge: document.getElementById('totalEdge'),
  directTotal: document.getElementById('directTotal'),
  directMixed: document.getElementById('directMixed'),
  viaTotal: document.getElementById('viaTotal'),
  viaMixed: document.getElementById('viaMixed'),
  directRawValue: document.getElementById('directRawValue'),
  directRawFraction: document.getElementById('directRawFraction'),
  middleLeftValue: document.getElementById('middleLeftValue'),
  middlePackageValue: document.getElementById('middlePackageValue'),
  wholePackageEdge: document.getElementById('wholePackageEdge'),
  rawValueEdge: document.getElementById('rawValueEdge'),
  bestBadge: document.getElementById('bestBadge'),
  verdictText: document.getElementById('verdictText'),
  legsContainer: document.getElementById('legsContainer'),
  optimizerText: document.getElementById('optimizerText'),
  maxHopsInput: document.getElementById('maxHopsInput'),
  maxResultsInput: document.getElementById('maxResultsInput'),
  allowlistInput: document.getElementById('allowlistInput'),
  optimizerResults: document.getElementById('optimizerResults')
};

const DEFAULTS = {
  realm: 'poe2',
  league: 'Runes of Aldur',
  source: 'perfect-exalted-orb',
  bridge: 'exalted',
  target: 'divine'
};

let catalog = null;
let leagues = [];
let lastMarket = null;

function currentRoute() {
  return {
    realm: DEFAULTS.realm,
    league: ids.leagueSelect.value || DEFAULTS.league,
    source: ids.sourceSelect.value || DEFAULTS.source,
    bridge: ids.bridgeSelect.value || DEFAULTS.bridge,
    target: ids.targetSelect.value || DEFAULTS.target
  };
}

function currencyLabel(apiId) {
  const found = catalog?.currencies?.find((item) => item.apiId === apiId);
  return found?.text || apiId || '--';
}

function shortLabel(apiId) {
  const label = currencyLabel(apiId);
  return label
    .replace(/\bOrb\b/g, '')
    .replace(/\bPerfect\b/g, 'Perf.')
    .replace(/\bGreater\b/g, 'Gr.')
    .replace(/\bLesser\b/g, 'Less.')
    .replace(/\s+/g, ' ')
    .trim();
}

function numberValue(input) {
  const value = Number(input.value);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function positiveNumberValue(input, fallback = 1) {
  const value = Number(input.value);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function integerNumberValue(input, fallback, min, max) {
  const value = Math.trunc(Number(input.value));
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

function parseAllowlist() {
  const values = ids.allowlistInput.value
    .split(/[\s,;]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set(values)];
}

function floorToStep(value, step) {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return value;
  const scaled = Math.floor((value + Number.EPSILON) / step) * step;
  return Number(scaled.toFixed(10));
}

function formatNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return '--';
  return value.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: value < 10 && value !== 0 ? Math.min(2, digits) : 0
  });
}

function formatRate(value) {
  if (!Number.isFinite(value)) return '--';
  if (value >= 100) return formatNumber(value, 2);
  if (value >= 10) return formatNumber(value, 3);
  return formatNumber(value, 6);
}

function formatSigned(value, digits = 2) {
  if (!Number.isFinite(value)) return '--';
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${formatNumber(Math.abs(value), digits)}`;
}

function leftoverText(amount, apiId) {
  if (!Number.isFinite(amount) || amount <= 0) return `+ 0 ${shortLabel(apiId)} left`;
  const digits = amount >= 10 ? 2 : 4;
  return `+ ${formatNumber(amount, digits)} ${shortLabel(apiId)} left`;
}

function buildExchangeOutcome(routes, quantity, targetStep) {
  const rawDirectTarget = quantity * routes.directTargetPerSource;
  const directTarget = floorToStep(rawDirectTarget, targetStep);
  const directRawFraction = rawDirectTarget - directTarget;
  const directSourceLeft = 0;
  const directLeftValue = 0;

  const middleTotal = quantity * routes.sourceToBridge;
  const rawViaTarget = middleTotal * routes.bridgeToTarget;
  const viaTarget = floorToStep(rawViaTarget, targetStep);
  const middleSpent = routes.bridgeToTarget > 0 ? viaTarget / routes.bridgeToTarget : 0;
  const middleLeft = Math.max(0, middleTotal - middleSpent);
  const middleLeftValue = middleLeft * routes.bridgeToTarget;

  const targetDelta = viaTarget - directTarget;
  const leftoverValueDelta = middleLeftValue - directLeftValue;
  const middlePackageValue = viaTarget + middleLeftValue;
  const valueDelta = middlePackageValue - directTarget;
  const rawValueDelta = rawViaTarget - rawDirectTarget;

  return {
    rawDirectTarget,
    directRawFraction,
    rawViaTarget,
    directTarget,
    directSourceLeft,
    directLeftValue,
    middleTotal,
    viaTarget,
    middleLeft,
    middleLeftValue,
    middlePackageValue,
    targetDelta,
    leftoverValueDelta,
    valueDelta,
    rawValueDelta,
    valueDeltaPerSource: quantity > 0 ? valueDelta / quantity : 0
  };
}

function setStatus(kind, text) {
  ids.statusPill.className = `status-pill ${kind}`;
  ids.statusPill.textContent = text;
}

function setBusy(isBusy) {
  ids.catalogButton.disabled = isBusy;
  ids.snapshotButton.disabled = isBusy;
  ids.officialButton.disabled = isBusy;
  ids.optimizeButton.disabled = isBusy || !catalog;
}

function readManualRoutes() {
  const directTargetPerSource = numberValue(ids.directRateInput);
  const sourceToBridge = numberValue(ids.firstRateInput);
  const bridgeToTarget = numberValue(ids.secondRateInput);
  const viaBridgeTargetPerSource = sourceToBridge * bridgeToTarget;
  const edgeTargetPerSource = viaBridgeTargetPerSource - directTargetPerSource;
  const edgePct = directTargetPerSource > 0 ? (edgeTargetPerSource / directTargetPerSource) * 100 : 0;
  return {
    directTargetPerSource,
    sourceToBridge,
    bridgeToTarget,
    viaBridgeTargetPerSource,
    edgeTargetPerSource,
    edgePct,
    bestRoute: edgeTargetPerSource > 0 ? 'via-bridge' : 'direct'
  };
}

function updateDynamicLabels() {
  const route = currentRoute();
  ids.directRateLabel.textContent = `Direct: ${shortLabel(route.source)} -> ${shortLabel(route.target)}`;
  ids.firstRateLabel.textContent = `First: ${shortLabel(route.source)} -> ${shortLabel(route.bridge)}`;
  ids.secondRateLabel.textContent = `Then: ${shortLabel(route.bridge)} -> ${shortLabel(route.target)}`;
}

function calculate() {
  updateDynamicLabels();
  const route = currentRoute();
  const quantity = numberValue(ids.quantityInput);
  const targetStep = positiveNumberValue(ids.targetStepInput, 1);
  const routes = readManualRoutes();
  const unitDigits = targetStep >= 1 ? 0 : 2;
  const outcome = buildExchangeOutcome(routes, quantity, targetStep);

  ids.directTotal.textContent = `${formatNumber(outcome.directTarget, unitDigits)} ${shortLabel(route.target)}`;
  ids.viaTotal.textContent = `${formatNumber(outcome.viaTarget, unitDigits)} ${shortLabel(route.target)}`;
  ids.directMixed.textContent = leftoverText(outcome.directSourceLeft, route.source);
  ids.viaMixed.textContent = `${leftoverText(outcome.middleLeft, route.bridge)} from ${formatNumber(outcome.middleTotal, 2)} ${shortLabel(route.bridge)}`;
  ids.edgePerInput.textContent = `${formatSigned(outcome.valueDeltaPerSource, 4)} ${shortLabel(route.target)} value`;
  ids.totalEdge.textContent = `${formatSigned(outcome.valueDelta, 4)} ${shortLabel(route.target)} value`;
  ids.directRawValue.textContent = `${formatNumber(outcome.rawDirectTarget, 4)} ${shortLabel(route.target)}`;
  ids.directRawFraction.textContent = `${formatNumber(outcome.directRawFraction, 4)} ${shortLabel(route.target)}`;
  ids.middleLeftValue.textContent = `${formatNumber(outcome.middleLeftValue, 4)} ${shortLabel(route.target)}`;
  ids.middlePackageValue.textContent = `${formatNumber(outcome.middlePackageValue, 4)} ${shortLabel(route.target)}`;
  ids.wholePackageEdge.textContent = `${formatSigned(outcome.valueDelta, 4)} ${shortLabel(route.target)}`;
  ids.rawValueEdge.textContent = `${formatSigned(outcome.rawValueDelta, 4)} ${shortLabel(route.target)}`;

  const hasAllRates = routes.directTargetPerSource > 0 && routes.sourceToBridge > 0 && routes.bridgeToTarget > 0;
  ids.bestBadge.className = 'badge neutral';
  ids.verdictText.className = 'verdict';

  if (!hasAllRates) {
    ids.bestBadge.textContent = 'Waiting';
    ids.verdictText.textContent = 'Enter rates or refresh snapshot.';
    return;
  }

  if (outcome.valueDelta > 0) {
    ids.bestBadge.className = 'badge good';
    ids.bestBadge.textContent = 'Use Middle';
    ids.verdictText.className = 'verdict positive';
    if (outcome.targetDelta === 0 && outcome.middleLeft > 0) {
      ids.verdictText.textContent = `Trade through ${currencyLabel(route.bridge)}. It still gets ${formatNumber(outcome.viaTarget, unitDigits)} ${shortLabel(route.target)} and leaves about ${formatNumber(outcome.middleLeft, 2)} ${shortLabel(route.bridge)}. Whole-package edge is ${formatSigned(outcome.valueDelta, 4)} ${shortLabel(route.target)}; raw value edge is ${formatSigned(outcome.rawValueDelta, 4)} ${shortLabel(route.target)}.`;
    } else {
      ids.verdictText.textContent = `Trade through ${currencyLabel(route.bridge)}. Compared with direct, it changes whole wanted currency by ${formatSigned(outcome.targetDelta, unitDigits)} ${shortLabel(route.target)} and leaves about ${formatNumber(outcome.middleLeft, 2)} ${shortLabel(route.bridge)}. Whole-package edge is ${formatSigned(outcome.valueDelta, 4)} ${shortLabel(route.target)}; raw value edge is ${formatSigned(outcome.rawValueDelta, 4)} ${shortLabel(route.target)}.`;
    }
  } else if (outcome.valueDelta < 0) {
    ids.bestBadge.className = 'badge warn';
    ids.bestBadge.textContent = 'Direct';
    ids.verdictText.className = 'verdict negative';
    ids.verdictText.textContent = `Trade direct. The middle route changes whole wanted currency by ${formatSigned(outcome.targetDelta, unitDigits)} ${shortLabel(route.target)}, and its leftover is not enough to catch up. Whole-package edge is ${formatSigned(outcome.valueDelta, 4)} ${shortLabel(route.target)}; raw value edge is ${formatSigned(outcome.rawValueDelta, 4)} ${shortLabel(route.target)}.`;
  } else {
    ids.bestBadge.textContent = 'Even';
    ids.verdictText.textContent = `Both routes are about even after buying in ${formatNumber(targetStep, unitDigits)} ${shortLabel(route.target)} chunks and counting leftovers. Raw value edge is ${formatSigned(outcome.rawValueDelta, 4)} ${shortLabel(route.target)}.`;
  }
}

function applyMarket(market) {
  lastMarket = market;
  const routes = market.routes || {};
  ids.directRateInput.value = positiveOrBlank(routes.directTargetPerSource);
  ids.firstRateInput.value = positiveOrBlank(routes.sourceToBridge);
  ids.secondRateInput.value = positiveOrBlank(routes.bridgeToTarget);

  const sourceLabel = market.marketSource === 'official-trade-listings'
    ? 'Official listings'
    : 'POE2Scout snapshot';
  ids.sourceText.textContent = `${sourceLabel} · ${market.league}`;
  ids.cacheText.textContent = market.fromCache
    ? `Cache ${Math.round((market.cacheAgeMs || 0) / 1000)}s`
    : 'Fresh';
  ids.updatedText.textContent = `Updated ${new Date(market.fetchedAt).toLocaleTimeString()}`;
  renderLegs(market);
  calculate();
}

function resetOptimizer() {
  ids.optimizerText.textContent = 'Market path search';
  ids.optimizerResults.innerHTML = '<div class="optimizer-empty">Run Best Paths to rank possible trades.</div>';
}

function renderOptimizerResults(data) {
  const results = data?.results || [];
  const route = currentRoute();
  const target = data?.target || route.target;
  const source = data?.source || route.source;
  const targetStep = positiveNumberValue(ids.targetStepInput, 1);
  const unitDigits = targetStep >= 1 ? 0 : 2;
  const cacheText = data?.fromCache ? `cache ${Math.round((data.cacheAgeMs || 0) / 1000)}s` : 'fresh';

  ids.optimizerText.textContent = `${results.length} paths · ${formatNumber(data?.exploredStates || 0, 0)} states · ${formatNumber(data?.graphNodeCount || 0, 0)} nodes / ${formatNumber(data?.graphEdgeCount || 0, 0)} edges · ${cacheText}`;

  if (!results.length) {
    ids.optimizerResults.innerHTML = '<div class="optimizer-empty">No path found for the selected currencies and allowlist.</div>';
    return;
  }

  ids.optimizerResults.innerHTML = results.map((result, index) => {
    const routeText = result.path.map((apiId) => escapeHtml(shortLabel(apiId))).join(' -> ');
    const rawPer = `${formatRate(result.rawTargetPerSource)} ${escapeHtml(shortLabel(target))} / ${escapeHtml(shortLabel(source))}`;
    const rawTotal = `${formatNumber(result.rawTargetTotal, 4)} ${escapeHtml(shortLabel(target))}`;
    const actionable = `${formatNumber(result.actionableTargetTotal, unitDigits)} ${escapeHtml(shortLabel(target))}`;
    const leftover = result.leftoverAmount > 0
      ? ` + ${formatNumber(result.leftoverAmount, 2)} ${escapeHtml(shortLabel(result.leftoverCurrency))} left`
      : '';
    const liquidity = [
      Number.isFinite(Number(result.minVolume)) ? `min volume ${formatNumber(Number(result.minVolume), 0)}` : null,
      Number.isFinite(Number(result.minStock)) ? `min stock ${formatNumber(Number(result.minStock), 0)}` : null
    ].filter(Boolean).join(' · ') || 'liquidity unknown';
    const legs = (result.legs || [])
      .map((leg) => `${escapeHtml(shortLabel(leg.from))} -> ${escapeHtml(shortLabel(leg.to))} @ ${formatRate(leg.rate)}`)
      .join(' · ');
    const applyButton = result.path.length === 3
      ? `<button class="button ghost mini" type="button" data-bridge="${escapeHtml(result.path[1])}">Use Bridge</button>`
      : '';

    return `
      <div class="path-card${index === 0 ? ' best' : ''}">
        <div class="path-title">
          <strong>#${index + 1} ${actionable}${leftover}</strong>
          <span>${result.hops} step${result.hops === 1 ? '' : 's'}</span>
        </div>
        <div class="path-route">${routeText}</div>
        <div class="path-stats">
          <span>before rounding ${rawTotal}</span>
          <span>${rawPer}</span>
          <span>${liquidity}</span>
        </div>
        <div class="path-legs">${legs}</div>
        ${applyButton ? `<div class="path-actions">${applyButton}</div>` : ''}
      </div>
    `;
  }).join('');
}

async function optimizePaths() {
  setBusy(true);
  setStatus('loading', 'Optimizing');
  ids.optimizerText.textContent = 'Searching snapshot graph...';
  try {
    const route = currentRoute();
    const data = await window.poeArb.optimizeSnapshot({
      ...route,
      quantity: positiveNumberValue(ids.quantityInput, 1),
      targetStep: positiveNumberValue(ids.targetStepInput, 1),
      maxHops: integerNumberValue(ids.maxHopsInput, 3, 1, 5),
      maxResults: integerNumberValue(ids.maxResultsInput, 12, 1, 50),
      allowedApiIds: parseAllowlist()
    });
    renderOptimizerResults(data);
    setStatus('good', data.fromCache ? 'Cached' : 'Optimized');
  } catch (error) {
    setStatus('bad', 'Error');
    ids.optimizerText.textContent = error.message || 'Optimization failed';
    ids.optimizerResults.innerHTML = '<div class="optimizer-empty">Optimization failed. Check the selected league and currencies.</div>';
  } finally {
    setBusy(false);
  }
}

function positiveOrBlank(value) {
  return Number.isFinite(value) && value > 0 ? trimFloat(value) : '';
}

function trimFloat(value) {
  return Number(value.toFixed(10)).toString();
}

function renderLegs(market) {
  const legs = [
    market.legs?.direct,
    market.legs?.sourceToBridge,
    market.legs?.bridgeToTarget
  ];

  ids.legsContainer.innerHTML = '';
  for (const leg of legs) {
    const node = document.createElement('div');
    node.className = `leg${leg?.error ? ' error' : ''}`;
    node.innerHTML = `
      <div class="leg-title">${escapeHtml(labelForLeg(leg))}</div>
      <div class="leg-rate">${formatRate(leg?.rate)} <span class="muted">${escapeHtml(shortLabel(leg?.want))}</span></div>
      <div class="leg-meta">
        <span>${escapeHtml(metaLineOne(leg))}</span>
        <span>${escapeHtml(metaLineTwo(leg))}</span>
        <span>${escapeHtml(metaLineThree(leg))}</span>
      </div>
    `;
    ids.legsContainer.appendChild(node);
  }

  if (market.errors?.length) {
    const node = document.createElement('div');
    node.className = 'leg error';
    node.innerHTML = `
      <div class="leg-title">API</div>
      <div class="leg-rate">Partial</div>
      <div class="leg-meta">
        ${market.errors.map((err) => `<span>${escapeHtml(err.leg)}: ${escapeHtml(err.message)}</span>`).join('')}
      </div>
    `;
    ids.legsContainer.appendChild(node);
  }
}

function labelForLeg(leg) {
  if (!leg) return 'Missing';
  return `${shortLabel(leg.have)} -> ${shortLabel(leg.want)}`;
}

function metaLineOne(leg) {
  if (!leg) return 'No data';
  if (leg.error) return leg.error;
  if (Array.isArray(leg.offers)) return `${leg.offers.length} parsed offers · total ${leg.total ?? '--'}`;
  return leg.pairId ? `Pair ${leg.pairId} · volume ${formatNumber(leg.volumeBaseValue, 0)}` : 'No direct pair in snapshot';
}

function metaLineTwo(leg) {
  if (!leg) return '';
  if (Array.isArray(leg.offers)) {
    const top = leg.offers[0];
    return top ? `Top stock ${formatNumber(top.wantStock, 0)} · ${top.status}` : 'No matching offer';
  }
  return `Have volume ${formatNumber(leg.haveVolumeTraded, 0)} · Want volume ${formatNumber(leg.wantVolumeTraded, 0)}`;
}

function metaLineThree(leg) {
  if (!leg) return '';
  if (Array.isArray(leg.offers)) {
    const top = leg.offers[0];
    return top?.indexed ? `Indexed ${new Date(top.indexed).toLocaleTimeString()}` : 'Manual check advised';
  }
  return `Highest stock ${formatNumber(leg.haveHighestStock, 0)} / ${formatNumber(leg.wantHighestStock, 0)}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function populateLeagues(nextLeagues, selectedValue) {
  leagues = nextLeagues || [];
  ids.leagueSelect.innerHTML = '';
  for (const league of leagues) {
    const option = document.createElement('option');
    option.value = league.Value;
    option.textContent = league.IsCurrent ? `${league.Value} (current)` : league.Value;
    ids.leagueSelect.appendChild(option);
  }
  ids.leagueSelect.value = selectedValue || leagues.find((league) => league.IsCurrent)?.Value || DEFAULTS.league;
}

function populateCurrencySelects(nextCatalog) {
  catalog = nextCatalog;
  const selected = currentRoute();
  const fallbackCurrency = catalog.currencies?.[0]?.apiId || '';
  for (const select of [ids.sourceSelect, ids.bridgeSelect, ids.targetSelect]) {
    select.innerHTML = '';
    for (const group of catalog.categories || []) {
      if (!group.items?.length) continue;
      const optGroup = document.createElement('optgroup');
      optGroup.label = group.label;
      for (const item of group.items) {
        const option = document.createElement('option');
        option.value = item.apiId;
        option.textContent = item.text;
        optGroup.appendChild(option);
      }
      select.appendChild(optGroup);
    }
  }
  ids.sourceSelect.value = selected.source || DEFAULTS.source;
  ids.bridgeSelect.value = selected.bridge || DEFAULTS.bridge;
  ids.targetSelect.value = selected.target || DEFAULTS.target;
  if (!ids.sourceSelect.value) ids.sourceSelect.value = fallbackCurrency;
  if (!ids.bridgeSelect.value) ids.bridgeSelect.value = fallbackCurrency;
  if (!ids.targetSelect.value) ids.targetSelect.value = fallbackCurrency;
  ids.catalogText.textContent = `${catalog.currencies?.length || 0} currencies · ${catalog.categories?.length || 0} categories`;
  updateDynamicLabels();
}

async function initialize() {
  setBusy(true);
  setStatus('loading', 'Loading');
  try {
    const data = await window.poeArb.fetchBootstrap(DEFAULTS);
    populateLeagues(data.leagues, data.defaults.league);
    populateCurrencySelects(data.catalog);
    setStatus('good', 'Loaded');
    ids.sourceText.textContent = 'Catalog loaded from POE2Scout';
    await refreshSnapshot();
  } catch (error) {
    setStatus('bad', 'Error');
    ids.sourceText.textContent = error.message || 'Startup failed';
  } finally {
    setBusy(false);
  }
}

async function reloadCatalog() {
  setBusy(true);
  setStatus('loading', 'Catalog');
  try {
    const nextCatalog = await window.poeArb.fetchCatalog(currentRoute());
    populateCurrencySelects(nextCatalog);
    setStatus('good', 'Loaded');
    ids.sourceText.textContent = `Catalog loaded for ${ids.leagueSelect.value}`;
  } catch (error) {
    setStatus('bad', 'Error');
    ids.sourceText.textContent = error.message || 'Catalog refresh failed';
  } finally {
    setBusy(false);
  }
}

async function refreshSnapshot() {
  setBusy(true);
  setStatus('loading', 'Snapshot');
  try {
    const market = await window.poeArb.fetchSnapshotRoute(currentRoute());
    applyMarket(market);
    setStatus('good', market.fromCache ? 'Cached' : 'Loaded');
  } catch (error) {
    setStatus('bad', 'Error');
    ids.sourceText.textContent = error.message || 'Snapshot refresh failed';
  } finally {
    setBusy(false);
  }
}

async function refreshOfficial() {
  setBusy(true);
  setStatus('loading', 'Checking');
  try {
    const market = await window.poeArb.fetchOfficialRoute(currentRoute());
    applyMarket(market);
    setStatus(market.errors?.length ? 'bad' : 'good', market.errors?.length ? 'Partial' : 'Loaded');
  } catch (error) {
    setStatus('bad', 'Limited');
    ids.sourceText.textContent = error.message || 'Official listing refresh failed';
  } finally {
    setBusy(false);
  }
}

function clearRates() {
  ids.directRateInput.value = '';
  ids.firstRateInput.value = '';
  ids.secondRateInput.value = '';
  calculate();
}

function useLastMarket() {
  if (lastMarket) applyMarket(lastMarket);
}

function openScout() {
  window.poeArb.openExternal('https://poe2scout.com/');
}

function openTrade() {
  window.poeArb.openExternal('https://www.pathofexile.com/trade2');
}

for (const input of [ids.quantityInput, ids.targetStepInput, ids.directRateInput, ids.firstRateInput, ids.secondRateInput]) {
  input.addEventListener('input', calculate);
}

for (const input of [ids.quantityInput, ids.targetStepInput, ids.maxHopsInput, ids.maxResultsInput, ids.allowlistInput]) {
  input.addEventListener('input', resetOptimizer);
}

for (const select of [ids.sourceSelect, ids.bridgeSelect, ids.targetSelect]) {
  select.addEventListener('change', () => {
    updateDynamicLabels();
    calculate();
    resetOptimizer();
  });
}

ids.leagueSelect.addEventListener('change', async () => {
  resetOptimizer();
  await reloadCatalog();
  await refreshSnapshot();
});
ids.catalogButton.addEventListener('click', reloadCatalog);
ids.snapshotButton.addEventListener('click', refreshSnapshot);
ids.officialButton.addEventListener('click', refreshOfficial);
ids.optimizeButton.addEventListener('click', optimizePaths);
ids.clearButton.addEventListener('click', clearRates);
ids.sampleButton.addEventListener('click', useLastMarket);
ids.openScoutButton.addEventListener('click', openScout);
ids.openTradeButton.addEventListener('click', openTrade);
ids.optimizerResults.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-bridge]');
  if (!button) return;
  ids.bridgeSelect.value = button.dataset.bridge;
  updateDynamicLabels();
  calculate();
  await refreshSnapshot();
});

initialize();
