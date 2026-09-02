import { getUiLocale } from '../i18n/runtime';

import '../styles/plans.css';


import {
  authHeaders,
  clearSessionToken,
  consumeTelegramAuthFragment,
  fetchDashboardMe,
  readSessionToken,
  writeSessionToken,
  type DashboardMeData,
} from '../auth/session';


type PlanData =
  NonNullable<
    DashboardMeData['plans']
  >[number];


type PlansDashboardData =
  DashboardMeData & {
    paymentsLive?: boolean;

    starsPaymentsLive?: boolean;

    nacklPaymentsLive?: boolean;

    paymentsWallet?: string;

    nacklPaymentsWallet?: string;
  };


type ApiResult = {
  ok?: boolean;
  error?: string;

  currency?: string;
  network?: string;

  address?: string;
  code?: string;

  amountUsdt?: string;
  amountTon?: string | null;

  wallet?: string;
  amountNackl?: string;

  invoiceUrl?: string;
  stars?: number;

  expiresAt?: string;
};

type TelegramInvoiceStatus =
  | 'paid'
  | 'cancelled'
  | 'failed'
  | 'pending';

type TelegramInvoiceWindow = Window & {
  Telegram?: {
    WebApp?: {
      initData?: string;
      openInvoice?: (
        url: string,
        callback: (
          status: TelegramInvoiceStatus,
        ) => void,
      ) => void;
    };
  };
};


function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {

  const node =
    document.createElement(
      tag
    );

  if (className) {
    node.className =
      className;
  }

  return node;
}


function setMessage(
  root: HTMLElement,
  text: string,
  kind:
    'info' |
    'ok' |
    'error' =
      'info',
): void {

  const target =
    root.querySelector<HTMLElement>(
      '#plans-message'
    );

  if (!target) {
    return;
  }

  target.textContent =
    text;

  target.className =
    `plans-message ${kind}`;
}


function friendlyError(
  code: unknown,
): string {

  switch (
    String(
      code ||
      ''
    )
  ) {

    case 'PAYMENTS_NOT_LIVE':
      return 'USDT / TON ödemeleri şu anda kapalı.';

    case 'INVALID_PLAN':
      return 'Geçersiz plan seçildi.';

    case 'NACKL_PAYMENTS_NOT_LIVE':
      return 'NACKL ödemeleri şu anda kapalı.';

    case 'NACKL_PAYMENTS_NOT_READY':
      return 'NACKL ödeme sistemi henüz zincir senkronizasyonunu tamamlamadı.';

    case 'NACKL_INVOICE_AMOUNT_CAPACITY_REACHED':
      return 'Şu anda yeni NACKL ödeme kodu üretilemiyor. Bir süre sonra tekrar deneyin.';

    case 'STARS_NOT_LIVE':
      return 'Telegram Stars ödemeleri şu anda kapalı.';

    case 'STARS_INVOICE_FAILED':
      return 'Telegram Stars ödeme bağlantısı oluşturulamadı.';

    case 'UNAUTHORIZED':
      return 'Oturumunuz sona erdi. Lütfen tekrar giriş yapın.';

    default:
      return 'İşlem tamamlanamadı. Lütfen tekrar deneyin.';
  }
}


function createButton(
  label: string,
  action: string,
  planId: string,
  enabled: boolean,
  primary = false,
): HTMLButtonElement {

  const button =
    element(
      'button',
      primary
        ? 'plans-pay-button primary'
        : 'plans-pay-button'
    );

  button.type =
    'button';

  button.textContent =
    enabled
      ? label
      : 'Yakında';

  button.disabled =
    !enabled;

  if (enabled) {

    button.dataset.planAction =
      action;

    button.dataset.planId =
      planId;
  }

  return button;
}


function createPaymentOption(
  kind:
    'crypto' |
    'stars' |
    'nackl',
  title: string,
  subtitle: string,
  button: HTMLButtonElement,
): HTMLElement {

  const box =
    element(
      'div',
      `plans-pay-option ${kind}`
    );

  const price =
    element(
      'strong',
      'plans-pay-price'
    );

  price.textContent =
    title;

  const sub =
    element(
      'span',
      'plans-pay-subtitle'
    );

  sub.textContent =
    subtitle;

  box.append(
    price,
    sub,
    button
  );

  return box;
}


