import { getUiLocale } from '../i18n/runtime';

import '../styles/cloud-miner.css';

import {
  mountMinerConnect,
} from '../mining/connect';

import {
  mountMinerControls,
} from '../mining/controls';

import {
  mountMiningObservability,
} from '../mining/observability';

import {
  authHeaders,
  clearSessionToken,
  consumeTelegramAuthFragment,
  fetchDashboardMe,
  readSessionToken,
  type DashboardMeData,
} from '../auth/session';


const TELEGRAM_ERRORS:
  Record<string, string> = {

  TELEGRAM_OIDC_NOT_CONFIGURED:
    'Telegram ile giriş şu anda yapılandırılmamış.',

  MISSING_CODE_OR_STATE:
    'Telegram giriş yanıtı eksik geldi.',

  STATE_EXPIRED:
    'Telegram giriş isteğinin süresi doldu. Tekrar deneyin.',

  TOKEN_EXCHANGE_FAILED:
    'Telegram doğrulaması tamamlanamadı.',

  NO_ID_TOKEN:
    'Telegram beklenen kimlik yanıtını döndürmedi.',

  NO_USER_ID:
    'Telegram hesabı belirlenemedi.',

  CALLBACK_FAILED:
    'Telegram girişinde beklenmeyen bir hata oluştu.',

  access_denied:
    'Telegram girişi iptal edildi.',
};


export function cloudMinerView():
  HTMLElement {

  const section =
    document.createElement(
      'section'
    );

  section.className =
    'cloud-auth-view';

  section.dataset.authState =
    'loading';

  section.innerHTML = `
    <div class="cloud-auth-shell">

      <header class="cloud-auth-heading">
        <div>
          <span class="cloud-auth-kicker">
            CLOUD MINER CONTROL
          </span>

          <h1>
            Cloud Miner
          </h1>

          <p>
            Madencilik hesabınıza bağlı
            güvenli kontrol alanı.
          </p>
        </div>

        <div
          class="cloud-auth-status"
          id="cloud-auth-status"
        >
          <i></i>
          <span>OTURUM KONTROL EDİLİYOR</span>
        </div>
      </header>


      <section
        class="cloud-auth-card"
        id="cloud-auth-card"
      >
        <div class="cloud-auth-loading">
          <span class="cloud-auth-spinner"></span>

          <b>
            OTURUM DOĞRULANIYOR
          </b>

          <small>
            Güvenli dashboard oturumu kontrol ediliyor.
          </small>
        </div>
      </section>

    </div>
  `;

  return section;
}


function loginMarkup():
  string {

  return `
    <div class="cloud-login-panel">

      <div
        class="cloud-login-symbol"
        aria-hidden="true"
      >

        <!-- PHASE_7K_CLOUD_LOGIN_VISUAL_20260817 -->
        <div class="cloud-node-visual">

          <div class="cloud-node-orbit cloud-node-orbit-a">
            <i></i>
            <i></i>
            <i></i>
          </div>

          <div class="cloud-node-orbit cloud-node-orbit-b">
            <i></i>
            <i></i>
          </div>

          <div class="cloud-node-axis cloud-node-axis-x"></div>
          <div class="cloud-node-axis cloud-node-axis-y"></div>

          <div class="cloud-node-core">

            <span class="cloud-node-core-ring"></span>

            <img
              src="/logo.png"
              alt=""
            />

          </div>

          <div class="cloud-node-caption">

            <b>
              CLOUD MINER
            </b>

            <span>
              MAINNET · SECURE OIDC
            </span>

            <small>
              READY
            </small>

          </div>

        </div>

      </div>

      <div class="cloud-login-copy">

        <span class="cloud-login-eyebrow">
          TELEGRAM OIDC
        </span>

        <h2>
          Mining Console'a giriş
        </h2>

        <p>
          Cloud Miner hesabınız Telegram hesabınızla
          doğrulanır. Madencilik anahtarları veya
          cüzdan private key'i tarayıcıya gönderilmez.
        </p>

        <div
          class="cloud-auth-message"
          id="cloud-auth-message"
          hidden
        ></div>

        <a
          class="cloud-telegram-button"
          id="cloud-telegram-login"
          href="/api/auth/telegram/start"
        >
          <span class="cloud-telegram-button-label">

            <svg
              class="cloud-telegram-icon"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                d="M3.4 11.5 20.2 4.7l-4 14.6-6-4.5-3.5 3 .9-5.2 9.1-5.8-7.4 6.5"
              />
            </svg>

            <span>
              TELEGRAM İLE DEVAM ET
            </span>

          </span>

          <b>
            →
          </b>
        </a>

        <small class="cloud-login-note">
          Doğrulama tamamlandığında Cloud Miner
          ekranına geri dönersiniz.
        </small>

      </div>

    </div>
  `;
}


