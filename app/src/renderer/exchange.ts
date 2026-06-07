import type { Catalog, Leg, Rates } from './types';

export type RateInputs = {
  direct: string;
  first: string;
  second: string;
};

export function numberValue(value: string | number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function positiveNumberValue(value: string | number, fallback = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function integerNumberValue(value: string | number, fallback: number, min: number, max: number) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export function parseAllowlist(value: string) {
  return [
    ...new Set(
      value
        .split(/[\s,;]+/g)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  ];
}

export function trimFloat(value: number) {
  return Number(value.toFixed(10)).toString();
}

export function positiveOrBlank(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? trimFloat(parsed) : '';
}

export function readRates(inputs: RateInputs): Rates {
  const directTargetPerSource = numberValue(inputs.direct);
  const sourceToBridge = numberValue(inputs.first);
  const bridgeToTarget = numberValue(inputs.second);
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

export function floorToStep(value: number, step: number) {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return value;
  const scaled = Math.floor((value + Number.EPSILON) / step) * step;
  return Number(scaled.toFixed(10));
}

export function buildExchangeOutcome(routes: Rates, quantity: number, targetStep: number) {
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

export function formatNumber(value: unknown, digits = 2) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '--';
  return parsed.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: parsed < 10 && parsed !== 0 ? Math.min(2, digits) : 0
  });
}

export function formatRate(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '--';
  if (parsed >= 100) return formatNumber(parsed, 2);
  if (parsed >= 10) return formatNumber(parsed, 3);
  return formatNumber(parsed, 6);
}

export function formatSigned(value: unknown, digits = 2) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '--';
  const sign = parsed > 0 ? '+' : parsed < 0 ? '-' : '';
  return `${sign}${formatNumber(Math.abs(parsed), digits)}`;
}

export function currencyLabel(catalog: Catalog | null, apiId?: string) {
  const found = catalog?.currencies?.find((item) => item.apiId === apiId);
  return found?.text || apiId || '--';
}

export function shortLabel(catalog: Catalog | null, apiId?: string) {
  return currencyLabel(catalog, apiId)
    .replace(/\bOrb\b/g, '')
    .replace(/\bPerfect\b/g, 'Perf.')
    .replace(/\bGreater\b/g, 'Gr.')
    .replace(/\bLesser\b/g, 'Less.')
    .replace(/\s+/g, ' ')
    .trim();
}

export function leftoverText(catalog: Catalog | null, amount: number, apiId: string) {
  if (!Number.isFinite(amount) || amount <= 0) return `+ 0 ${shortLabel(catalog, apiId)} left`;
  const digits = amount >= 10 ? 2 : 4;
  return `+ ${formatNumber(amount, digits)} ${shortLabel(catalog, apiId)} left`;
}

export function metaLineOne(catalog: Catalog | null, leg?: Leg) {
  if (!leg) return 'No data';
  if (leg.error) return leg.error;
  if (Array.isArray(leg.offers)) return `${leg.offers.length} parsed offers, total ${leg.total ?? '--'}`;
  return leg.pairId ? `Pair ${leg.pairId}, volume ${formatNumber(leg.volumeBaseValue, 0)}` : 'No direct pair in snapshot';
}

export function metaLineTwo(leg?: Leg) {
  if (!leg) return '';
  if (Array.isArray(leg.offers)) {
    const top = leg.offers[0];
    return top ? `Top stock ${formatNumber(top.wantStock, 0)}, ${top.status || 'listed'}` : 'No matching offer';
  }
  return `Have volume ${formatNumber(leg.haveVolumeTraded, 0)}, want volume ${formatNumber(leg.wantVolumeTraded, 0)}`;
}

export function metaLineThree(leg?: Leg) {
  if (!leg) return '';
  if (Array.isArray(leg.offers)) {
    const top = leg.offers[0];
    return top?.indexed ? `Indexed ${new Date(top.indexed).toLocaleTimeString()}` : 'Manual check advised';
  }
  return `Highest stock ${formatNumber(leg.haveHighestStock, 0)} / ${formatNumber(leg.wantHighestStock, 0)}`;
}
