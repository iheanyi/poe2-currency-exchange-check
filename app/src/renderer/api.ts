import type { Route } from './types';

export const DEFAULTS: Route = {
  realm: 'poe2',
  league: 'Runes of Aldur',
  source: 'perfect-exalted-orb',
  bridge: 'exalted',
  target: 'divine'
};

export function fetchBootstrap(route: Partial<Route>) {
  return window.poeArb.fetchBootstrap(route);
}

export function fetchCatalog(route: Partial<Route>) {
  return window.poeArb.fetchCatalog(route);
}

export function fetchSnapshotRoute(route: Route) {
  return window.poeArb.fetchSnapshotRoute(route);
}

export function fetchOfficialRoute(route: Route) {
  return window.poeArb.fetchOfficialRoute(route);
}

export function optimizeSnapshot(input: Parameters<typeof window.poeArb.optimizeSnapshot>[0]) {
  return window.poeArb.optimizeSnapshot(input);
}

export function openExternal(url: string) {
  return window.poeArb.openExternal(url);
}