function authenticatedMarkup():
  string {

  return `
    <div class="cloud-session-panel cloud-premium-console">

      <div class="cloud-session-top">

        <div class="cloud-session-identity">
          <span class="cloud-session-eyebrow">
            ACKI NACKI · SECURE CLOUD
          </span>

          <h2>
            Cloud Miner Console
          </h2>

          <p
            id="cloud-session-user"
          >
            Telegram oturumu
          </p>

          <span class="cloud-session-network">
            <i></i>
            MAINNET ENGINE ACTIVE
          </span>
        </div>

        <div class="cloud-session-actions">
          <span class="cloud-console-tier">
            PREMIUM CONSOLE
          </span>

          <button
            type="button"
            class="cloud-logout-button"
            id="cloud-auth-logout"
          >
            ÇIKIŞ
          </button>
        </div>

      </div>


      <div class="cloud-session-grid">

        <article data-accent="cyan">
          <span>
            BAĞLI CÜZDAN
          </span>

          <b
            id="cloud-session-miners"
          >
            0
          </b>

          <small>
            CLOUD MINER
          </small>
        </article>


        <article data-accent="green">
          <span>
            ABONELİK
          </span>

          <b
            id="cloud-session-plan"
          >
            —
          </b>

          <small>
            PLAN
          </small>
        </article>


        <article data-accent="gold">
          <span>
            KALAN SÜRE
          </span>

          <b
            id="cloud-session-remaining"
          >
            —
          </b>

          <small>
            SUBSCRIPTION
          </small>
        </article>

      </div>


      <div
        class="cloud-control-message"
        id="cloud-control-message"
        hidden
      ></div>


      <div class="cloud-section-divider">
        <span>WALLET &amp; ACCESS</span>
        <i></i>
        <b>01</b>
      </div>


      <div class="cloud-readonly-grid">

        <section class="cloud-data-card">

          <header>
            <div>
              <span class="cloud-data-kicker">
                MINER REGISTRY
              </span>

              <h3>
                Bağlı Cüzdanlar
              </h3>
            </div>

            <span class="cloud-readonly-badge">
              READ ONLY
            </span>
          </header>

          <div
            class="cloud-miner-list"
            id="cloud-miner-list"
          ></div>

          <form
            class="cloud-connect-form"
            id="cloud-connect-form"
          >

            <label
              for="cloud-wallet-input"
            >
              YENİ CÜZDAN
            </label>

            <div class="cloud-connect-field">

              <input
                type="text"
                id="cloud-wallet-input"
                autocomplete="off"
                spellcheck="false"
                placeholder="Cüzdan adı"
                maxlength="64"
              />

              <button
                type="submit"
                id="cloud-connect-button"
              >
                CÜZDAN BAĞLA
              </button>

            </div>

            <p
              class="cloud-connect-message"
              id="cloud-connect-message"
            >
              AN Wallet üzerinden mining anahtarı onayı gerekir.
            </p>

            <div
              id="cloud-connect-result"
            ></div>

          </form>

        </section>


        <section class="cloud-data-card">

          <header>
            <div>
              <span class="cloud-data-kicker">
                ACCOUNT ACCESS
              </span>

              <h3>
                Abonelik
              </h3>
            </div>
          </header>

          <div
            class="cloud-subscription-view"
            id="cloud-subscription-view"
          >

            <div class="cloud-sub-row">
              <span>PLAN</span>
              <b id="cloud-sub-plan">—</b>
            </div>

            <div class="cloud-sub-row">
              <span>DURUM</span>
              <b id="cloud-sub-status">—</b>
            </div>

            <div class="cloud-sub-row">
              <span>KALAN</span>
              <b id="cloud-sub-remaining">—</b>
            </div>

            <div class="cloud-sub-row">
              <span>BİTİŞ</span>
              <b id="cloud-sub-end">—</b>
            </div>

          </div>

        </section>

      </div>


      <div class="cloud-section-divider">
        <span>LIVE OPERATIONS</span>
        <i></i>
        <b>02</b>
      </div>


      <div class="cloud-observability-grid">


        <section
          class="cloud-observe-card cloud-cycle-card"
          id="cloud-cycle-monitor"
        >

          <header class="cloud-observe-head">

            <div>

              <span class="cloud-data-kicker">
                CHAIN CYCLE
              </span>

              <h3>
                Mining Cycle Monitor
              </h3>

              <small>
                262.000 blok tabanlı gerçek mining döngüsü
              </small>

            </div>

            <span
              class="cloud-cycle-status"
              id="cloud-cycle-status"
            >
              SYNC
            </span>

          </header>


          <div class="cloud-cycle-dates">

            <div>

              <span>
                DÖNGÜ BAŞLANGICI
              </span>

              <b
                id="cloud-cycle-start"
              >
                —
              </b>

              <small>
                SEQ
                <i
                  id="cloud-cycle-start-seq"
                >
                  —
                </i>
              </small>

            </div>


            <div class="cloud-cycle-center">

              <strong
                id="cloud-cycle-countdown"
              >
                —
              </strong>

              <span>
                KALAN TAHMİNİ SÜRE
              </span>

            </div>


            <div class="end">

              <span>
                DÖNGÜ BİTİŞİ
              </span>

              <b
                id="cloud-cycle-end"
              >
                —
              </b>

              <small>
                SEQ
                <i
                  id="cloud-cycle-end-seq"
                >
                  —
                </i>
              </small>

            </div>

          </div>


          <div class="cloud-cycle-progress">

            <div>
              <i
                id="cloud-cycle-progress-bar"
              ></i>
            </div>

            <span>
              0%
            </span>

            <b
              id="cloud-cycle-progress-label"
            >
              —
            </b>

            <span>
              100%
            </span>

          </div>


          <div class="cloud-cycle-metrics">

            <div>

              <b
                id="cloud-cycle-period"
              >
                —
              </b>

              <span>
                DÖNGÜ BLOĞU
              </span>

            </div>


            <div>

              <b
                id="cloud-cycle-rate"
              >
                —
              </b>

              <span>
                BLOCK / SEC
              </span>

            </div>


            <div>

              <b
                id="cloud-cycle-duration"
              >
                —
              </b>

              <span>
                TAHMİNİ DÖNGÜ SÜRESİ
              </span>

            </div>


            <div>

              <b
                id="cloud-cycle-current-seq"
              >
                —
              </b>

              <span>
                CURRENT CHAIN SEQ
              </span>

            </div>

          </div>

        </section>


        <section
          class="cloud-observe-card"
          id="cloud-mining-health"
        >

          <header class="cloud-observe-head">

            <div>

              <span class="cloud-data-kicker">
                MINING HEALTH
              </span>

              <h3>
                Mining Health
              </h3>

              <small>
                MEVCUT MINING DÖNGÜSÜ
              </small>

            </div>

            <span
              class="cloud-health-status idle"
              id="cloud-health-status"
            >
              VERİ BEKLENİYOR
            </span>

          </header>


          <div class="cloud-health-metrics">

            <div class="good">

              <b
                id="cloud-health-rate"
              >
                —
              </b>

              <span>
                DOĞRULANAN BAŞARI
              </span>

            </div>


            <div class="good">

              <b
                id="cloud-health-success"
              >
                0
              </b>

              <span>
                BAŞARILI
              </span>

            </div>


            <div class="warn">

              <b
                id="cloud-health-recovered"
              >
                0
              </b>

              <span>
                KURTARILDI
              </span>

            </div>


            <div class="warn">

              <b
                id="cloud-health-pending"
              >
                0
              </b>

              <span>
                BEKLEMEDE
              </span>

            </div>


            <div class="bad">

              <b
                id="cloud-health-lost"
              >
                0
              </b>

              <span>
                KAYIP
              </span>

            </div>


            <div class="warn">

              <b
                id="cloud-health-claim"
              >
                0
              </b>

              <span>
                CLAIM SORUNU
              </span>

            </div>

          </div>


          <div
            class="cloud-health-reason"
            id="cloud-health-reason"
            hidden
          >

            <span>
              UYARI NEDENİ
            </span>

            <strong id="cloud-health-reason-title">
              —
            </strong>

            <small id="cloud-health-reason-detail">
              —
            </small>

          </div>


          <div class="cloud-health-timeline-box">

            <span>
              SON EPOCHLAR
            </span>

            <div
              class="cloud-health-timeline"
              id="cloud-health-timeline"
            ></div>

          </div>


          <div
            class="cloud-health-events"
            id="cloud-health-events"
          ></div>

        </section>


        <section
          class="cloud-observe-card cloud-reward-card"
          id="cloud-reward-monitor"
        >

          <header class="cloud-observe-head">

            <div>

              <span class="cloud-data-kicker">
                CHAIN REWARD FEED
              </span>

              <h3>
                Reward Feed
              </h3>

              <small
                id="cloud-reward-note"
              >
                Zincir bağlantısı bekleniyor
              </small>

            </div>

          

            <!-- PHASE_7I_20260816 -->
            <button
              type="button"
              class="cloud-reward-clear"
              id="cloud-reward-clear"
              aria-label="Ödül listesini temizle"
              title="Ödül listesini temizle"
            >
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  d="M9 3h6l1 2h4v2h-2l-1 14H7L6 7H4V5h4l1-2Zm0 4 .8 12h4.4L15 7H9Zm2 2h2v8h-2V9Z"
                  fill="currentColor"
                />
              </svg>
            </button>
</header>


          <div
            class="cloud-reward-feed"
            id="cloud-reward-feed"
          >

            <div class="cloud-observe-empty">
              Ölçüm başlıyor…
            </div>

          </div>


          <div class="cloud-reward-total">

            <span>
              MEVCUT DÖNGÜ · TÜM EPOCHLAR
            </span>

            <b
              id="cloud-reward-total"
            >
              —
            </b>

          </div>


          <p
            class="cloud-reward-partial"
            id="cloud-reward-partial"
            hidden
          ></p>

        </section>

      </div>


      <div class="cloud-auth-next">
        <i></i>

        <div>
          <b>
            Cloud Miner altyapısı bağlı ve izleniyor.
          </b>

          <p>
            Cüzdan bağlantıları, madenci kontrolleri, zincir sağlığı ve
            ödül akışı tek güvenli konsolda yönetilir.
          </p>
        </div>

        <span class="cloud-auth-next-badge">
          ALL SYSTEMS LINKED
        </span>
      </div>

    </div>
  `;
}

