import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ArrowRightLeft,
  Database,
  ExternalLink,
  Globe2,
  Network,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULTS,
  fetchBootstrap,
  fetchCatalog,
  fetchOfficialRoute,
  fetchSnapshotRoute,
  openExternal,
  optimizeSnapshot
} from './api';
import { CurrencyCombobox } from './components/CurrencyCombobox';
import { Badge, Button, Card, CardDescription, CardHeader, CardTitle, Field, Input } from './components/ui';
import {
  buildExchangeOutcome,
  currencyLabel,
  formatNumber,
  formatRate,
  formatSigned,
  integerNumberValue,
  leftoverText,
  metaLineOne,
  metaLineThree,
  metaLineTwo,
  numberValue,
  parseAllowlist,
  positiveNumberValue,
  positiveOrBlank,
  readRates,
  shortLabel,
  type RateInputs
} from './exchange';
import type { Catalog, Leg, Market, OptimizerData, Route } from './types';

type StatusKind = 'idle' | 'loading' | 'good' | 'bad';

const emptyRates: RateInputs = {
  direct: '',
  first: '',
  second: ''
};

function marketRates(market?: Market | null): RateInputs {
  const routes = market?.routes || {};
  return {
    direct: positiveOrBlank(routes.directTargetPerSource),
    first: positiveOrBlank(routes.sourceToBridge),
    second: positiveOrBlank(routes.bridgeToTarget)
  };
}

function marketSource(market?: Market | null) {
  if (!market) return 'No market loaded';
  return market.marketSource === 'official-trade-listings' ? 'Official listings' : 'POE2Scout snapshot';
}

function statusLabel(kind: StatusKind, text: string) {
  return <span className={`status-pill ${kind}`}>{text}</span>;
}

