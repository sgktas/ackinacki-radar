import '../styles/referrals.css';

import {
  authHeaders,
  clearSessionToken,
  consumeTelegramAuthFragment,
  fetchDashboardMe,
  readSessionToken,
  writeSessionToken,
  type DashboardMeData,
} from '../auth/session';


const REFERRAL_STORAGE_KEY =
  'radar_pending_referral';


type ReferralData = {
  code?: string;
  link?: string;

  invitedCount?: number;
  qualifiedCount?: number;
  earnedDays?: number;

  nextThreshold?: number | null;
  nextRewardTotalDays?: number | null;

  completed?: boolean;
};


type ReferralBindResponse = {
  ok?: boolean;
  bound?: boolean;
  alreadyBound?: boolean;
  error?: string;
};


type BindResult =
  | {
      kind:
        'none';
    }
  | {
      kind:
        'success';
      alreadyBound:
        boolean;
    }
  | {
      kind:
        'permanent-error';
      error:
        string;
    }
  | {
      kind:
        'retry-later';
    }
  | {
      kind:
        'unauthorized';
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


function referralFrom(
  data: DashboardMeData,
): ReferralData | null {

  const raw =
    data.referral;

  if (
    !raw ||
    typeof raw !==
      'object'
  ) {
    return null;
  }

  return raw as
    ReferralData;
}


function captureReferralFromUrl():
  string | null {

  const url =
    new URL(
      window.location.href
    );


  const code =
    String(
      url.searchParams.get(
        'ref'
      ) ||
      ''
    ).trim();


  if (!code) {
    return null;
  }


  window.localStorage.setItem(
    REFERRAL_STORAGE_KEY,
    code
  );


  url.searchParams.delete(
    'ref'
  );


  const search =
    url.searchParams.toString();


  window.history.replaceState(
    null,
    '',
    url.pathname +
      (
        search
          ? `?${search}`
          : ''
      ) +
      url.hash
  );


  return code;
}


function pendingReferral():
  string | null {

  const value =
    String(
      window.localStorage.getItem(
        REFERRAL_STORAGE_KEY
      ) ||
      ''
    ).trim();


  return value || null;
}


function removePendingReferral():
  void {

  window.localStorage.removeItem(
    REFERRAL_STORAGE_KEY
  );
}


function friendlyBindError(
  code: string,
): string {

  switch (code) {

    case 'INVALID_REFERRAL_CODE':
      return 'Referans kodu geçersiz.';

    case 'REFERRAL_CODE_NOT_FOUND':
      return 'Referans kodu bulunamadı.';

    case 'SELF_REFERRAL_NOT_ALLOWED':
      return 'Kendi referans kodunuzu kullanamazsınız.';

    case 'REFERRAL_ALREADY_BOUND':
      return 'Hesabınız daha önce başka bir referansa bağlanmış.';

    case 'REFERRAL_BIND_TOO_LATE':
      return 'Ücretli abonelik başladıktan sonra referans kodu eklenemez.';

    default:
      return 'Referans kodu bağlanamadı.';
  }
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
      '#referrals-message'
    );


  if (!target) {
    return;
  }


  target.textContent =
    text;

  target.className =
    `referrals-message ${kind}`;
}


