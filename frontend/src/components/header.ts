import {
  currentRoute,
  navigate,
  routes,
} from '../router';

import { startI18nRuntime } from '../i18n/runtime';


type UiLang =
  'tr' |
  'en' |
  'ru';

type NetworkDataState =
  'loading' |
  'live' |
  'stale' |
  'offline';

type TelegramMiniAppWindow = Window & {
  Telegram?: {
    WebApp?: {
      initData?: string;
      openLink?: (
        url: string,
        options?: {
          try_instant_view?: boolean;
        }
      ) => void;
    };
  };
};


const LANGUAGE_KEY =
  'radar_lang';


const HEADER_COPY = {
  tr: {
    locale:
      'tr-TR',

    searchPlaceholder:
      'Cüzdan adı veya adres — örn. ackerman',

    searchButton:
      'Ara',

    searchEmpty:
      'Cüzdan adı veya adres girin.',

    searchTooLong:
      'Arama değeri çok uzun.',

    live:
      'CANLI VERİ',

    stale:
      'VERİ GECİKMELİ',

    offline:
      'VERİ BAĞLANTISI YOK',

    loading:
      'BAĞLANIYOR',

    refresh:
      'YENİLEME',

    refreshing:
      'YENİLENİYOR',

    secondsShort:
      'SN',

    nav: {
      '/':
        'Ana Sayfa',

      '/cloud-miner':
        'Cloud Miner',

      '/local-miner':
        'Local Miner',

      '/boost-farm':
        'Boost Farm',


      '/plans':
        'Planlar',

      '/referrals':
        'Referanslar',

      '/support':
        'Destek',
    },
  },


  en: {
    locale:
      'en-US',

    searchPlaceholder:
      'Wallet name or address — e.g. ackerman',

    searchButton:
      'Search',

    searchEmpty:
      'Enter a wallet name or address.',

    searchTooLong:
      'The search value is too long.',

    live:
      'LIVE DATA',

    stale:
      'DELAYED DATA',

    offline:
      'NO DATA CONNECTION',

    loading:
      'CONNECTING',

    refresh:
      'REFRESH',

    refreshing:
      'REFRESHING',

    secondsShort:
      'SEC',

    nav: {
      '/':
        'Home',

      '/cloud-miner':
        'Cloud Miner',

      '/local-miner':
        'Local Miner',

      '/boost-farm':
        'Boost Farm',


      '/plans':
        'Plans',

      '/referrals':
        'Referrals',

      '/support':
        'Support',
    },
  },


  ru: {
    locale:
      'ru-RU',

    searchPlaceholder:
      'Имя или адрес кошелька — напр. ackerman',

    searchButton:
      'Поиск',

    searchEmpty:
      'Введите имя или адрес кошелька.',

    searchTooLong:
      'Слишком длинное значение поиска.',

    live:
      'АКТУАЛЬНЫЕ ДАННЫЕ',

    stale:
      'ДАННЫЕ ЗАДЕРЖИВАЮТСЯ',

    offline:
      'НЕТ СОЕДИНЕНИЯ С ДАННЫМИ',

    loading:
      'ПОДКЛЮЧЕНИЕ',

    refresh:
      'ОБНОВЛЕНИЕ',

    refreshing:
      'ОБНОВЛЯЕТСЯ',

    secondsShort:
      'СЕК',

    nav: {
      '/':
        'Главная',

      '/cloud-miner':
        'Cloud Miner',

      '/local-miner':
        'Local Miner',

      '/boost-farm':
        'Boost Farm',


      '/plans':
        'Планы',

      '/referrals':
        'Рефералы',

      '/support':
        'Поддержка',
    },
  },
} satisfies Record<
  UiLang,
  {
    locale: string;

    searchPlaceholder: string;
    searchButton: string;

    searchEmpty: string;
    searchTooLong: string;

    live: string;
    stale: string;
    offline: string;
    loading: string;
    refresh: string;
    refreshing: string;
    secondsShort: string;

    nav: Record<
      string,
      string
    >;
  }