function createPlanCard(
  plan: PlanData,
  data: PlansDashboardData,
): HTMLElement {

  const id =
    String(
      plan.id ||
      ''
    );

  const featured =
    id ===
    'max';

  const card =
    element(
      'article',
      featured
        ? 'plans-card featured'
        : 'plans-card'
    );


  if (featured) {

    const badge =
      element(
        'span',
        'plans-popular'
      );

    badge.textContent =
      'POPÜLER';

    card.append(
      badge
    );
  }


  const head =
    element(
      'div',
      'plans-card-head'
    );

  const name =
    element(
      'h2'
    );

  name.textContent =
    String(
      plan.label ||
      id ||
      'Plan'
    );

  const days =
    element(
      'span'
    );

  days.textContent =
    `${
      Number(
        plan.days ||
        0
      )
    } GÜN`;

  head.append(
    name,
    days
  );

  card.append(
    head
  );


  const payments =
    element(
      'div',
      'plans-pay-options'
    );


  const cryptoButton =
    createButton(
      'USDT / TON ile öde',
      'crypto',
      id,
      Boolean(
        data.paymentsLive
      ),
      featured
    );


  payments.append(
    createPaymentOption(
      'crypto',
      `$${Number(
        plan.priceUsd ||
        0
      )}`,
      'USDT · TON',
      cryptoButton
    )
  );


  const starsButton =
    createButton(
      'Stars ile öde',
      'stars',
      id,
      Boolean(
        data.starsPaymentsLive
      )
    );


  payments.append(
    createPaymentOption(
      'stars',
      `${
        Number(
          plan.stars ||
          0
        )
      } ⭐`,
      `$${Number(
        plan.starsPriceUsd ||
        plan.priceUsd ||
        0
      )} karşılığı`,
      starsButton
    )
  );


  const nacklButton =
    createButton(
      'NACKL ile öde',
      'nackl',
      id,
      Boolean(
        data.nacklPaymentsLive
      )
    );


  payments.append(
    createPaymentOption(
      'nackl',
      `${
        String(
          plan.priceNackl ||
          '0'
        )
      } NACKL`,
      'ACKI NACKI NATIVE',
      nacklButton
    )
  );


  card.append(
    payments
  );

  return card;
}


function renderLogin(
  root: HTMLElement,
  message?: string,
): void {

  const body =
    root.querySelector<HTMLElement>(
      '#plans-body'
    );

  if (!body) {
    return;
  }


  body.replaceChildren();


  const card =
    element(
      'section',
      'plans-login-card'
    );

  const kicker =
    element(
      'span',
      'plans-kicker'
    );

  kicker.textContent =
    'SUBSCRIPTION ACCESS';

  const title =
    element(
      'h2'
    );

  title.textContent =
    'Planları görüntülemek için giriş yapın';

  const text =
    element(
      'p'
    );

  text.textContent =
    message ||
    'Planlar ve ödeme seçenekleri Telegram hesabınıza bağlıdır.';


  const login =
    element(
      'a',
      'plans-login-button'
    );

  login.href =
    '/api/auth/telegram/start';

  login.textContent =
    'TELEGRAM İLE GİRİŞ';


  card.append(
    kicker,
    title,
    text,
    login
  );

  body.append(
    card
  );
}


function renderSubscription(
  data: PlansDashboardData,
): HTMLElement {

  const card =
    element(
      'section',
      'plans-current'
    );

  const label =
    element(
      'span',
      'plans-kicker'
    );

  label.textContent =
    'CURRENT SUBSCRIPTION';

  card.append(
    label
  );


  const subscription =
    data.subscription;


  if (!subscription) {

    const title =
      element(
        'strong'
      );

    title.textContent =
      'Aktif plan yok';

    const sub =
      element(
        'small'
      );

    sub.textContent =
      'Cloud Miner kullanmak için aşağıdaki planlardan birini seçebilirsiniz.';

    card.append(
      title,
      sub
    );

    return card;
  }


  const plan =
    (
      data.plans ||
      []
    ).find(
      item =>
        item.id ===
        subscription.planId
    );


  const until =
    new Date(
      subscription.activeUntil ||
      ''
    );


  const active =
    Number.isFinite(
      until.getTime()
    ) &&
    until.getTime() >
      Date.now();


  const title =
    element(
      'strong'
    );

  title.textContent =
    plan?.label ||
    subscription.planId ||
    'Plan';


  const status =
    element(
      'span',
      active
        ? 'plans-sub-status active'
        : 'plans-sub-status expired'
    );

  status.textContent =
    active
      ? 'AKTİF'
      : 'SÜRESİ DOLDU';


  const sub =
    element(
      'small'
    );

  sub.textContent =
    Number.isFinite(
      until.getTime()
    )
      ? `Bitiş: ${
          until.toLocaleString(
            getUiLocale()
          )
        }`
      : 'Bitiş tarihi alınamadı.';


  card.append(
    title,
    status,
    sub
  );

  return card;
}