function renderLogin(
  root: HTMLElement,
  options?: {
    error?: string;
    referralSaved?: boolean;
  },
): void {

  const body =
    root.querySelector<HTMLElement>(
      '#referrals-body'
    );


  if (!body) {
    return;
  }


  body.replaceChildren();


  const card =
    element(
      'section',
      'referrals-login'
    );


  const kicker =
    element(
      'span',
      'referrals-kicker'
    );

  kicker.textContent =
    options?.referralSaved
      ? 'REFERRAL SAVED'
      : 'COMMUNITY ACCESS';


  const title =
    element(
      'h2'
    );

  title.textContent =
    options?.referralSaved
      ? 'Referans kodu kaydedildi'
      : 'Referans paneline giriş yapın';


  const text =
    element(
      'p'
    );

  text.textContent =
    options?.error ||
    (
      options?.referralSaved
        ? 'Telegram ile giriş yaptıktan sonra referans kodu hesabınıza otomatik olarak bağlanacak.'
        : 'Davet linkinizi ve referral istatistiklerinizi görmek için Telegram hesabınızla giriş yapın.'
    );


  const login =
    element(
      'a',
      'referrals-login-button'
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


function kpi(
  value: string,
  label: string,
  detail: string,
): HTMLElement {

  const card =
    element(
      'div',
      'referrals-kpi'
    );


  const number =
    element(
      'strong'
    );

  number.textContent =
    value;


  const name =
    element(
      'span'
    );

  name.textContent =
    label;


  const small =
    element(
      'small'
    );

  small.textContent =
    detail;


  card.append(
    number,
    name,
    small
  );


  return card;
}


function milestone(
  count: number,
  days: number,
  qualified: number,
): HTMLElement {

  const achieved =
    qualified >=
    count;


  const item =
    element(
      'div',
      achieved
        ? 'referrals-milestone achieved'
        : 'referrals-milestone'
    );


  const index =
    element(
      'span'
    );

  index.textContent =
    `${count}x`;


  const body =
    element(
      'div'
    );


  const title =
    element(
      'strong'
    );

  title.textContent =
    `${count} ücretli referral`;


  const sub =
    element(
      'small'
    );

  sub.textContent =
    `Toplam ödül seviyesi: ${days} gün`;


  body.append(
    title,
    sub
  );


  const status =
    element(
      'b'
    );

  status.textContent =
    achieved
      ? 'TAMAMLANDI'
      : 'HEDEF';


  item.append(
    index,
    body,
    status
  );


  return item;
}


function renderReferral(
  root: HTMLElement,
  referral: ReferralData | null,
): void {

  const body =
    root.querySelector<HTMLElement>(
      '#referrals-body'
    );


  if (!body) {
    return;
  }


  body.replaceChildren();


  if (
    !referral ||
    !referral.link
  ) {

    const empty =
      element(
        'div',
        'referrals-empty'
      );

    empty.textContent =
      'REFERANS BİLGİSİ HAZIRLANIYOR…';

    body.append(
      empty
    );

    return;
  }


  const invited =
    Number(
      referral.invitedCount ||
      0
    );


  const qualified =
    Number(
      referral.qualifiedCount ||
      0
    );


  const earned =
    Number(
      referral.earnedDays ||
      0
    );


  const completed =
    Boolean(
      referral.completed
    );


  const nextThreshold =
    Number(
      referral.nextThreshold ||
      0
    );


  const nextReward =
    Number(
      referral.nextRewardTotalDays ||
      0
    );


  const dashboard =
    element(
      'section',
      'referrals-dashboard'
    );


  const intro =
    element(
      'div',
      'referrals-intro'
    );


  const introBody =
    element(
      'div'
    );


  const kicker =
    element(
      'span',
      'referrals-kicker'
    );

  kicker.textContent =
    'REFERRAL PROGRAM';


  const title =
    element(
      'h1'
    );

  title.textContent =
    'Davet et, birlikte büyü';


  const description =
    element(
      'p'
    );

  description.textContent =
    'Ücretli aboneliğe dönüşen davetlerle Cloud Miner abonelik süresi kazan.';


  introBody.append(
    kicker,
    title,
    description
  );


  const codeBox =
    element(
      'div',
      'referrals-code'
    );


  const codeLabel =
    element(
      'span'
    );

  codeLabel.textContent =
    'KOD';


  const codeValue =
    element(
      'strong'
    );

  codeValue.textContent =
    String(
      referral.code ||
      '—'
    );


  codeBox.append(
    codeLabel,
    codeValue
  );


  intro.append(
    introBody,
    codeBox
  );


  dashboard.append(
    intro
  );


  const kpis =
    element(
      'div',
      'referrals-kpis'
    );


  kpis.append(
    kpi(
      String(
        invited
      ),
      'DAVET',
      'Referans koduyla bağlanan'
    ),

    kpi(
      String(
        qualified
      ),
      'ÜCRETLİ',
      'Ücretli plana dönüşen'
    ),

    kpi(
      String(
        earned
      ),
      'KAZANILAN GÜN',
      'Aboneliğe eklenen toplam süre'
    )
  );


  dashboard.append(
    kpis
  );


  const linkCard =
    element(
      'div',
      'referrals-link-card'
    );


  const linkHead =
    element(
      'div',
      'referrals-link-head'
    );


  const linkTitle =
    element(
      'strong'
    );

  linkTitle.textContent =
    'REFERANS LİNKİN';


  const linkHint =
    element(
      'span'
    );

  linkHint.textContent =
    'Arkadaşların bu link üzerinden giriş yapmalı.';


  linkHead.append(
    linkTitle,
    linkHint
  );


  const linkRow =
    element(
      'div',
      'referrals-link-row'
    );


  const input =
    element(
      'input'
    );

  input.id =
    'referral-link-input';

  input.readOnly =
    true;

  input.value =
    String(
      referral.link
    );


  const copy =
    element(
      'button',
      'referrals-copy-button'
    );

  copy.id =
    'referral-copy-btn';

  copy.type =
    'button';

  copy.textContent =
    'LİNKİ KOPYALA';

  copy.dataset.copyReferral =
    String(
      referral.link
    );


  linkRow.append(
    input,
    copy
  );


  linkCard.append(
    linkHead,
    linkRow
  );


  dashboard.append(
    linkCard
  );


  const progressCard =
    element(
      'div',
      'referrals-progress-card'
    );


  const progressHead =
    element(
      'div',
      'referrals-progress-head'
    );


  const progressTitle =
    element(
      'strong'
    );

  progressTitle.textContent =
    completed
      ? 'TÜM HEDEFLER TAMAMLANDI'
      : 'SONRAKİ HEDEF';


  const progressValue =
    element(
      'span'
    );

  progressValue.id =
    'referrals-next-value';


  progressValue.textContent =
    completed
      ? '9 / 9 · 90 GÜN'
      : `${
          qualified
        } / ${
          nextThreshold
        } · ${
          nextReward
        } GÜN`;


  progressHead.append(
    progressTitle,
    progressValue
  );


  const progress =
    element(
      'div',
      'referrals-progress'
    );


  const bar =
    element(
      'i'
    );


  const progressPercent =
    completed
      ? 100
      : (
          nextThreshold > 0
            ? Math.max(
                0,
                Math.min(
                  100,
                  (
                    qualified /
                    nextThreshold
                  ) *
                  100
                )
              )
            : 0
        );


  bar.style.width =
    `${progressPercent}%`;


  progress.append(
    bar
  );


  progressCard.append(
    progressHead,
    progress
  );


  dashboard.append(
    progressCard
  );


  const milestones =
    element(
      'div',
      'referrals-milestones'
    );


  milestones.append(
    milestone(
      1,
      15,
      qualified
    ),

    milestone(
      3,
      30,
      qualified
    ),

    milestone(
      9,
      90,
      qualified
    )
  );


  dashboard.append(
    milestones
  );


  const rules =
    element(
      'section',
      'referrals-rules'
    );


  rules.innerHTML = `
    <div>
      <span>01</span>
      <p>
        Davet edilen kullanıcı önce referans koduyla
        hesabınıza bağlanır.
      </p>
    </div>

    <div>
      <span>02</span>
      <p>
        Referral ancak gerçek ücretli abonelik
        aldığında “Ücretli” sayılır.
      </p>
    </div>

    <div>
      <span>03</span>
      <p>
        Trial ve test planları ücretli referral
        sayılmaz.
      </p>
    </div>

    <div>
      <span>04</span>
      <p>
        Referral bağlantısı kalıcıdır; sonradan
        başka referrera taşınamaz.
      </p>
    </div>
  `;


  dashboard.append(
    rules
  );


  const message =
    element(
      'div',
      'referrals-message'
    );

  message.id =
    'referrals-message';


  dashboard.append(
    message
  );


  body.append(
    dashboard
  );
}


async function copyText(
  value: string,
): Promise<void> {

  try {

    await navigator.clipboard.writeText(
      value
    );

    return;

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
  }
}


export function mountReferrals(
  root: HTMLElement,
): () => void {

  let destroyed =
    false;


  let copyTimer:
    number | null =
      null;


  const controller =
    new AbortController();


  const capturedReferral =
    captureReferralFromUrl();


  function clearCopyTimer():
    void {

    if (
      copyTimer !==
      null
    ) {

      window.clearTimeout(
        copyTimer
      );

      copyTimer =
        null;
    }
  }


  async function bindPendingReferral():
    Promise<BindResult> {

    const code =
      pendingReferral();


    if (!code) {

      return {
        kind:
          'none',
      };
    }


    try {

      const response =
        await fetch(
          '/api/dashboard/referral/bind',
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
                code,
              }),

            signal:
              controller.signal,
          }
        );


      let data:
        ReferralBindResponse =
          {};


      try {

        data =
          await response.json() as
            ReferralBindResponse;

      } catch {

        data =
          {};
      }


      if (
        response.status ===
        401
      ) {

        clearSessionToken();

        return {
          kind:
            'unauthorized',
        };
      }


      if (
        response.ok &&
        data.ok
      ) {

        removePendingReferral();


        return {
          kind:
            'success',

          alreadyBound:
            Boolean(
              data.alreadyBound
            ),
        };
      }


      const codeName =
        String(
          data.error ||
          ''
        );


      const permanentErrors = [
        'INVALID_REFERRAL_CODE',
        'REFERRAL_CODE_NOT_FOUND',
        'SELF_REFERRAL_NOT_ALLOWED',
        'REFERRAL_ALREADY_BOUND',
        'REFERRAL_BIND_TOO_LATE',
      ];


      if (
        permanentErrors.includes(
          codeName
        )
      ) {

        removePendingReferral();


        return {
          kind:
            'permanent-error',

          error:
            codeName,
        };
      }


      return {
        kind:
          'retry-later',
      };

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

        return {
          kind:
            'retry-later',
        };
      }


      /*
       * Network/transient error:
       * keep referral in localStorage
       * so the next authenticated load retries.
       */
      return {
        kind:
          'retry-later',
      };
    }
  }


  async function verify():
    Promise<void> {

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

      renderReferral(
        root,
        referralFrom(
          result.data
        )
      );


      const bindResult =
        await bindPendingReferral();


      if (destroyed) {
        return;
      }


      if (
        bindResult.kind ===
        'success'
      ) {

        setMessage(
          root,
          bindResult.alreadyBound
            ? 'Referans bağlantınız zaten kayıtlı.'
            : 'Referans kodu hesabınıza bağlandı.',
          'ok'
        );

        return;
      }


      if (
        bindResult.kind ===
        'permanent-error'
      ) {

        setMessage(
          root,
          friendlyBindError(
            bindResult.error
          ),
          'error'
        );

        return;
      }


      if (
        bindResult.kind ===
        'retry-later'
      ) {

        setMessage(
          root,
          'Referans kodu şu anda bağlanamadı. Kod saklandı ve sonraki girişte tekrar denenecek.',
          'info'
        );

        return;
      }


      if (
        bindResult.kind ===
        'unauthorized'
      ) {

        renderLogin(
          root,
          {
            error:
              'Oturumunuz sona erdi. Referans kodunuz saklandı; tekrar giriş yapın.',

            referralSaved:
              Boolean(
                pendingReferral()
              ),
          }
        );
      }


      return;
    }


    if (
      result.kind ===
      'unauthorized'
    ) {

      clearSessionToken();


      renderLogin(
        root,
        {
          error:
            'Oturumunuz sona erdi. Lütfen tekrar giriş yapın.',

          referralSaved:
            Boolean(
              pendingReferral()
            ),
        }
      );

      return;
    }


    if (
      result.kind ===
      'anonymous'
    ) {

      renderLogin(
        root,
        {
          referralSaved:
            Boolean(
              pendingReferral()
            ),
        }
      );

      return;
    }


    renderLogin(
      root,
      {
        error:
          result.message ||
          'Referans bilgileri alınamadı.',

        referralSaved:
          Boolean(
            pendingReferral()
          ),
      }
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


      const button =
        target.closest<HTMLButtonElement>(
          '[data-copy-referral]'
        );


      if (!button) {
        return;
      }


      const value =
        String(
          button.dataset.copyReferral ||
          ''
        );


      if (!value) {
        return;
      }


      const old =
        button.textContent ||
        'LİNKİ KOPYALA';


      void copyText(
        value
      ).then(
        () => {

          if (
            destroyed ||
            !button.isConnected
          ) {
            return;
          }


          button.textContent =
            'KOPYALANDI';


          setMessage(
            root,
            'Referans linki panoya kopyalandı.',
            'ok'
          );


          clearCopyTimer();


          copyTimer =
            window.setTimeout(
              () => {

                if (
                  button.isConnected
                ) {

                  button.textContent =
                    old;
                }


                copyTimer =
                  null;
              },
              1400
            );
        }
      );
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
      {
        error:
          'Telegram ile giriş tamamlanamadı.',

        referralSaved:
          Boolean(
            pendingReferral()
          ),
      }
    );

  } else if (
    !readSessionToken()
  ) {

    renderLogin(
      root,
      {
        referralSaved:
          Boolean(
            capturedReferral ||
            pendingReferral()
          ),
      }
    );

  } else {

    void verify();
  }


  return () => {

    destroyed =
      true;

    clearCopyTimer();

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
        mountReferrals(
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


export function referralsView():
  HTMLElement {

  const root =
    element(
      'section',
      'referrals-view'
    );


  root.innerHTML = `
    <div class="referrals-shell">

      <header class="referrals-page-head">

        <div>
          <span class="referrals-kicker">
            COMMUNITY / GROWTH
          </span>

          <h1>
            Referanslar
          </h1>

          <p>
            Arkadaşlarını davet et, ücretli aboneliğe
            dönüşen referral'larla abonelik süresi kazan.
          </p>
        </div>

        <a
          class="referrals-plans-link"
          href="/plans"
          data-link
        >
          PLANLAR →
        </a>

      </header>

      <div id="referrals-body">

        <div class="referrals-empty">
          REFERANS BİLGİLERİ ALINIYOR…
        </div>

      </div>

    </div>
  `;


  scheduleMount(
    root
  );


  return root;
}