function setStatus(
  root: HTMLElement,
  state:
    | 'loading'
    | 'anonymous'
    | 'authenticated'
    | 'error',
): void {

  root.dataset.authState =
    state;

  const status =
    root.querySelector<HTMLElement>(
      '#cloud-auth-status'
    );

  const text =
    status?.querySelector<HTMLElement>(
      'span'
    );

  if (!status || !text) {
    return;
  }

  status.classList.remove(
    'ok',
    'warn',
    'error'
  );

  if (state === 'loading') {

    text.textContent =
      'OTURUM KONTROL EDİLİYOR';

    return;
  }

  if (state === 'authenticated') {

    status.classList.add(
      'ok'
    );

    text.textContent =
      'GÜVENLİ OTURUM';

    return;
  }

  if (state === 'error') {

    status.classList.add(
      'error'
    );

    text.textContent =
      'BAĞLANTI HATASI';

    return;
  }

  status.classList.add(
    'warn'
  );

  text.textContent =
    'GİRİŞ GEREKLİ';
}


function renderLogin(
  root: HTMLElement,
  message?: string,
): void {

  setStatus(
    root,
    'anonymous'
  );

  const card =
    root.querySelector<HTMLElement>(
      '#cloud-auth-card'
    );

  if (!card) {
    return;
  }

  card.innerHTML =
    loginMarkup();

  const messageElement =
    card.querySelector<HTMLElement>(
      '#cloud-auth-message'
    );

  if (
    messageElement &&
    message
  ) {

    messageElement.hidden =
      false;

    messageElement.textContent =
      message;
  }
}