function renderAuthenticated(
  root: HTMLElement,
  rawData: DashboardMeData,
): void {

  const data =
    rawData as
      PlansDashboardData;


  const body =
    root.querySelector<HTMLElement>(
      '#plans-body'
    );

  if (!body) {
    return;
  }


  body.replaceChildren();


  body.append(
    renderSubscription(
      data
    )
  );

  const intro =
    element(
      'section',
      'plans-intro'
    );

  const introText =
    element(
      'div'
    );

  const kicker =
    element(
      'span',
      'plans-kicker'
    );

  kicker.textContent =
    'CLOUD MINER PLANS';

  const title =
    element(
      'h1'
    );

  title.textContent =
    'Planını seç';

  const description =
    element(
      'p'
    );

  description.textContent =
    'Ödeme kanallarının kullanılabilirliği zincir ve ödeme servislerinin canlı durumuna göre otomatik belirlenir.';


  introText.append(
    kicker,
    title,
    description
  );


  const status =
    element(
      'div',
      'plans-rail-status'
    );


  const railValues = [
    [
      'USDT / TON',
      Boolean(
        data.paymentsLive
      )
    ],

    [
      'STARS',
      Boolean(
        data.starsPaymentsLive
      )
    ],

    [
      'NACKL',
      Boolean(
        data.nacklPaymentsLive
      )
    ],
  ] as const;


  for (
    const [
      name,
      live
    ]
    of railValues
  ) {

    const chip =
      element(
        'span',
        live
          ? 'live'
          : 'offline'
      );

    chip.textContent =
      `${name} · ${
        live
          ? 'LIVE'
          : 'OFF'
      }`;

    status.append(
      chip
    );
  }


  intro.append(
    introText,
    status
  );

  body.append(
    intro
  );


  const grid =
    element(
      'div',
      'plans-grid'
    );

  grid.id =
    'plans-grid';


  for (
    const plan
    of data.plans ||
      []
  ) {

    grid.append(
      createPlanCard(
        plan,
        data
      )
    );
  }


  if (
    !grid.children.length
  ) {

    const empty =
      element(
        'div',
        'plans-empty'
      );

    empty.textContent =
      'Plan bilgisi alınamadı.';

    grid.append(
      empty
    );
  }


  body.append(
    grid
  );


  const message =
    element(
      'div',
      'plans-message'
    );

  message.id =
    'plans-message';


  const invoice =
    element(
      'section',
      'plans-invoice-slot'
    );

  invoice.id =
    'plans-invoice-slot';


  body.append(
    message,
    invoice
  );
}


function createCopyRow(
  label: string,
  value: string,
  emphasize = false,
): HTMLElement {

  const row =
    element(
      'div',
      'plans-copy-row'
    );

  const body =
    element(
      'div'
    );

  const key =
    element(
      'span'
    );

  key.textContent =
    label;

  const data =
    element(
      'strong',
      emphasize
        ? 'emphasis'
        : ''
    );

  data.textContent =
    value;

  body.append(
    key,
    data
  );


  const copy =
    element(
      'button',
      'plans-copy-button'
    );

  copy.type =
    'button';

  copy.textContent =
    'KOPYALA';

  copy.dataset.copyValue =
    value;


  row.append(
    body,
    copy
  );

  return row;
}


