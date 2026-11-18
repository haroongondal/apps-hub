import type { AppRow, ItemFilter } from 'inflow-core';

export type AppRoute = { kind: 'contacts'; pkg: string } | { kind: 'items'; filter: ItemFilter };

// A contact app opens its contact list; apps merged under one label open the items of every package.
export function appRoute(a: AppRow): AppRoute {
  if (a.byContact) return { kind: 'contacts', pkg: a.pkgs[0] };
  if (a.pkgs.length > 1) return { kind: 'items', filter: { kind: 'apps', pkgs: a.pkgs } };
  return { kind: 'items', filter: { kind: 'app', pkg: a.pkgs[0] } };
}