type CloudMiner =
  NonNullable<
    DashboardMeData['miners']
  >[number];


type CloudPlan =
  NonNullable<
    DashboardMeData['plans']
  >[number];


type SubscriptionInfo = {
  planLabel: string;
  statusLabel: string;
  remainingLabel: string;
  endLabel: string;
  active: boolean;
};


function safeStatus(
  status: string | undefined,
): string {

  switch (status) {

    case 'active':
      return 'active';

    case 'pending_authorization':
      return 'pending';

    case 'error':
      return 'error';

    case 'stopped':
      return 'stopped';

    default:
      return 'unknown';
  }
}


function statusLabel(
  status: string | undefined,
): string {

  switch (status) {

    case 'active':
      return 'AKTİF';

    case 'pending_authorization':
      return 'ONAY BEKLİYOR';

    case 'error':
      return 'HATA';

    case 'stopped':
      return 'DURDURULDU';

    default:
      return status
        ? status.toUpperCase()
        : 'BİLİNMİYOR';
  }
}


function timeAgo(
  raw: string | null | undefined,
): string | null {

  if (!raw) {
    return null;
  }

  const time =
    Date.parse(
      raw
    );

  if (
    !Number.isFinite(
      time
    )
  ) {
    return null;
  }

  const seconds =
    Math.max(
      0,
      Math.floor(
        (
          Date.now() -
          time
        ) /
        1000
      )
    );

  if (seconds < 60) {
    return 'az önce';
  }

  const minutes =
    Math.floor(
      seconds / 60
    );

  if (minutes < 60) {
    return `${minutes} dk önce`;
  }

  const hours =
    Math.floor(
      minutes / 60
    );

  if (hours < 24) {
    return `${hours} sa önce`;
  }

  const days =
    Math.floor(
      hours / 24
    );

  return `${days} gün önce`;
}