function renderTonInvoice(
  root: HTMLElement,
  data: ApiResult,
  startCountdown:
    (
      expiresAt: string,
      target: HTMLElement
    ) => void,
): void {

  const slot =
    root.querySelector<HTMLElement>(
      '#plans-invoice-slot'
    );

  if (!slot) {
    return;
  }


  const invoice =
    element(
      'article',
      'plans-invoice'
    );


  const head =
    element(
      'header'
    );

  const title =
    element(
      'strong'
    );

  title.textContent =
    'USDT / TON ÖDEME TALİMATI';


  const countdown =
    element(
      'span',
      'plans-countdown'
    );

  countdown.textContent =
    '—';


  head.append(
    title,
    countdown
  );


  const amount =
    `${
      String(
        data.amountUsdt ||
        ''
      )
    } USDT${
      data.amountTon
        ? ` / ${
            data.amountTon
          } TON`
        : ''
    }`;


  invoice.append(
    head,

    createCopyRow(
      'TUTAR',
      amount,
      true
    ),

    createCopyRow(
      'TON ADRESİ',
      String(
        data.address ||
        ''
      )
    ),

    createCopyRow(
      'MEMO / CODE',
      String(
        data.code ||
        ''
      ),
      true
    )
  );


  const warning =
    element(
      'p',
      'plans-invoice-warning'
    );

  warning.textContent =
    'Memo / code alanını eksiksiz gönderin. Kod olmadan ödeme hesabınızla eşleştirilemez.';

  invoice.append(
    warning
  );


  slot.replaceChildren(
    invoice
  );


  startCountdown(
    String(
      data.expiresAt ||
      ''
    ),
    countdown
  );
}


function renderNacklInvoice(
  root: HTMLElement,
  data: ApiResult,
  startCountdown:
    (
      expiresAt: string,
      target: HTMLElement
    ) => void,
): void {

  const slot =
    root.querySelector<HTMLElement>(
      '#plans-invoice-slot'
    );

  if (!slot) {
    return;
  }


  const invoice =
    element(
      'article',
      'plans-invoice nackl'
    );


  const head =
    element(
      'header'
    );

  const title =
    element(
      'strong'
    );

  title.textContent =
    'NACKL ÖDEME TALİMATI';


  const countdown =
    element(
      'span',
      'plans-countdown'
    );

  countdown.textContent =
    '—';


  head.append(
    title,
    countdown
  );


  invoice.append(
    head,

    createCopyRow(
      'TAM TUTAR',
      `${
        String(
          data.amountNackl ||
          ''
        )
      } NACKL`,
      true
    ),

    createCopyRow(
      'ACKI NACKI WALLET',
      String(
        data.wallet ||
        ''
      )
    )
  );


  const warning =
    element(
      'p',
      'plans-invoice-warning'
    );

  warning.textContent =
    'NACKL ödemesi exact amount ile eşleştirilir. Ekrandaki küsurat dahil tam tutarı gönderin.';

  invoice.append(
    warning
  );


  slot.replaceChildren(
    invoice
  );


  startCountdown(
    String(
      data.expiresAt ||
      ''
    ),
    countdown
  );
}


function validTelegramInvoice(
  raw: unknown,
): URL | null {

  try {

    const url =
      new URL(
        String(
          raw ||
          ''
        )
      );


    if (
      url.protocol !==
        'https:' ||
      url.hostname !==
        't.me'
    ) {
      return null;
    }


    return url;

  } catch {

    return null;
  }
}