>;


function readLanguage():
  UiLang {

  const stored =
    window.localStorage.getItem(
      LANGUAGE_KEY
    );


  if (
    stored === 'tr' ||
    stored === 'en' ||
    stored === 'ru'
  ) {

    return stored;
  }


  return 'tr';
}


function hexEncodeUtf8(
  value: string,
): string {

  const bytes =
    new TextEncoder()
      .encode(
        value
      );


  return Array
    .from(
      bytes
    )
    .map(
      byte =>
        byte
          .toString(16)
          .padStart(
            2,
            '0'
          )
    )
    .join('');
}


const ADDRESS_RE =
  /^(0:)?[0-9a-f]{64}$/i;


function buildBotSearchUrl(
  raw: string,
  lang: UiLang,
):
  | {
      url: string;
    }
  | {
      error: string;
    } {

  const copy =
    HEADER_COPY[lang];


  const value =
    raw.trim();


  if (!value) {

    return {
      error:
        copy.searchEmpty,
    };
  }


  if (
    ADDRESS_RE.test(
      value
    )
  ) {

    const hex =
      value
        .replace(
          /^0:/i,
          ''
        )
        .toLowerCase();


    return {
      url:
        'https://t.me/' +
        'ackinackiradar_bot' +
        '?start=' +
        hex,
    };
  }


  const payload =
    'info_' +
    hexEncodeUtf8(
      value
    );


  if (
    payload.length >
    64
  ) {

    return {
      error:
        copy.searchTooLong,
    };
  }


  return {
    url:
      'https://t.me/' +
      'ackinackiradar_bot' +
      '?start=' +
      payload,
  };
}


