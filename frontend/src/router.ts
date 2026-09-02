export type RouteName =
  | 'home'
  | 'cloud-miner'
  | 'local-miner'
  | 'boost-farm'
  | 'plans'
  | 'referrals'
  | 'support';

export interface Route {
  name: RouteName;
  path: string;
  title: string;
}

export const routes: Route[] = [
  {
    name: 'home',
    path: '/',
    title: 'Ana Sayfa',
  },
  {
    name: 'cloud-miner',
    path: '/cloud-miner',
    title: 'Cloud Miner',
  },
  {
    name: 'local-miner',
    path: '/local-miner',
    title: 'Local Miner',
  },
  {
    name: 'boost-farm',
    path: '/boost-farm',
    title: 'Boost Farm',
  },
  {
    name: 'plans',
    path: '/plans',
    title: 'Planlar',
  },
  {
    name: 'referrals',
    path: '/referrals',
    title: 'Referanslar',
  },
  {
    name: 'support',
    path: '/support',
    title: 'Destek',
  },
];

export function currentRoute(): Route {
  const path =
    window.location.pathname.replace(/\/+$/, '') || '/';

  return (
    routes.find((route) => route.path === path) ??
    routes[0]
  );
}

export function navigate(path: string): void {
  if (window.location.pathname === path) {
    return;
  }

  history.pushState({}, '', path);

  window.dispatchEvent(
    new CustomEvent('radar:navigate')
  );
}