export function mountPlans(
  root: HTMLElement,
): () => void {

  let destroyed =
    false;

  let invoiceTimer:
    number | null =
      null;


  const controller =
    new AbortController();


  function clearInvoiceTimer():
    void {

    if (
      invoiceTimer !==
      null
    ) {

      window.clearInterval(
        invoiceTimer
      );

      invoiceTimer =
        null;
    }
  }


  function startCountdown(
    expiresAt: string,
    target: HTMLElement,
  ): void {

    clearInvoiceTimer();


    const end =
      Date.parse(
        expiresAt
      );


    if (
      !Number.isFinite(
        end
      )
    ) {

      target.textContent =
        '—';

      return;
    }


    const tick =
      () => {

        const left =
          end -
          Date.now();


        if (
          left <= 0
        ) {

          target.textContent =
            'SÜRESİ DOLDU';

          clearInvoiceTimer();

          return;
        }


        const minutes =
          Math.floor(
            left /
            60_000
          );


        const seconds =
          Math.floor(
            (
              left %
              60_000
            ) /
            1000
          );


        target.textContent =
          `${
            minutes
          }:${
            String(
              seconds
            ).padStart(
              2,
              '0'
            )
          } KALDI`;
      };


    tick();


    invoiceTimer =
      window.setInterval(
        tick,
        1000
      );
  }


  async function verify():
    Promise<void> {

    const result =
      await fetchDashboardMe(
        controller.signal
      );


    if (
      destroyed
    ) {
      return;
    }


    if (
      result.kind ===
      'authenticated'
    ) {

      renderAuthenticated(
        root,
        result.data
      );

      return;
    }


    if (
      result.kind ===
      'unauthorized'
    ) {

      clearSessionToken();

      renderLogin(
        root,
        'Oturumunuz sona erdi. Lütfen tekrar giriş yapın.'
      );

      return;
    }


    if (
      result.kind ===
      'anonymous'
    ) {

      renderLogin(
        root
      );

      return;
    }


    renderLogin(
      root,
      result.message ||
      'Plan bilgileri alınamadı.'
    );
  }


  async function postPlan(
    path: string,
    planId: string,
  ): Promise<ApiResult | null> {

    try {

      const response =
        await fetch(
          path,
          {
            method:
              'POST',

            headers: {
              ...authHeaders(),

              'Content-Type':
                'application/json',
            },

            body:
              JSON.stringify({
                planId,
              }),

            signal:
              controller.signal,
          }
        );


      let data:
        ApiResult =
          {};


      try {

        data =
          await response.json() as
            ApiResult;

      } catch {

        data =
          {};
      }


      if (
        response.status ===
        401
      ) {

        clearSessionToken();

        renderLogin(
          root,
          'Oturumunuz sona erdi. Lütfen tekrar giriş yapın.'
        );

        return null;
      }


      if (
        !response.ok ||
        !data.ok
      ) {

        setMessage(
          root,
          friendlyError(
            data.error
          ),
          'error'
        );

        return null;
      }


      return data;

    } catch (error) {

      if (
        destroyed ||
        (
          error instanceof
            DOMException &&
          error.name ===
            'AbortError'
        )
      ) {
        return null;
      }


      setMessage(
        root,
        'Sunucuya ulaşılamadı. Lütfen tekrar deneyin.',
        'error'
      );

      return null;
    }
  }


  async function handlePayment(
    button: HTMLButtonElement,
  ): Promise<void> {

    const action =
      String(
        button.dataset.planAction ||
        ''
      );

    const planId =
      String(
        button.dataset.planId ||
        ''
      );


    if (
      !action ||
      !planId ||
      button.disabled
    ) {
      return;
    }


    const oldText =
      button.textContent ||
      'Öde';


    button.disabled =
      true;

    button.textContent =
      'HAZIRLANIYOR…';


    setMessage(
      root,
      'Ödeme talimatı hazırlanıyor…'
    );


    try {

      if (
        action ===
        'crypto'
      ) {

        const data =
          await postPlan(
            '/api/dashboard/plan/buy',
            planId
          );


        if (!data) {
          return;
        }


        renderTonInvoice(
          root,
          data,
          startCountdown
        );


        setMessage(
          root,
          'USDT / TON ödeme talimatı hazır.',
          'ok'
        );

        return;
      }


      if (
        action ===
        'nackl'
      ) {

        const data =
          await postPlan(
            '/api/dashboard/plan/nackl',
            planId
          );


        if (!data) {
          return;
        }


        renderNacklInvoice(
          root,
          data,
          startCountdown
        );


        setMessage(
          root,
          'NACKL ödeme talimatı hazır.',
          'ok'
        );

        return;
      }


      if (
        action ===
        'stars'
      ) {

        const data =
          await postPlan(
            '/api/dashboard/plan/stars',
            planId
          );


        if (!data) {
          return;
        }


        const invoice =
          validTelegramInvoice(
            data.invoiceUrl
          );


        if (!invoice) {

          setMessage(
            root,
            'Telegram ödeme bağlantısı doğrulanamadı.',
            'error'
          );

          return;
        }


        const webApp =
          (window as TelegramInvoiceWindow)
            .Telegram?.WebApp;


        if (
          webApp &&
          String(webApp.initData || '').trim()
        ) {

          if (
            typeof webApp.openInvoice !==
            'function'
          ) {

            setMessage(
              root,
              'Telegram sürümünüz Mini App içinde Stars ödemesini desteklemiyor. Telegram uygulamasını güncelleyin.',
              'error'
            );

            return;
          }


          const status =
            await new Promise<TelegramInvoiceStatus>(
              (resolve) => {

                try {

                  webApp.openInvoice!(
                    invoice.href,
                    resolve
                  );

                } catch {

                  resolve(
                    'failed'
                  );
                }
              }
            );


          if (
            status ===
            'paid'
          ) {

            setMessage(
              root,
              'Stars ödemeniz alındı. Abonelik yenileniyor…',
              'ok'
            );

            window.setTimeout(
              () => {
                if (!destroyed) {
                  void verify();
                }
              },
              1200
            );

          } else if (
            status ===
            'pending'
          ) {

            setMessage(
              root,
              'Stars ödemeniz işleniyor…',
              'info'
            );

            window.setTimeout(
              () => {
                if (!destroyed) {
                  void verify();
                }
              },
              2000
            );

          } else if (
            status ===
            'cancelled'
          ) {

            setMessage(
              root,
              'Stars ödemesi iptal edildi.',
              'info'
            );

          } else {

            setMessage(
              root,
              'Stars ödeme penceresi tamamlanamadı.',
              'error'
            );
          }

          return;
        }


        // Regular browsers do not expose Telegram.WebApp. Keep the existing
        // navigation fallback there; only Mini Apps use the in-place invoice.
        window.location.assign(
          invoice.href
        );

        return;
      }

    } finally {

      if (
        !destroyed &&
        button.isConnected
      ) {

        button.disabled =
          false;

        button.textContent =
          oldText;
      }
    }
  }


  async function copyValue(
    button: HTMLButtonElement,
  ): Promise<void> {

    const value =
      String(
        button.dataset.copyValue ||
        ''
      );


    if (!value) {
      return;
    }


    const old =
      button.textContent ||
      'KOPYALA';


    try {

      await navigator.clipboard.writeText(
        value
      );

      button.textContent =
        'KOPYALANDI';

    } catch {

      const textarea =
        document.createElement(
          'textarea'
        );

      textarea.value =
        value;

      textarea.style.position =
        'fixed';

      textarea.style.opacity =
        '0';

      document.body.append(
        textarea
      );

      textarea.select();

      document.execCommand(
        'copy'
      );

      textarea.remove();

      button.textContent =
        'KOPYALANDI';
    }


    window.setTimeout(
      () => {

        if (
          button.isConnected
        ) {

          button.textContent =
            old;
        }

      },
      1200
    );
  }


  const clickHandler =
    (
      event: Event
    ) => {

      const target =
        event.target;


      if (
        !(target instanceof
          Element)
      ) {
        return;
      }


      const payButton =
        target.closest<HTMLButtonElement>(
          '[data-plan-action]'
        );


      if (payButton) {

        void handlePayment(
          payButton
        );

        return;
      }


      const copyButton =
        target.closest<HTMLButtonElement>(
          '[data-copy-value]'
        );


      if (copyButton) {

        void copyValue(
          copyButton
        );
      }
    };


  root.addEventListener(
    'click',
    clickHandler
  );


  const fragment =
    consumeTelegramAuthFragment();


  if (
    fragment.kind ===
    'token'
  ) {

    writeSessionToken(
      fragment.token
    );
  }


  if (
    fragment.kind ===
    'error'
  ) {

    renderLogin(
      root,
      'Telegram ile giriş tamamlanamadı.'
    );

  } else if (
    !readSessionToken()
  ) {

    renderLogin(
      root
    );

  } else {

    void verify();
  }


  return () => {

    destroyed =
      true;

    clearInvoiceTimer();

    controller.abort();

    root.removeEventListener(
      'click',
      clickHandler
    );
  };
}