function findPlan(
  data: DashboardMeData,
  planId: string | undefined,
): CloudPlan | undefined {

  if (!planId) {
    return undefined;
  }

  return (
    data.plans || []
  ).find(
    plan =>
      plan.id ===
      planId
  );
}


function subscriptionInfo(
  data: DashboardMeData,
): SubscriptionInfo {

  const subscription =
    data.subscription;

  if (!subscription) {

    return {
      planLabel:
        'YOK',

      statusLabel:
        'ABONELİK YOK',

      remainingLabel:
        '—',

      endLabel:
        '—',

      active:
        false,
    };
  }

  const plan =
    findPlan(
      data,
      subscription.planId
    );

  const planLabel =
    plan?.label ||
    subscription.planId ||
    'PLAN';


  if (!subscription.activeUntil) {

    return {
      planLabel,

      statusLabel:
        'AKTİF',

      remainingLabel:
        '—',

      endLabel:
        '—',

      active:
        true,
    };
  }


  const until =
    new Date(
      subscription.activeUntil
    );

  const valid =
    !Number.isNaN(
      until.getTime()
    );


  if (!valid) {

    return {
      planLabel,

      statusLabel:
        'AKTİF',

      remainingLabel:
        '—',

      endLabel:
        '—',

      active:
        true,
    };
  }


  const remainingMs =
    until.getTime() -
    Date.now();

  const active =
    remainingMs > 0;

  const daysLeft =
    Math.max(
      0,
      Math.ceil(
        remainingMs /
        86_400_000
      )
    );


  return {
    planLabel,

    statusLabel:
      active
        ? 'AKTİF'
        : 'SÜRESİ DOLDU',

    remainingLabel:
      active
        ? `${daysLeft} gün`
        : 'SÜRESİ DOLDU',

    endLabel:
      until.toLocaleDateString(
        getUiLocale(),
        {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        }
      ),

    active,
  };
}


function appendMeta(
  container: HTMLElement,
  text: string,
): void {

  const item =
    document.createElement(
      'span'
    );

  item.textContent =
    text;

  container.append(
    item
  );
}