export function App() {
  const [route, setRoute] = useState<Route>(DEFAULTS);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [rateInputs, setRateInputs] = useState<RateInputs>(emptyRates);
  const [quantity, setQuantity] = useState('2');
  const [targetStep, setTargetStep] = useState('1');
  const [maxHops, setMaxHops] = useState('3');
  const [maxResults, setMaxResults] = useState('12');
  const [allowlist, setAllowlist] = useState('');
  const [lastMarket, setLastMarket] = useState<Market | null>(null);
  const [optimizerData, setOptimizerData] = useState<OptimizerData | null>(null);
  const [status, setStatus] = useState<{ kind: StatusKind; text: string }>({ kind: 'idle', text: 'Starting' });

  const bootstrapQuery = useQuery({
    queryKey: ['bootstrap', DEFAULTS.realm, DEFAULTS.league],
    queryFn: () => fetchBootstrap(DEFAULTS),
    staleTime: 15 * 60_000
  });

  useEffect(() => {
    if (!bootstrapQuery.data) return;
    setCatalog((current) => current || bootstrapQuery.data.catalog);
    setRoute((current) => ({
      ...current,
      league: bootstrapQuery.data.defaults.league || current.league
    }));
    setStatus({ kind: 'good', text: 'Loaded' });
  }, [bootstrapQuery.data]);

  useEffect(() => {
    if (bootstrapQuery.error) {
      setStatus({ kind: 'bad', text: 'Error' });
    }
  }, [bootstrapQuery.error]);

  const snapshotQuery = useQuery({
    queryKey: ['snapshot-route', route],
    queryFn: () => fetchSnapshotRoute(route),
    enabled: Boolean(catalog),
    staleTime: 60_000
  });

  useEffect(() => {
    if (!snapshotQuery.data) return;
    setLastMarket(snapshotQuery.data);
    setRateInputs(marketRates(snapshotQuery.data));
    setStatus({ kind: 'good', text: snapshotQuery.data.fromCache ? 'Cached' : 'Loaded' });
  }, [snapshotQuery.data]);

  useEffect(() => {
    if (snapshotQuery.error) setStatus({ kind: 'bad', text: 'Snapshot' });
  }, [snapshotQuery.error]);

  const catalogMutation = useMutation({
    mutationFn: fetchCatalog,
    onMutate: () => setStatus({ kind: 'loading', text: 'Catalog' }),
    onSuccess: (nextCatalog) => {
      setCatalog(nextCatalog);
      setStatus({ kind: 'good', text: 'Loaded' });
    },
    onError: () => setStatus({ kind: 'bad', text: 'Catalog' })
  });

  const officialMutation = useMutation({
    mutationFn: fetchOfficialRoute,
    onMutate: () => setStatus({ kind: 'loading', text: 'Checking' }),
    onSuccess: (market) => {
      setLastMarket(market);
      setRateInputs(marketRates(market));
      setStatus({ kind: market.errors?.length ? 'bad' : 'good', text: market.errors?.length ? 'Partial' : 'Loaded' });
    },
    onError: () => setStatus({ kind: 'bad', text: 'Limited' })
  });

  const optimizerMutation = useMutation({
    mutationFn: optimizeSnapshot,
    onMutate: () => {
      setOptimizerData(null);
      setStatus({ kind: 'loading', text: 'Optimizing' });
    },
    onSuccess: (data) => {
      setOptimizerData(data);
      setStatus({ kind: 'good', text: data.fromCache ? 'Cached' : 'Optimized' });
    },
    onError: () => setStatus({ kind: 'bad', text: 'Paths' })
  });

  const leagues = bootstrapQuery.data?.leagues || [];
  const rates = useMemo(() => readRates(rateInputs), [rateInputs]);
  const quantityNumber = numberValue(quantity);
  const targetStepNumber = positiveNumberValue(targetStep, 1);
  const targetDigits = targetStepNumber >= 1 ? 0 : 2;
  const outcome = useMemo(
    () => buildExchangeOutcome(rates, quantityNumber, targetStepNumber),
    [rates, quantityNumber, targetStepNumber]
  );
  const hasAllRates = rates.directTargetPerSource > 0 && rates.sourceToBridge > 0 && rates.bridgeToTarget > 0;
  const bestCall = !hasAllRates ? 'Waiting' : outcome.valueDelta > 0 ? 'Use Middle' : outcome.valueDelta < 0 ? 'Direct' : 'Even';
  const bestTone = !hasAllRates ? 'neutral' : outcome.valueDelta > 0 ? 'good' : outcome.valueDelta < 0 ? 'warn' : 'neutral';

  const verdict = useMemo(() => {
    if (!hasAllRates) return 'Enter rates or refresh the market.';
    if (outcome.valueDelta > 0 && outcome.targetDelta === 0 && outcome.middleLeft > 0) {
      return `Trade through ${currencyLabel(catalog, route.bridge)}. It still gets ${formatNumber(outcome.viaTarget, targetDigits)} ${shortLabel(catalog, route.target)} and leaves ${formatNumber(outcome.middleLeft, 2)} ${shortLabel(catalog, route.bridge)}.`;
    }
    if (outcome.valueDelta > 0) {
      return `Trade through ${currencyLabel(catalog, route.bridge)}. Whole wanted currency changes by ${formatSigned(outcome.targetDelta, targetDigits)} ${shortLabel(catalog, route.target)} and leftovers add value.`;
    }
    if (outcome.valueDelta < 0) {
      return `Trade direct. The middle route leftovers do not catch up after whole-currency rounding.`;
    }
    return `Both routes are even after rounding and leftover value.`;
  }, [catalog, hasAllRates, outcome, route.bridge, route.target, targetDigits]);

  function updateRoute(key: keyof Route, value: string) {
    setRoute((current) => ({ ...current, [key]: value }));
    setOptimizerData(null);
  }

  function refreshSnapshot() {
    setStatus({ kind: 'loading', text: 'Snapshot' });
    void snapshotQuery.refetch();
  }

  function reloadCatalog() {
    catalogMutation.mutate(route);
  }

  function refreshOfficial() {
    officialMutation.mutate(route);
  }

  function runOptimizer() {
    optimizerMutation.mutate({
      ...route,
      quantity: positiveNumberValue(quantity, 1),
      targetStep: positiveNumberValue(targetStep, 1),
      maxHops: integerNumberValue(maxHops, 3, 1, 5),
      maxResults: integerNumberValue(maxResults, 12, 1, 50),
      allowedApiIds: parseAllowlist(allowlist)
    });
  }

  function useLastMarket() {
    if (lastMarket) setRateInputs(marketRates(lastMarket));
  }

  const busy = bootstrapQuery.isLoading || catalogMutation.isPending || officialMutation.isPending || optimizerMutation.isPending;
  const snapshotBusy = snapshotQuery.isFetching && !snapshotQuery.isLoading;
  const sourceText = lastMarket
    ? `${marketSource(lastMarket)} for ${lastMarket.league}`
    : bootstrapQuery.isLoading
      ? 'Loading POE2Scout catalog'
      : 'Catalog ready';
  const cacheText = lastMarket?.fromCache
    ? `Cache ${Math.round((lastMarket.cacheAgeMs || 0) / 1000)}s`
    : lastMarket
      ? 'Fresh'
      : 'No cache';
  const updatedText = lastMarket?.fetchedAt ? `Updated ${new Date(lastMarket.fetchedAt).toLocaleTimeString()}` : 'Not updated';

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Path of Exile 2</p>
          <h1>Currency Exchange Check</h1>
        </div>
        <div className="header-actions">
          {statusLabel(status.kind, snapshotBusy ? 'Refreshing' : status.text)}
          <Button variant="quiet" onClick={() => openExternal('https://poe2scout.com/')} title="Open POE2Scout">
            <Globe2 size={16} />
            POE2Scout
          </Button>
          <Button variant="quiet" onClick={() => openExternal('https://www.pathofexile.com/trade2')} title="Open Path of Exile trade site">
            <ExternalLink size={16} />
            Trade
          </Button>
        </div>
      </header>

      <section className="market-strip">
        <div>
          <strong>{sourceText}</strong>
          <span>{catalog ? `${catalog.currencies.length} currencies, ${catalog.categories.length} groups` : 'No catalog'}</span>
        </div>
        <div>
          <strong>{cacheText}</strong>
          <span>{updatedText}</span>
        </div>
        <div>
          <strong>{route.league}</strong>
          <span>{route.realm}</span>
        </div>
      </section>

      <section className="route-grid">
        <Card className="route-card">
          <CardHeader>
            <div>
              <CardTitle>Route</CardTitle>
              <CardDescription>I have X, I want Y, optionally through Z.</CardDescription>
            </div>
            <Button variant="ghost" onClick={reloadCatalog} disabled={busy} title="Reload currencies for this league">
              <Database size={16} />
              Reload
            </Button>
          </CardHeader>

          <div className="route-form">
            <Field label="League">
              <select className="input" value={route.league} onChange={(event) => updateRoute('league', event.target.value)}>
                {leagues.map((league) => (
                  <option key={league.Value} value={league.Value}>
                    {league.IsCurrent ? `${league.Value} (current)` : league.Value}
                  </option>
                ))}
              </select>
            </Field>
            <CurrencyCombobox id="sourceCurrency" label="I have" value={route.source} catalog={catalog} onChange={(value) => updateRoute('source', value)} />
            <CurrencyCombobox id="bridgeCurrency" label="Try through" value={route.bridge} catalog={catalog} onChange={(value) => updateRoute('bridge', value)} />
            <CurrencyCombobox id="targetCurrency" label="I want" value={route.target} catalog={catalog} onChange={(value) => updateRoute('target', value)} />
            <Field label="Amount I have">
              <Input type="number" min="0" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
            </Field>
            <Field label="Buy in chunks of">
              <Input type="number" min="0.000001" step="1" value={targetStep} onChange={(event) => setTargetStep(event.target.value)} />
            </Field>
          </div>
        </Card>

        <DecisionCard
          bestCall={bestCall}
          bestTone={bestTone}
          catalog={catalog}
          outcome={outcome}
          route={route}
          targetDigits={targetDigits}
          verdict={verdict}
        />
      </section>

      <section className="work-grid">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Prices</CardTitle>
              <CardDescription>{cacheText}</CardDescription>
            </div>
            <div className="button-row">
              <Button variant="ghost" onClick={() => setRateInputs(emptyRates)} title="Clear manual rates">
                <RotateCcw size={16} />
                Clear
              </Button>
              <Button variant="ghost" onClick={useLastMarket} disabled={!lastMarket} title="Use last fetched market">
                <ArrowRightLeft size={16} />
                Last
              </Button>
              <Button variant="primary" onClick={refreshSnapshot} disabled={busy} title="Refresh market rates from POE2Scout">
                <RefreshCw size={16} />
                Snapshot
              </Button>
              <Button variant="default" onClick={refreshOfficial} disabled={busy} title="Refresh selected legs from the official trade site">
                <Search size={16} />
                Official
              </Button>
            </div>
          </CardHeader>

          <div className="rate-grid">
            <Field label={`Direct: ${shortLabel(catalog, route.source)} -> ${shortLabel(catalog, route.target)}`}>
              <Input type="number" min="0" step="0.000001" value={rateInputs.direct} onChange={(event) => setRateInputs((current) => ({ ...current, direct: event.target.value }))} />
            </Field>
            <Field label={`First: ${shortLabel(catalog, route.source)} -> ${shortLabel(catalog, route.bridge)}`}>
              <Input type="number" min="0" step="0.000001" value={rateInputs.first} onChange={(event) => setRateInputs((current) => ({ ...current, first: event.target.value }))} />
            </Field>
            <Field label={`Then: ${shortLabel(catalog, route.bridge)} -> ${shortLabel(catalog, route.target)}`}>
              <Input type="number" min="0" step="0.000001" value={rateInputs.second} onChange={(event) => setRateInputs((current) => ({ ...current, second: event.target.value }))} />
            </Field>
          </div>
        </Card>

        <OptimizerCard
          allowlist={allowlist}
          catalog={catalog}
          data={optimizerData}
          maxHops={maxHops}
          maxResults={maxResults}
          pending={optimizerMutation.isPending}
          route={route}
          targetDigits={targetDigits}
          setAllowlist={setAllowlist}
          setMaxHops={setMaxHops}
          setMaxResults={setMaxResults}
          onRun={runOptimizer}
          onUseBridge={(bridge) => {
            updateRoute('bridge', bridge);
            setStatus({ kind: 'loading', text: 'Snapshot' });
            window.setTimeout(() => void snapshotQuery.refetch(), 0);
          }}
        />
      </section>

      <LegsCard catalog={catalog} market={lastMarket} />
    </main>
  );
}