function scheduleMount(
  root: HTMLElement,
): void {

  queueMicrotask(
    () => {

      if (
        !root.isConnected
      ) {
        return;
      }


      const cleanup =
        mountPlans(
          root
        );


      const observer =
        new MutationObserver(
          () => {

            if (
              root.isConnected
            ) {
              return;
            }


            observer.disconnect();

            cleanup();
          }
        );


      observer.observe(
        document.body,
        {
          childList:
            true,

          subtree:
            true,
        }
      );
    }
  );
}


export function plansView():
  HTMLElement {

  const root =
    element(
      'section',
      'plans-view'
    );


  root.innerHTML = `
    <div class="plans-shell">

      <header class="plans-page-head">

        <div>
          <span class="plans-kicker">
            SUBSCRIPTION / PAYMENT
          </span>

          <h1>
            Planlar
          </h1>

          <p>
            Cloud Miner aboneliğinizi yönetin ve kullanılabilir ödeme kanalını seçin.
          </p>
        </div>

        <a
          class="plans-cloud-link"
          href="/cloud-miner"
          data-link
        >
          CLOUD MINER →
        </a>

      </header>

      <div id="plans-body">

        <div class="plans-loading">
          PLAN VERİLERİ ALINIYOR…
        </div>

      </div>

    </div>
  `;


  scheduleMount(
    root
  );


  return root;
}