export function renderHeader():
  HTMLElement {

  const wrapper =
    document.createElement(
      'div'
    );


  wrapper.className =
    'site-header';


  const active =
    currentRoute();


  wrapper.innerHTML = `
    <header class="topbar">

      <a
        class="brand"
        href="/"
        data-route="/"
        aria-label="Acki Nacki Radar"
      >

        <img
          class="brand-logo"
          src="/logo.png"
          alt="Acki Nacki Radar"
        />

        <span class="brand-copy">
          <strong>
            ACKI NACKI
            <span>RADAR</span>
          </strong>
        </span>

      </a>


      <form
        class="site-search"
        id="site-search-form"
        autocomplete="off"
      >

        <input
          id="site-search-input"
          type="text"
          maxlength="64"
          spellcheck="false"
          aria-label="Wallet search"
        />

        <button
          type="submit"
          aria-label="Search"
        >

          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              cx="11"
              cy="11"
              r="7"
            ></circle>

            <path
              d="m21 21-4.3-4.3"
            ></path>
          </svg>

          <span
            id="site-search-button-label"
          >
            Ara
          </span>

        </button>


        <span
          class="site-search-hint"
          id="site-search-hint"
          aria-live="polite"
        ></span>

      </form>


      <div class="topbar-right">

        <span
          class="site-clock"
          aria-label="UTC time"
        >

          <strong
            id="site-clock-time"
          >
            --:--:--
          </strong>

          <small
            id="site-clock-date"
          >
            —
          </small>

        </span>


        <span
          class="network-status"
          aria-live="polite"
        >

          <i></i>

          <span class="network-status-copy">
            <span
              id="site-live-label"
              data-network-status-label
            >
              BAĞLANIYOR
            </span>

            <small data-network-refresh-label>
              YENİLEME · -- SN
            </small>
          </span>

        </span>


        <nav
          class="lang-switch"
          id="site-lang-switch"
          aria-label="Language"
        >

          <button
            type="button"
            data-lang="tr"
          >
            TR
          </button>

          <button
            type="button"
            data-lang="en"
          >
            EN
          </button>

          <button
            type="button"
            data-lang="ru"
          >
            RU
          </button>

        </nav>

      </div>

    </header>


    <nav
      class="primary-nav"
      aria-label="Ana navigasyon"
    >

      ${routes
        .map(
          route => {
            const classes =
              route.name === active.name
                ? 'active'
                : '';

            return `
              <a
                href="${route.path}"
                data-route="${route.path}"
                class="${classes}"
              >
                <span
                  data-route-label="${route.path}"
                >
                  ${route.title}
                </span>
              </a>
            `;
          }
        )
        .join('')}

    </nav>
  `;



  /*
   * PHASE_7K_MOBILE_DRAWER_20260817
   * Mobile off-canvas navigation.
   *
   * Desktop navigation remains the canonical
   * source. Mobile links are cloned from it so
   * route names / active state cannot drift.
   */
  const desktopNavigation =
    wrapper.querySelector<HTMLElement>(
      '.primary-nav'
    );

  const headerTopbar =
    wrapper.querySelector<HTMLElement>(
      '.topbar'
    );

  const desktopLanguage =
    wrapper.querySelector<HTMLElement>(
      '[aria-label="Language"]'
    );


  const mobileMenuToggle =
    document.createElement(
      'button'
    );

  mobileMenuToggle.type =
    'button';

  mobileMenuToggle.className =
    'mobile-menu-toggle';

  mobileMenuToggle.setAttribute(
    'aria-label',
    'Menüyü aç'
  );

  mobileMenuToggle.setAttribute(
    'aria-expanded',
    'false'
  );

  mobileMenuToggle.setAttribute(
    'aria-controls',
    'mobile-site-drawer'
  );

  mobileMenuToggle.innerHTML = `
    <span></span>
    <span></span>
    <span></span>
  `;


  const mobileOverlay =
    document.createElement(
      'button'
    );

  mobileOverlay.type =
    'button';

  mobileOverlay.className =
    'mobile-nav-overlay';

  mobileOverlay.setAttribute(
    'aria-label',
    'Menüyü kapat'
  );


  const mobileDrawer =
    document.createElement(
      'aside'
    );

  mobileDrawer.className =
    'mobile-nav-drawer';

  mobileDrawer.id =
    'mobile-site-drawer';

  mobileDrawer.setAttribute(
    'aria-hidden',
    'true'
  );

  mobileDrawer.innerHTML = `
    <div class="mobile-drawer-head">

      <a
        class="mobile-drawer-brand"
        href="/"
        data-route="/"
        aria-label="Acki Nacki Radar"
      >
        <img
          class="mobile-drawer-logo"
          src="/logo.png"
          alt="Acki Nacki Radar"
        />

        <span class="mobile-drawer-brand-copy">
          <strong>
            ACKI NACKI
            <span>RADAR</span>
          </strong>
        </span>
      </a>

      <button
        class="mobile-drawer-close"
        type="button"
        aria-label="Menüyü kapat"
      >
        ×
      </button>

    </div>

    <nav
      class="mobile-drawer-nav"
      aria-label="Mobil navigasyon"
    ></nav>

    <div class="mobile-drawer-bottom">

      <button
        class="mobile-open-browser"
        type="button"
        hidden
      >
        <span aria-hidden="true">↗</span>
        <strong>OPEN IN BROWSER</strong>
      </button>

      <span class="mobile-drawer-language-label">
        LANGUAGE
      </span>

      <nav
        class="mobile-drawer-language"
        aria-label="Language mobile"
      ></nav>

      <div
        class="mobile-drawer-network"
        aria-live="polite"
      >
        <i></i>
        <span class="network-status-copy">
          <span data-network-status-label>
            BAĞLANIYOR
          </span>
          <small data-network-refresh-label>
            YENİLEME · -- SN
          </small>
        </span>
      </div>

    </div>
  `;


  const mobileDrawerNav =
    mobileDrawer.querySelector<HTMLElement>(
      '.mobile-drawer-nav'
    );

  desktopNavigation
    ?.querySelectorAll<HTMLAnchorElement>(
      'a'
    )
    .forEach(
      link => {

        mobileDrawerNav
          ?.appendChild(
            link.cloneNode(
              true
            )
          );

      }
    );


  const mobileDrawerLanguage =
    mobileDrawer.querySelector<HTMLElement>(
      '.mobile-drawer-language'
    );

  const mobileOpenBrowser =
    mobileDrawer.querySelector<HTMLButtonElement>(
      '.mobile-open-browser'
    );

  const telegramWebApp =
    (window as TelegramMiniAppWindow)
      .Telegram?.WebApp;

  const isTelegramMiniApp =
    Boolean(
      String(
        telegramWebApp?.initData || ''
      ).trim()
    );

  if (
    mobileOpenBrowser &&
    isTelegramMiniApp
  ) {
    mobileOpenBrowser.hidden =
      false;

    mobileOpenBrowser.addEventListener(
      'click',
      () => {
        const browserUrl =
          new URL(
            window.location.href
          );

        browserUrl.searchParams.delete(
          'tgWebAppData'
        );
        browserUrl.searchParams.delete(
          'tgWebAppVersion'
        );
        browserUrl.searchParams.delete(
          'tgWebAppPlatform'
        );
        browserUrl.searchParams.delete(
          'tgWebAppThemeParams'
        );

        setMobileMenuOpen(
          false
        );

        if (
          typeof telegramWebApp?.openLink ===
          'function'
        ) {
          telegramWebApp.openLink(
            browserUrl.toString(),
            {
              try_instant_view:
                false,
            }
          );
          return;
        }

        window.open(
          browserUrl.toString(),
          '_blank',
          'noopener,noreferrer'
        );
      }
    );
  }

  desktopLanguage
    ?.querySelectorAll<HTMLButtonElement>(
      '[data-lang]'
    )
    .forEach(
      button => {

        mobileDrawerLanguage
          ?.appendChild(
            button.cloneNode(
              true
            )
          );

      }
    );


  headerTopbar
    ?.appendChild(
      mobileMenuToggle
    );

  wrapper.append(
    mobileOverlay,
    mobileDrawer
  );


  const setMobileMenuOpen =
    (
      open:
        boolean
    ) => {

      mobileDrawer.classList.toggle(
        'open',
        open
      );

      mobileOverlay.classList.toggle(
        'open',
        open
      );

      mobileMenuToggle.classList.toggle(
        'open',
        open
      );

      mobileMenuToggle.setAttribute(
        'aria-expanded',
        open
          ? 'true'
          : 'false'
      );

      mobileDrawer.setAttribute(
        'aria-hidden',
        open
          ? 'false'
          : 'true'
      );

      document.body.classList.toggle(
        'mobile-menu-open',
        open
      );

    };


  mobileMenuToggle.addEventListener(
    'click',
    () => {

      setMobileMenuOpen(
        !mobileDrawer.classList.contains(
          'open'
        )
      );

    }
  );


  mobileOverlay.addEventListener(
    'click',
    () => {

      setMobileMenuOpen(
        false
      );

    }
  );


  mobileDrawer
    .querySelector(
      '.mobile-drawer-close'
    )
    ?.addEventListener(
      'click',
      () => {

        setMobileMenuOpen(
          false
        );

      }
    );


  mobileDrawer
    .querySelectorAll<HTMLAnchorElement>(
      '[data-route]'
    )
    .forEach(
      link => {

        link.addEventListener(
          'click',
          () => {

            setMobileMenuOpen(
              false
            );

          }
        );

      }
    );


  mobileDrawer
    .querySelectorAll<HTMLButtonElement>(
      '[data-lang]'
    )
    .forEach(
      button => {

        button.addEventListener(
          'click',
          () => {

            setMobileMenuOpen(
              false
            );

          }
        );

      }
    );


  wrapper.addEventListener(
    'keydown',
    event => {

      if (
        event.key ===
          'Escape'
      ) {

        setMobileMenuOpen(
          false
        );

      }

    }
  );


  let language:
    UiLang =
      readLanguage();

  let networkDataState:
    NetworkDataState =
      'loading';

  let networkNextAttemptAtMs:
    number | null =
      null;

  let networkRefreshInFlight =
    false;


  function renderNetworkRefreshCountdown():
    void {

    const copy =
      HEADER_COPY[language];


    const remainingSeconds =
      networkNextAttemptAtMs === null
        ? null
        : Math.max(
            0,
            Math.ceil(
              (
                networkNextAttemptAtMs -
                Date.now()
              ) /
              1000
            )
          );


    const text =
      remainingSeconds === null
        ? `${copy.refresh} · -- ${copy.secondsShort}`
        : remainingSeconds > 0
          ? `${copy.refresh} · ${remainingSeconds} ${copy.secondsShort}`
          : copy.refreshing;


    wrapper
      .querySelectorAll<HTMLElement>(
        '[data-network-refresh-label]'
      )
      .forEach(
        label => {

          label.textContent =
            text;
        }
      );
  }


  function renderNetworkDataState():
    void {

    const copy =
      HEADER_COPY[language];


    wrapper
      .querySelectorAll<HTMLElement>(
        '.network-status, .mobile-drawer-network'
      )
      .forEach(
        status => {

          status.classList.toggle(
            'stale',
            networkDataState === 'stale'
          );

          status.classList.toggle(
            'offline',
            networkDataState === 'offline'
          );


          const label =
            status.querySelector<HTMLElement>(
              '[data-network-status-label]'
            );


          if (label) {

            label.textContent =
              copy[networkDataState];
          }
        }
      );


    renderNetworkRefreshCountdown();
  }


  function applyLanguage(
    next: UiLang,
  ): void {

    language =
      next;


    window.localStorage.setItem(
      LANGUAGE_KEY,
      next
    );


    document.documentElement.lang =
      next;


    const copy =
      HEADER_COPY[next];


    const input =
      wrapper.querySelector<HTMLInputElement>(
        '#site-search-input'
      );


    if (input) {

      input.placeholder =
        copy.searchPlaceholder;
    }


    const searchLabel =
      wrapper.querySelector<HTMLElement>(
        '#site-search-button-label'
      );


    if (searchLabel) {

      searchLabel.textContent =
        copy.searchButton;
    }


    renderNetworkDataState();


    wrapper
      .querySelectorAll<HTMLElement>(
        '[data-route-label]'
      )
      .forEach(
        element => {

          const path =
            element.dataset.routeLabel ||
            '';


          element.textContent =
            (copy.nav as Record<string, string>)[path] ||
            path;
        }
      );


    wrapper
      .querySelectorAll<HTMLButtonElement>(
        '[data-lang]'
      )
      .forEach(
        button => {

          const selected =
            button.dataset.lang ===
            next;


          button.setAttribute(
            'aria-current',
            selected
              ? 'true'
              : 'false'
          );
        }
      );


    const hint =
      wrapper.querySelector<HTMLElement>(
        '#site-search-hint'
      );


    if (hint) {

      hint.textContent =
        '';

      hint.classList.remove(
        'error'
      );
    }


    window.dispatchEvent(
      new CustomEvent(
        'radar:language',
        {
          detail: {
            lang:
              next,
          },
        }
      )
    );
  }


  function updateClock():
    void {

    const time =
      wrapper.querySelector<HTMLElement>(
        '#site-clock-time'
      );


    const date =
      wrapper.querySelector<HTMLElement>(
        '#site-clock-date'
      );


    if (
      !time ||
      !date
    ) {

      return;
    }


    const now =
      new Date();


    const copy =
      HEADER_COPY[language];


    time.textContent =
      now.toLocaleTimeString(
        copy.locale,
        {
          timeZone:
            'UTC',

          hour:
            '2-digit',

          minute:
            '2-digit',

          second:
            '2-digit',

          hourCycle:
            'h23',
        }
      );


    date.textContent =
      'UTC · ' +
      now.toLocaleDateString(
        copy.locale,
        {
          timeZone:
            'UTC',

          day:
            '2-digit',

          month:
            'short',

          year:
            'numeric',
        }
      );
  }


  async function refreshNetworkDataState():
    Promise<void> {

    if (networkRefreshInFlight) {

      return;
    }


    networkRefreshInFlight =
      true;

    try {

      const response =
        await fetch(
          '/api/radar/stats',
          {
            cache:
              'no-store',
          }
        );


      if (!response.ok) {

        throw new Error(
          `HTTP ${response.status}`
        );
      }


      const data =
        await response.json() as {
          chain?: unknown;
          chainStale?: boolean;
          chainAgeSeconds?: number | null;
          chainFlow?: {
            nextAttemptAt?: string | null;
          };
        };


      const nextAttemptAtMs =
        Date.parse(
          data.chainFlow?.nextAttemptAt ||
          ''
        );


      networkNextAttemptAtMs =
        Number.isFinite(
          nextAttemptAtMs
        )
          ? nextAttemptAtMs
          : null;


      if (
        data.chain &&
        data.chainStale !== true
      ) {

        networkDataState =
          'live';

      } else if (
        data.chainStale === true ||
        typeof data.chainAgeSeconds === 'number'
      ) {

        networkDataState =
          'stale';

      } else {

        networkDataState =
          'offline';
      }

    } catch {

      networkDataState =
        'offline';

      networkNextAttemptAtMs =
        null;

    } finally {

      networkRefreshInFlight =
        false;
    }


    renderNetworkDataState();
  }


  startI18nRuntime();


  applyLanguage(
    language
  );


  updateClock();

  void refreshNetworkDataState();


  const clockTimer =
    window.setInterval(
      () => {

        if (
          !wrapper.isConnected
        ) {

          window.clearInterval(
            clockTimer
          );

          return;
        }


        updateClock();

        renderNetworkRefreshCountdown();
      },
      1000
    );


  const networkTimer =
    window.setInterval(
      () => {

        if (
          !wrapper.isConnected
        ) {

          window.clearInterval(
            networkTimer
          );

          return;
        }


        void refreshNetworkDataState();
      },
      10 * 1000
    );


  wrapper
    .querySelectorAll<HTMLAnchorElement>(
      '[data-route]'
    )
    .forEach(
      link => {

        link.addEventListener(
          'click',
          event => {

            event.preventDefault();


            navigate(
              link.dataset.route ||
              '/'
            );
          }
        );
      }
    );


  wrapper
    .querySelectorAll<HTMLButtonElement>(
      '[data-lang]'
    )
    .forEach(
      button => {

        button.addEventListener(
          'click',
          () => {

            const next =
              button.dataset.lang;


            if (
              next === 'tr' ||
              next === 'en' ||
              next === 'ru'
            ) {

              applyLanguage(
                next
              );
            }
          }
        );
      }
    );


  const searchForm =
    wrapper.querySelector<HTMLFormElement>(
      '#site-search-form'
    );


  const searchInput =
    wrapper.querySelector<HTMLInputElement>(
      '#site-search-input'
    );


  const searchHint =
    wrapper.querySelector<HTMLElement>(
      '#site-search-hint'
    );


  searchForm?.addEventListener(
    'submit',
    event => {

      event.preventDefault();


      if (
        !searchInput
      ) {

        return;
      }


      const result =
        buildBotSearchUrl(
          searchInput.value,
          language
        );


      if (
        'error' in result
      ) {

        if (searchHint) {

          searchHint.textContent =
            result.error;

          searchHint.classList.add(
            'error'
          );
        }


        return;
      }


      if (searchHint) {

        searchHint.textContent =
          '';

        searchHint.classList.remove(
          'error'
        );
      }


      window.location.href =
        result.url;
    }
  );


  return wrapper;
}
