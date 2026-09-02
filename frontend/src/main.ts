import './styles/base.css';
import './styles/layout.css';
import './styles/home.css';
import './styles/pages.css';

import {
  currentRoute,
} from './router';

import {
  bootstrapTelegramMiniAppSession,
} from './auth/session';

import {
  renderHeader,
} from './components/header';

import {
  renderFooter,
} from './components/footer';

import {
  homeView,
  mountHome,
} from './views/home';

import {
  cloudMinerView,
  mountCloudMiner,
} from './views/cloud-miner';

import {
  localMinerView,
} from './views/local-miner';

import {
  boostFarmView,
} from './views/boost-farm';

import {
  plansView,
} from './views/plans';


import {
  referralsView,
} from './views/referrals';

import {
  supportView,
} from './views/support';

const appElement =
  document.querySelector<HTMLDivElement>(
    '#app'
  );

if (!appElement) {
  throw new Error(
    '#app not found'
  );
}

/*
 * Keep a permanently non-null reference.
 * TypeScript does not preserve the querySelector
 * null narrowing inside later render callbacks.
 */
const app: HTMLDivElement = appElement;

function renderView(): HTMLElement {
  switch (currentRoute().name) {
    case 'cloud-miner':
      return cloudMinerView();

    case 'local-miner':
      return localMinerView();

    case 'boost-farm':
      return boostFarmView();



    case 'plans':
      return plansView();

    case 'referrals':
      return referralsView();

    case 'support':
      return supportView();

    case 'home':
    default:
      return homeView();
  }
}

let viewCleanup:
  (() => void) | null =
  null;

function render(): void {
  if (viewCleanup) {
    viewCleanup();
    viewCleanup = null;
  }

  app.replaceChildren();

  const route =
    currentRoute();

  const header =
    renderHeader();

  const main =
    document.createElement('main');

  main.className =
    'app-main';

  /*
   * Only ONE route/view participates in layout.
   */
  const view =
    renderView();

  main.append(
    view
  );

  app.append(
    header,
    main,
    renderFooter(),
  );

  if (
    route.name === 'home'
  ) {
    viewCleanup =
      mountHome(view);
  } else if (
    route.name === 'cloud-miner'
  ) {
    viewCleanup =
      mountCloudMiner(view);
  }

  document.title =
    route.name === 'home'
      ? 'Acki Nacki Radar'
      : `${route.title} — Acki Nacki Radar`;

  window.scrollTo({
    top: 0,
    behavior: 'instant',
  });
}

window.addEventListener(
  'popstate',
  render
);

window.addEventListener(
  'radar:navigate',
  render
);

void bootstrapTelegramMiniAppSession()
  .finally(render);