function renderMiners(
  root: HTMLElement,
  miners: CloudMiner[],
  cycleTapCap: number,
): void {

  const list =
    root.querySelector<HTMLElement>(
      '#cloud-miner-list'
    );

  if (!list) {
    return;
  }

  list.replaceChildren();


  if (!miners.length) {

    const empty =
      document.createElement(
        'div'
      );

    empty.className =
      'cloud-data-empty';

    empty.textContent =
      'Henüz bağlı bir cüzdan yok.';

    list.append(
      empty
    );

    return;
  }


  for (
    const miner
    of miners
  ) {

    const row =
      document.createElement(
        'article'
      );

    row.className =
      'cloud-miner-row';


    const main =
      document.createElement(
        'div'
      );

    main.className =
      'cloud-miner-main';


    const name =
      document.createElement(
        'b'
      );

    name.className =
      'cloud-miner-name';

    name.textContent =
      miner.walletName ||
      'İsimsiz cüzdan';


    const meta =
      document.createElement(
        'div'
      );

    meta.className =
      'cloud-miner-meta';


    const tapSum =
      miner.tapSum != null &&
      Number.isFinite(miner.tapSum)
        ? Math.max(0, miner.tapSum)
        : null;

    const tapPercent =
      tapSum != null &&
      cycleTapCap > 0
        ? Math.min(
            100,
            Math.max(
              0,
              (tapSum / cycleTapCap) * 100,
            ),
          )
        : 0;

    const epochCount =
      miner.cycleEpochCount != null &&
      Number.isFinite(miner.cycleEpochCount)
        ? Math.max(
            0,
            Math.round(miner.cycleEpochCount),
          )
        : 0;


    const session =
      timeAgo(
        miner.lastSessionAt
      );

    if (session) {
      appendMeta(
        meta,
        `Son tur: ${session}${
          miner.lastTapsSent != null
            ? ` · ${miner.lastTapsSent} tap`
            : ''
        }`
      );
    } else if (
      miner.lastTapsSent != null
    ) {
      appendMeta(
        meta,
        `Son tur: ${miner.lastTapsSent} tap`
      );
    }


    const reward =
      timeAgo(
        miner.lastRewardAt
      );

    if (reward) {
      appendMeta(
        meta,
        `Son claim: ${reward}`
      );
    }


    const metrics =
      document.createElement(
        'div'
      );

    metrics.className =
      'cloud-miner-metrics';


    const tapMetric =
      document.createElement(
        'div'
      );

    tapMetric.className =
      'cloud-miner-tap-metric';


    const tapHead =
      document.createElement(
        'div'
      );

    tapHead.className =
      'cloud-miner-tap-head';


    const tapLabel =
      document.createElement(
        'span'
      );

    tapLabel.textContent =
      'TAP İLERLEMESİ';


    const tapValue =
      document.createElement(
        'strong'
      );

    tapValue.textContent =
      `${
        tapSum == null
          ? '—'
          : Math.round(tapSum).toLocaleString('tr-TR')
      } / ${Math.round(cycleTapCap).toLocaleString('tr-TR')} TAP`;

    tapHead.append(
      tapLabel,
      tapValue
    );


    const tapTrack =
      document.createElement(
        'div'
      );

    tapTrack.className =
      'cloud-miner-tap-track';

    tapTrack.setAttribute(
      'role',
      'progressbar'
    );

    tapTrack.setAttribute(
      'aria-label',
      'Tap ilerlemesi'
    );

    tapTrack.setAttribute(
      'aria-valuemin',
      '0'
    );

    tapTrack.setAttribute(
      'aria-valuemax',
      String(cycleTapCap)
    );

    tapTrack.setAttribute(
      'aria-valuenow',
      String(
        tapSum == null
          ? 0
          : Math.round(tapSum)
      )
    );


    const tapFill =
      document.createElement(
        'span'
      );

    tapFill.className =
      'cloud-miner-tap-fill';

    tapFill.style.width =
      `${tapPercent.toFixed(2)}%`;


    const tapPercentText =
      document.createElement(
        'b'
      );

    tapPercentText.className =
      'cloud-miner-tap-percent';

    tapPercentText.textContent =
      `%${tapPercent.toLocaleString('tr-TR', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      })}`;

    tapTrack.append(
      tapFill,
      tapPercentText
    );


    const remaining =
      document.createElement(
        'small'
      );

    remaining.className =
      'cloud-miner-tap-remaining';

    remaining.textContent =
      tapSum == null
        ? 'Zincir verisi bekleniyor'
        : `Kalan ${Math.max(0, Math.round(cycleTapCap - tapSum)).toLocaleString('tr-TR')} tap`;

    tapMetric.append(
      tapHead,
      tapTrack,
      remaining
    );


    const epochMetric =
      document.createElement(
        'div'
      );

    epochMetric.className =
      'cloud-miner-epoch-metric';

    epochMetric.innerHTML =
      `<span>EPOCH</span><strong>${epochCount.toLocaleString('tr-TR')}</strong><small>BU DÖNGÜDE</small>`;

    metrics.append(
      tapMetric,
      epochMetric
    );


    if (
      miner.status === 'error' &&
      miner.lastError
    ) {
      appendMeta(
        meta,
        `Hata: ${miner.lastError}`
      );
    }


    if (!meta.children.length) {
      appendMeta(
        meta,
        'Henüz çalışma kaydı yok'
      );
    }


    main.append(
      name,
      metrics,
      meta
    );


    const status =
      document.createElement(
        'span'
      );

    status.className =
      `cloud-miner-status ${
        safeStatus(
          miner.status
        )
      }`;

    status.textContent =
      statusLabel(
        miner.status
      );


    const controls =
      document.createElement(
        'div'
      );

    controls.className =
      'cloud-miner-controls';


    function addControl(
      action:
        | 'start'
        | 'stop'
        | 'remove',
      label: string,
      primary = false,
    ): void {

      const button =
        document.createElement(
          'button'
        );

      button.type =
        'button';

      button.dataset.minerAction =
        action;

      button.dataset.wallet =
        miner.walletName ||
        '';

      button.textContent =
        label;

      button.className =
        `cloud-miner-action ${action}`;

      if (primary) {
        button.classList.add(
          'primary'
        );
      }

      controls.append(
        button
      );
    }


    if (
      miner.status ===
      'active'
    ) {

      addControl(
        'stop',
        'DURDUR'
      );

    } else if (
      miner.status ===
      'stopped'
    ) {

      addControl(
        'start',
        'BAŞLAT',
        true
      );
    }


    /*
     * Removal is always available.
     * The controller itself requires an explicit
     * irreversible-action confirmation.
     */
    addControl(
      'remove',
      'KALDIR'
    );


    const right =
      document.createElement(
        'div'
      );

    right.className =
      'cloud-miner-right';

    right.append(
      status,
      controls
    );


    row.append(
      main,
      right
    );

    list.append(
      row
    );
  }
}