function DecisionCard({
  bestCall,
  bestTone,
  catalog,
  outcome,
  route,
  targetDigits,
  verdict
}: {
  bestCall: string;
  bestTone: string;
  catalog: Catalog | null;
  outcome: ReturnType<typeof buildExchangeOutcome>;
  route: Route;
  targetDigits: number;
  verdict: string;
}) {
  const target = shortLabel(catalog, route.target);
  return (
    <Card className="decision-panel">
      <CardHeader>
        <div>
          <CardTitle>Decision</CardTitle>
          <CardDescription>{formatSigned(outcome.valueDeltaPerSource, 4)} {target} value per item</CardDescription>
        </div>
        <Badge className={`badge-${bestTone}`}>{bestCall}</Badge>
      </CardHeader>

      <div className="decision-meter">
        <Metric label="Extra per item" value={`${formatSigned(outcome.valueDeltaPerSource, 4)} ${target}`} />
        <Metric label="Extra total" value={`${formatSigned(outcome.valueDelta, 4)} ${target}`} />
      </div>

      <div className="trade-comparison">
        <div className="trade-card">
          <span>Trade direct</span>
          <strong>{formatNumber(outcome.directTarget, targetDigits)} {target}</strong>
          <small>{leftoverText(catalog, outcome.directSourceLeft, route.source)}</small>
        </div>
        <div className="trade-card featured">
          <span>Trade through middle</span>
          <strong>{formatNumber(outcome.viaTarget, targetDigits)} {target}</strong>
          <small>{leftoverText(catalog, outcome.middleLeft, route.bridge)} from {formatNumber(outcome.middleTotal, 2)} {shortLabel(catalog, route.bridge)}</small>
        </div>
      </div>

      <div className="comparison-grid">
        <Metric label="Direct raw value" value={`${formatNumber(outcome.rawDirectTarget, 4)} ${target}`} />
        <Metric label="Direct raw fraction" value={`${formatNumber(outcome.directRawFraction, 4)} ${target}`} />
        <Metric label="Leftover value" value={`${formatNumber(outcome.middleLeftValue, 4)} ${target}`} />
        <Metric label="Middle package" value={`${formatNumber(outcome.middlePackageValue, 4)} ${target}`} />
        <Metric label="Whole-package edge" value={`${formatSigned(outcome.valueDelta, 4)} ${target}`} />
        <Metric label="Raw value edge" value={`${formatSigned(outcome.rawValueDelta, 4)} ${target}`} />
      </div>

      <p className={`verdict ${outcome.valueDelta > 0 ? 'positive' : outcome.valueDelta < 0 ? 'negative' : ''}`}>{verdict}</p>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function OptimizerCard({
  allowlist,
  catalog,
  data,
  maxHops,
  maxResults,
  pending,
  route,
  targetDigits,
  setAllowlist,
  setMaxHops,
  setMaxResults,
  onRun,
  onUseBridge
}: {
  allowlist: string;
  catalog: Catalog | null;
  data: OptimizerData | null;
  maxHops: string;
  maxResults: string;
  pending: boolean;
  route: Route;
  targetDigits: number;
  setAllowlist: (value: string) => void;
  setMaxHops: (value: string) => void;
  setMaxResults: (value: string) => void;
  onRun: () => void;
  onUseBridge: (bridge: string) => void;
}) {
  const target = data?.target || route.target;
  const source = data?.source || route.source;
  const stats = data
    ? `${data.results.length} paths, ${formatNumber(data.exploredStates || 0, 0)} states, ${formatNumber(data.graphNodeCount || 0, 0)} nodes`
    : 'Market path search';

  return (
    <Card className="optimizer-card">
      <CardHeader>
        <div>
          <CardTitle>Best Paths</CardTitle>
          <CardDescription>{stats}</CardDescription>
        </div>
        <Button variant="primary" onClick={onRun} disabled={pending} title="Find best bounded paths through snapshot rates">
          <Network size={16} />
          Optimize
        </Button>
      </CardHeader>

      <div className="optimizer-controls">
        <Field label="Max steps">
          <Input type="number" min="1" max="5" step="1" value={maxHops} onChange={(event) => setMaxHops(event.target.value)} />
        </Field>
        <Field label="Results">
          <Input type="number" min="1" max="50" step="1" value={maxResults} onChange={(event) => setMaxResults(event.target.value)} />
        </Field>
        <Field label="Only use these" className="wide">
          <textarea className="input textarea" rows={2} value={allowlist} onChange={(event) => setAllowlist(event.target.value)} placeholder="currency api ids, comma or space separated" />
        </Field>
      </div>

      <div className="path-list">
        {!data ? <div className="empty-state">Run Best Paths to rank possible trades.</div> : null}
        {data && !data.results.length ? <div className="empty-state">No path found for the selected currencies and allowlist.</div> : null}
        {data?.results.map((result, index) => {
          const routeText = result.path.map((apiId) => shortLabel(catalog, apiId)).join(' -> ');
          const leftover = result.leftoverAmount > 0
            ? ` + ${formatNumber(result.leftoverAmount, 2)} ${shortLabel(catalog, result.leftoverCurrency)} left`
            : '';
          const liquidity = [
            Number.isFinite(Number(result.minVolume)) ? `min volume ${formatNumber(result.minVolume, 0)}` : null,
            Number.isFinite(Number(result.minStock)) ? `min stock ${formatNumber(result.minStock, 0)}` : null
          ].filter(Boolean).join(', ') || 'liquidity unknown';

          return (
            <div className={`path-card ${index === 0 ? 'best' : ''}`} key={`${result.path.join('|')}-${index}`}>
              <div className="path-title">
                <strong>#{index + 1} {formatNumber(result.actionableTargetTotal, targetDigits)} {shortLabel(catalog, target)}{leftover}</strong>
                <span>{result.hops} step{result.hops === 1 ? '' : 's'}</span>
              </div>
              <div className="path-route">{routeText}</div>
              <div className="path-stats">
                <span>before rounding {formatNumber(result.rawTargetTotal, 4)} {shortLabel(catalog, target)}</span>
                <span>{formatRate(result.rawTargetPerSource)} {shortLabel(catalog, target)} / {shortLabel(catalog, source)}</span>
                <span>{liquidity}</span>
              </div>
              <div className="path-legs">
                {(result.legs || []).map((leg) => `${shortLabel(catalog, leg.from)} -> ${shortLabel(catalog, leg.to)} @ ${formatRate(leg.rate)}`).join(', ')}
              </div>
              {result.path.length === 3 ? (
                <div className="path-actions">
                  <Button variant="ghost" size="sm" onClick={() => onUseBridge(result.path[1])}>Use Bridge</Button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function LegsCard({ catalog, market }: { catalog: Catalog | null; market: Market | null }) {
  const legs: Array<Leg | undefined> = [
    market?.legs?.direct,
    market?.legs?.sourceToBridge,
    market?.legs?.bridgeToTarget
  ];

  return (
    <Card className="legs-panel">
      <CardHeader>
        <div>
          <CardTitle>Legs</CardTitle>
          <CardDescription>{market?.fetchedAt ? `Updated ${new Date(market.fetchedAt).toLocaleTimeString()}` : 'Not updated'}</CardDescription>
        </div>
        <Sparkles size={18} aria-hidden="true" />
      </CardHeader>

      <div className="legs-grid">
        {legs.map((leg, index) => (
          <LegCard catalog={catalog} leg={leg} key={`${leg?.have || 'missing'}-${leg?.want || index}`} />
        ))}
        {market?.errors?.length ? (
          <div className="leg-card error">
            <strong>API</strong>
            <span>Partial</span>
            {market.errors.map((error, index) => (
              <small key={`${error.leg}-${index}`}>{error.leg}: {error.message}</small>
            ))}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function LegCard({ catalog, leg }: { catalog: Catalog | null; leg?: Leg }) {
  const title = leg ? `${shortLabel(catalog, leg.have)} -> ${shortLabel(catalog, leg.want)}` : 'Missing';
  return (
    <div className={`leg-card ${leg?.error ? 'error' : ''}`}>
      <strong>{title}</strong>
      <span>{formatRate(leg?.rate)} <small>{shortLabel(catalog, leg?.want)}</small></span>
      <small>{metaLineOne(catalog, leg)}</small>
      <small>{metaLineTwo(leg)}</small>
      <small>{metaLineThree(leg)}</small>
    </div>
  );
}
