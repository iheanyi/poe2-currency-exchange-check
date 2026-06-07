export type Route = {
  realm: string;
  league: string;
  source: string;
  bridge: string;
  target: string;
};

export type League = {
  Value: string;
  IsCurrent?: boolean;
};

export type Currency = {
  apiId: string;
  text: string;
  categoryApiId?: string;
  categoryLabel?: string;
  iconUrl?: string;
  currentPrice?: number | null;
  currentQuantity?: number | null;
};

export type CurrencyCategory = {
  apiId: string;
  label: string;
  items: Currency[];
};

export type Catalog = {
  realm: string;
  league: string;
  fetchedAt: string;
  fromCache?: boolean;
  cacheAgeMs?: number;
  cacheTtlMs?: number;
  categories: CurrencyCategory[];
  currencies: Currency[];
  defaults?: Partial<Route>;
};

export type Bootstrap = {
  realms: unknown[];
  leagues: League[];
  catalog: Catalog;
  defaults: Route;
};

export type Rates = {
  directTargetPerSource: number;
  sourceToBridge: number;
  bridgeToTarget: number;
  viaBridgeTargetPerSource?: number;
  edgeTargetPerSource?: number;
  edgePct?: number;
  bestRoute?: string;
};

export type Leg = {
  have?: string;
  want?: string;
  rate?: number | null;
  total?: number | null;
  pairId?: string | number | null;
  volumeBaseValue?: number | null;
  haveVolumeTraded?: number | null;
  wantVolumeTraded?: number | null;
  haveHighestStock?: number | null;
  wantHighestStock?: number | null;
  offers?: Array<{
    wantStock?: number | null;
    status?: string;
    indexed?: string;
  }>;
  error?: string;
};

export type Market = {
  marketSource?: string;
  league: string;
  fetchedAt: string;
  fromCache?: boolean;
  cacheAgeMs?: number;
  cacheTtlMs?: number;
  blockedUntil?: string | number | null;
  errors?: Array<{ leg?: string; message?: string }>;
  routes?: Partial<Rates>;
  legs?: {
    direct?: Leg;
    sourceToBridge?: Leg;
    bridgeToTarget?: Leg;
  };
};

export type OptimizerResult = {
  path: string[];
  hops: number;
  rawTargetPerSource: number;
  rawTargetTotal: number;
  actionableTargetTotal: number;
  leftoverAmount: number;
  leftoverCurrency: string;
  minVolume?: number | null;
  minStock?: number | null;
  legs?: Array<{ from: string; to: string; rate: number }>;
};

export type OptimizerData = {
  source: string;
  target: string;
  fromCache?: boolean;
  cacheAgeMs?: number;
  cacheTtlMs?: number;
  exploredStates?: number;
  graphNodeCount?: number;
  graphEdgeCount?: number;
  results: OptimizerResult[];
};

declare global {
  interface Window {
    poeArb: {
      fetchBootstrap: (route: Partial<Route>) => Promise<Bootstrap>;
      fetchCatalog: (route: Partial<Route>) => Promise<Catalog>;
      fetchSnapshotRoute: (route: Route) => Promise<Market>;
      fetchOfficialRoute: (route: Route) => Promise<Market>;
      optimizeSnapshot: (input: Route & {
        quantity: number;
        targetStep: number;
        maxHops: number;
        maxResults: number;
        allowedApiIds: string[];
      }) => Promise<OptimizerData>;
      openExternal: (url: string) => Promise<void>;
    };
  }
}