function renderAuthenticated(
  root: HTMLElement,
  data: DashboardMeData,
  username: string | null,
): void {

  setStatus(
    root,
    'authenticated'
  );

  const card =
    root.querySelector<HTMLElement>(
      '#cloud-auth-card'
    );

  if (!card) {
    return;
  }


  card.innerHTML =
    authenticatedMarkup();


  const miners =
    Array.isArray(
      data.miners
    )
      ? data.miners
      : [];


  const subscription =
    subscriptionInfo(
      data
    );


  const minerCount =
    card.querySelector<HTMLElement>(
      '#cloud-session-miners'
    );

  const topPlan =
    card.querySelector<HTMLElement>(
      '#cloud-session-plan'
    );

  const topRemaining =
    card.querySelector<HTMLElement>(
      '#cloud-session-remaining'
    );

  const subPlan =
    card.querySelector<HTMLElement>(
      '#cloud-sub-plan'
    );

  const subStatus =
    card.querySelector<HTMLElement>(
      '#cloud-sub-status'
    );

  const subRemaining =
    card.querySelector<HTMLElement>(
      '#cloud-sub-remaining'
    );

  const subEnd =
    card.querySelector<HTMLElement>(
      '#cloud-sub-end'
    );

  const user =
    card.querySelector<HTMLElement>(
      '#cloud-session-user'
    );


  if (minerCount) {
    minerCount.textContent =
      String(
        miners.length
      );
  }


  if (topPlan) {
    topPlan.textContent =
      subscription.planLabel;
  }


  if (topRemaining) {
    topRemaining.textContent =
      subscription.remainingLabel;
  }


  if (subPlan) {
    subPlan.textContent =
      subscription.planLabel;
  }


  if (subStatus) {

    subStatus.textContent =
      subscription.statusLabel;

    subStatus.classList.toggle(
      'active',
      subscription.active
    );

    subStatus.classList.toggle(
      'expired',
      !subscription.active
    );
  }


  if (subRemaining) {
    subRemaining.textContent =
      subscription.remainingLabel;
  }


  if (subEnd) {
    subEnd.textContent =
      subscription.endLabel;
  }


  if (user) {

    user.textContent =
      username
        ? `@${username.replace(/^@/, '')}`
        : 'Telegram oturumu';
  }


  renderMiners(
    card,
    miners,
    Math.max(
      0,
      Number(data.cycle?.tapCap) || 12_000,
    )
  );
}

function renderError(
  root: HTMLElement,
): void {

  setStatus(
    root,
    'error'
  );

  const card =
    root.querySelector<HTMLElement>(
      '#cloud-auth-card'
    );

  if (!card) {
    return;
  }

  card.innerHTML =
    loginMarkup();

  const message =
    card.querySelector<HTMLElement>(
      '#cloud-auth-message'
    );

  if (message) {

    message.hidden =
      false;

    message.textContent =
      'Dashboard sunucusuna ulaşılamadı. Tekrar deneyebilirsiniz.';
  }
}


export function mountCloudMiner(
  root: HTMLElement,
): () => void {

  let destroyed =
    false;

  const controller =
    new AbortController();

  const fragment =
    consumeTelegramAuthFragment();

  let callbackUsername:
    string | null =
    fragment.kind === 'token'
      ? fragment.username
      : null;


  let dashboardRefreshTimer:
    number | null =
      null;

  const observability =
    mountMiningObservability(
      root,
      {
        onUnauthorized:
          () => {

            clearSessionToken();

            callbackUsername =
              null;

            renderLogin(
              root,
              'Oturumunuz sona erdi. Lütfen tekrar giriş yapın.'
            );
          },
      }
    );


  const connectCleanup =
    mountMinerConnect(
      root,
      {
        onConnected:
          async (
            message: string,
          ) => {

            await verify();

            if (destroyed) {
              return;
            }

            const result =
              root.querySelector<HTMLElement>(
                '#cloud-connect-message'
              );

            if (result) {

              result.textContent =
                message;

              result.classList.remove(
                'error'
              );

              result.classList.add(
                'ok'
              );
            }
          },

        onUnauthorized:
          () => {

            clearSessionToken();

            callbackUsername =
              null;

            renderLogin(
              root,
              'Oturumunuz sona erdi. Lütfen tekrar giriş yapın.'
            );
          },
      }
    );


  const controlsCleanup =
    mountMinerControls(
      root,
      {
        onChanged:
          async (
            message: string,
          ) => {

            await verify();

            if (destroyed) {
              return;
            }

            const element =
              root.querySelector<HTMLElement>(
                '#cloud-control-message'
              );

            if (element) {

              element.hidden =
                false;

              element.textContent =
                message;

              element.classList.remove(
                'error'
              );

              element.classList.add(
                'ok'
              );
            }
          },

        onUnauthorized:
          () => {

            clearSessionToken();

            callbackUsername =
              null;

            renderLogin(
              root,
              'Oturumunuz sona erdi. Lütfen tekrar giriş yapın.'
            );
          },
      }
    );


  async function verify():
    Promise<void> {

    if (destroyed) {
      return;
    }

    const token =
      readSessionToken();

    if (!token) {

      renderLogin(
        root
      );

      return;
    }

    setStatus(
      root,
      'loading'
    );

    const result =
      await fetchDashboardMe(
        controller.signal
      );

    if (destroyed) {
      return;
    }

    if (
      result.kind ===
      'authenticated'
    ) {

      renderAuthenticated(
        root,
        result.data,
        callbackUsername
      );

      observability.update(
        result.data
      );

      callbackUsername =
        null;

      return;
    }

    if (
      result.kind ===
        'unauthorized' ||
      result.kind ===
        'anonymous'
    ) {

      renderLogin(
        root,
        result.kind ===
          'unauthorized'
          ? 'Oturumunuz sona erdi. Lütfen tekrar giriş yapın.'
          : undefined
      );

      return;
    }

    renderError(
      root
    );
  }


  function clickHandler(
    event: MouseEvent,
  ): void {

    const target =
      event.target;

    if (
      !(target instanceof Element)
    ) {
      return;
    }

    const logout =
      target.closest(
        '#cloud-auth-logout'
      );

    if (!logout) {
      return;
    }

    clearSessionToken();

    callbackUsername =
      null;

    renderLogin(
      root,
      'Oturum kapatıldı.'
    );
  }


  root.addEventListener(
    'click',
    clickHandler
  );


  if (
    fragment.kind ===
    'error'
  ) {

    clearSessionToken();

    renderLogin(
      root,
      TELEGRAM_ERRORS[
        fragment.error
      ] ||
        'Telegram ile giriş tamamlanamadı.'
    );

  } else {

    void verify();


  dashboardRefreshTimer =
    window.setInterval(
      () => {

        if (
          destroyed ||
          !window.localStorage.getItem(
            'radar_session'
          )
        ) {
          return;
        }

        /*
         * PHASE_7H_V2_PENDING_QR_GUARD_20260816
         *
         * renderAuthenticated() replaces the Cloud Miner
         * content. A regular 10-second verify while an
         * authorization QR is visible would therefore
         * destroy that QR.
         *
         * Successful wallet authorization still uses the
         * explicit onConnected() -> await verify() path.
         */
        if (
          root.querySelector(
            '.cloud-connect-approval'
          )
        ) {
          return;
        }


        void verify();

      },
      10_000
    );

  }


  return () => {

    destroyed =
      true;

    connectCleanup();

    controlsCleanup();

    observability.cleanup();

    if (
      dashboardRefreshTimer !==
      null
    ) {

      window.clearInterval(
        dashboardRefreshTimer
      );

      dashboardRefreshTimer =
        null;
    }

    controller.abort();

    root.removeEventListener(
      'click',
      clickHandler
    );
  };
}
