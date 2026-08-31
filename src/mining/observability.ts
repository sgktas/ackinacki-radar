import { getUiLocale } from '../i18n/runtime';

import {
  authHeaders,
  readSessionToken,
  type DashboardMeData,
  type DashboardMiningHealth,
  type DashboardRewardRow,
} from '../auth/session';


type MiningCycleClock = {
  observedAt?: string;

  currentSeqNo?: number;

  epochStartSeq?: number;
  epochEndSeq?: number;

  epochStartAt?: string;
  epochEndAt?: string;

  periodBlocks?: number;

  progress?: number;

  remainingSeconds?: number;
  fullCycleSeconds?: number;

  blocksPerSecond?: number;

  rateSource?: string;

  stale?: boolean;

  warning?: string;
};


type MiningCycleClockResponse = {
  ok?: boolean;

  clock?:
    MiningCycleClock;

  error?: string;
};


type ObservabilityOptions = {
  onUnauthorized:
    () => void;
};


export type MiningObservabilityController = {
  update:
    (
      data:
        DashboardMeData,
    ) => void;

  refreshClock:
    () => Promise<void>;

  cleanup:
    () => void;
};


function numberValue(
  value: unknown,
  fallback = 0,
): number {

  const numeric =
    Number(
      value
    );

  return Number.isFinite(
    numeric
  )
    ? numeric
    : fallback;
}


function integerValue(
  value: unknown,
): number {

  return Math.max(
    0,
    Math.floor(
      numberValue(
        value,
        0
      )
    )
  );
}


function formatCountdown(
  value: unknown,
): string {

  const safe =
    Math.max(
      0,
      Math.floor(
        numberValue(
          value,
          0
        )
      )
    );

  const hours =
    Math.floor(
      safe / 3600
    );

  const minutes =
    Math.floor(
      (
        safe %
        3600
      ) /
      60
    );

  const seconds =
    safe %
    60;

  return (
    String(
      hours
    ).padStart(
      2,
      '0'
    ) +
    ':' +
    String(
      minutes
    ).padStart(
      2,
      '0'
    ) +
    ':' +
    String(
      seconds
    ).padStart(
      2,
      '0'
    )
  );
}


function formatUtc(
  raw:
    string | undefined,
): string {

  if (!raw) {
    return '—';
  }

  const date =
    new Date(
      raw
    );

  if (
    !Number.isFinite(
      date.getTime()
    )
  ) {
    return '—';
  }

  const parts =
    new Intl.DateTimeFormat(
      'en-GB',
      {
        timeZone:
          'UTC',

        day:
          '2-digit',

        month:
          '2-digit',

        year:
          'numeric',

        hour:
          '2-digit',

        minute:
          '2-digit',

        second:
          '2-digit',

        hour12:
          false,
      }
    ).format(
      date
    );

  return `${parts} UTC`;
}


function formatTime(
  raw:
    string | undefined,
): string {

  if (!raw) {
    return '—';
  }

  const date =
    new Date(
      raw
    );

  if (
    !Number.isFinite(
      date.getTime()
    )
  ) {
    return '—';
  }

  return date.toLocaleTimeString(
    getUiLocale(),
    {
      hour:
        '2-digit',

      minute:
        '2-digit',

      second:
        '2-digit',
    }
  );
}


function setText(
  root: HTMLElement,
  selector: string,
  value: string,
): void {

  const element =
    root.querySelector<HTMLElement>(
      selector
    );

  if (element) {
    element.textContent =
      value;
  }
}


function healthStatusLabel(
  status:
    DashboardMiningHealth['status'],
): string {

  switch (status) {

    case 'healthy':
      return 'SAĞLIKLI';

    case 'warning':
      return 'DİKKAT';

    case 'critical':
      return 'KRİTİK';

    default:
      return 'VERİ BEKLENİYOR';
  }
}


function healthResultLabel(
  status:
    string | undefined,
): string {

  switch (status) {

    case 'healthy':
      return 'BAŞARILI';

    case 'recovered':
      return 'KURTARILDI';

    case 'pending':
      return 'SONUÇ BELİRSİZ';

    case 'lost':
      return 'KAYIP';

    default:
      return 'BİLİNMİYOR';
  }
}


function healthIssueLabel(
  code:
    string | null | undefined,
): string {

  switch (code) {

    case 'producer_queue_congestion':
      return 'MAINNET ÜRETİCİ KUYRUĞU DOLU';

    case 'submission_proof_missing':
      return 'PROOF GÖNDERİMİ TAMAMLANMADI';

    case 'chain_confirmation_timeout':
      return 'ZİNCİR ONAYI ZAMAN AŞIMI';

    case 'session_rejected':
      return 'OTURUM ZİNCİR TARAFINDAN REDDEDİLDİ';

    case 'sdk_error':
      return 'BEE SDK GÖNDERİM HATASI';

    case 'claim_failed':
      return 'ÖDÜL CLAIM İŞLEMİ BAŞARISIZ';

    default:
      return 'NEDEN BELİRLENEMEDİ';
  }
}


function healthIssueDetail(
  code:
    string | null | undefined,
): string {

  switch (code) {

    case 'producer_queue_congestion':
      return 'Mainnet üretici düğümü mesajı kabul etmedi; otomatik yeniden deneme uygulandı.';

    case 'submission_proof_missing':
      return 'Root görüldü ancak proof aşaması tamamlanmadı. Mainnet yoğunluğu veya gönderim kesintisi olası.';

    case 'chain_confirmation_timeout':
      return 'Root ve proof görüldü ancak zincir kabulü bekleme süresinde doğrulanamadı.';

    case 'session_rejected':
      return 'Zincir oturumu açık biçimde reddetti; bu kayıt kayıp olarak sınıflandırıldı.';

    case 'sdk_error':
      return 'Bee SDK gönderim sırasında kesin hata bildirdi.';

    case 'claim_failed':
      return 'Epoch ödülü toplama isteği tamamlanamadı ve yeniden denenecek.';

    default:
      return 'Oturum kesin sonuca bağlanamadı.';
  }
}


function claimLabel(
  value:
    string | undefined,
): string {

  switch (value) {

    case 'collected':
      return 'TOPLANDI';

    case 'failed':
      return 'HATA';

    case 'queued':
      return 'SIRADA';

    default:
      return 'YOK';
  }
}


function createHealthDetail(
  label: string,
  value: string,
): HTMLElement {

  const item =
    document.createElement(
      'div'
    );

  const name =
    document.createElement(
      'span'
    );

  name.textContent =
    label;

  const data =
    document.createElement(
      'b'
    );

  data.textContent =
    value;

  item.append(
    name,
    data
  );

  return item;
}


function renderMiningHealth(
  root: HTMLElement,
  health:
    DashboardMiningHealth | undefined,
): void {

  const badge =
    root.querySelector<HTMLElement>(
      '#cloud-health-status'
    );

  const timeline =
    root.querySelector<HTMLElement>(
      '#cloud-health-timeline'
    );

  const events =
    root.querySelector<HTMLElement>(
      '#cloud-health-events'
    );

  const reason =
    root.querySelector<HTMLElement>(
      '#cloud-health-reason'
    );

  const reasonTitle =
    root.querySelector<HTMLElement>(
      '#cloud-health-reason-title'
    );

  const reasonDetail =
    root.querySelector<HTMLElement>(
      '#cloud-health-reason-detail'
    );


  const status =
    health?.status === 'healthy' ||
    health?.status === 'warning' ||
    health?.status === 'critical'
      ? health.status
      : 'idle';


  if (badge) {

    badge.textContent =
      healthStatusLabel(
        status
      );

    badge.className =
      `cloud-health-status ${status}`;
  }


  const primaryIssue =
    health?.primaryIssue;

  const primaryIssueCount =
    integerValue(
      primaryIssue?.count
    );


  if (reason) {

    const showReason =
      primaryIssueCount > 0 &&
      Boolean(
        primaryIssue?.code
      );


    reason.hidden =
      !showReason;

    reason.className =
      `cloud-health-reason ${status}`;


    if (
      showReason &&
      reasonTitle &&
      reasonDetail
    ) {

      reasonTitle.textContent =
        healthIssueLabel(
          primaryIssue?.code
        );

      reasonDetail.textContent =
        `${primaryIssueCount} oturum · ${healthIssueDetail(
          primaryIssue?.code
        )}`;
    }
  }


  const rate =
    health?.successRate == null
      ? '—'
      : `%${numberValue(
          health.successRate
        ).toLocaleString(
          getUiLocale(),
          {
            maximumFractionDigits:
              2,
          }
        )}`;


  setText(
    root,
    '#cloud-health-rate',
    rate
  );

  setText(
    root,
    '#cloud-health-success',
    String(
      integerValue(
        health?.healthy
      )
    )
  );

  setText(
    root,
    '#cloud-health-recovered',
    String(
      integerValue(
        health?.recovered
      )
    )
  );

  setText(
    root,
    '#cloud-health-pending',
    String(
      integerValue(
        health?.pending
      )
    )
  );

  setText(
    root,
    '#cloud-health-lost',
    String(
      integerValue(
        health?.lost
      )
    )
  );

  setText(
    root,
    '#cloud-health-claim',
    String(
      integerValue(
        health?.claimIssues
      )
    )
  );


  if (
    !timeline ||
    !events
  ) {
    return;
  }


  timeline.replaceChildren();
  events.replaceChildren();


  const hasData =
    Boolean(
      health?.available
    ) &&
    integerValue(
      health?.total
    ) > 0;


  if (!hasData) {

    const empty =
      document.createElement(
        'div'
      );

    empty.className =
      'cloud-observe-empty';

    empty.textContent =
      'Mining başladığında mevcut döngünün sağlık verileri burada görünecek.';

    events.append(
      empty
    );

    return;
  }


  const latest =
    Array.isArray(
      health?.latest
    )
      ? health.latest
      : [];


  for (
    const item
    of latest
      .slice(
        0,
        20
      )
      .reverse()
  ) {

    const state =
      item.status === 'healthy' ||
      item.status === 'recovered' ||
      item.status === 'pending' ||
      item.status === 'lost'
        ? item.status
        : 'lost';


    const dot =
      document.createElement(
        'span'
      );

    dot.className =
      `cloud-health-dot ${state}`;

    dot.title =
      (
        `Epoch ${String(
          item.epoch5mStart ??
          '—'
        )}` +
        ` · ${String(
          item.walletName ??
          '—'
        )}` +
        ` · Δ ${
          item.tapDelta == null
            ? '—'
            : String(
                item.tapDelta
              )
        }` +
        ` · retry ${
          integerValue(
            item.retries
          )
        }`
      );

    timeline.append(
      dot
    );
  }


  for (
    const item
    of latest.slice(
      0,
      8
    )
  ) {

    const state =
      item.status === 'healthy' ||
      item.status === 'recovered' ||
      item.status === 'pending' ||
      item.status === 'lost'
        ? item.status
        : 'lost';


    const details =
      document.createElement(
        'details'
      );

    details.className =
      'cloud-health-event';


    const summary =
      document.createElement(
        'summary'
      );


    const stateDot =
      document.createElement(
        'i'
      );

    stateDot.className =
      `cloud-health-event-state ${state}`;


    const epoch =
      document.createElement(
        'b'
      );

    epoch.textContent =
      String(
        item.epoch5mStart ??
        '—'
      );


    const wallet =
      document.createElement(
        'span'
      );

    wallet.textContent =
      item.walletName ||
      '—';


    const result =
      document.createElement(
        'strong'
      );

    result.className =
      state;

    result.textContent =
      healthResultLabel(
        state
      );


    summary.append(
      stateDot,
      epoch,
      wallet,
      result
    );


    const detail =
      document.createElement(
        'div'
      );

    detail.className =
      'cloud-health-detail';


    detail.append(
      createHealthDetail(
        'TAP',
        item.taps == null
          ? '—'
          : String(
              item.taps
            )
      ),

      createHealthDetail(
        'TAP DELTA',
        item.tapDelta == null
          ? '—'
          : (
              item.tapDelta >= 0
                ? `+${item.tapDelta}`
                : String(
                    item.tapDelta
                  )
            )
      ),

      createHealthDetail(
        'RETRY',
        `${
          integerValue(
            item.retries
          )
        } · ${
          item.retryMode ||
          'none'
        }`
      ),

      createHealthDetail(
        'SETTLEMENT',
        item.settlement ||
        '—'
      ),

      createHealthDetail(
        'CLAIM',
        claimLabel(
          item.claim
        )
      ),

      createHealthDetail(
        'REJECTED',
        item.rejected
          ? 'EVET'
          : 'HAYIR'
      ),

      createHealthDetail(
        'NEDEN',
        item.issueCode
          ? healthIssueLabel(
              item.issueCode
            )
          : '—'
      ),

      createHealthDetail(
        'KUYRUK RETRY',
        String(
          integerValue(
            item.queueOverflowRetriesObserved
          )
        )
      )
    );


    details.append(
      summary,
      detail
    );

    events.append(
      details
    );
  }
}


function latestRewardChainRead(
  data: DashboardMeData,
): string | null {

  const values =
    (
      data.miners ||
      []
    )
      .map(
        miner =>
          miner.rewardLastChainReadAt
      )
      .filter(
        (
          value
        ): value is string =>
          Boolean(
            value
          )
      )
      .sort();


  return values.length
    ? values[
        values.length -
        1
      ]
    : null;
}


function rewardReadIsFresh(
  data: DashboardMeData,
): boolean {

  const raw =
    latestRewardChainRead(
      data
    );

  if (!raw) {
    return false;
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
    return false;
  }


  const poll =
    Math.max(
      1,
      numberValue(
        data.rewardFeedPollSeconds,
        15
      )
    );


  return (
    Date.now() -
      time
  ) <=
    Math.max(
      60_000,
      poll *
        3000
    );
}


function renderRewards(
  root: HTMLElement,
  data: DashboardMeData,
): void {

  const feed =
    root.querySelector<HTMLElement>(
      '#cloud-reward-feed'
    );

  if (!feed) {
    return;
  }


  const rewards:
    DashboardRewardRow[] =
      Array.isArray(
        data.rewards
      )
        ? data.rewards
        : [];


  const pollSeconds =
    Math.max(
      1,
      integerValue(
        data.rewardFeedPollSeconds ||
        15
      )
    );


  const fresh =
    rewardReadIsFresh(
      data
    );


  setText(
    root,
    '#cloud-reward-note',
    fresh
      ? `CANLI · ${pollSeconds}s`
      : 'Zincir bağlantısı bekleniyor'
  );


  const cycleTotal =
    data.rewardCycle &&
    Number.isFinite(
      Number(
        data.rewardCycle
          .totalNackl
      )
    )
      ? Number(
          data.rewardCycle
            .totalNackl
        )
      : null;


  const cycleCount =
    data.rewardCycle &&
    Number.isFinite(
      Number(
        data.rewardCycle
          .count
      )
    )
      ? Math.max(
          0,
          Number(
            data.rewardCycle
              .count
          )
        )
      : null;


  const partial =
    Boolean(
      data.rewardCycle
        ?.partial
    );


  if (
    cycleTotal !== null
  ) {

    setText(
      root,
      '#cloud-reward-total',

      (
        partial
          ? '~+'
          : '+'
      ) +
      cycleTotal.toFixed(
        4
      ) +
      ' NACKL (' +
      String(
        cycleCount ??
        0
      ) +
      (
        partial
          ? '+'
          : ''
      ) +
      ')'
    );

  } else if (
    rewards.length
  ) {

    const fallback =
      rewards.reduce(
        (
          total,
          row
        ) =>
          total +
          numberValue(
            row.amount,
            0
          ),
        0
      );


    setText(
      root,
      '#cloud-reward-total',

      `+${
        fallback.toFixed(
          4
        )
      } NACKL (${
        rewards.length
      })`
    );

  } else {

    setText(
      root,
      '#cloud-reward-total',
      '—'
    );
  }


  const partialNote =
    root.querySelector<HTMLElement>(
      '#cloud-reward-partial'
    );


  if (partialNote) {

    partialNote.hidden =
      !partial;

    partialNote.textContent =
      partial
        ? 'Mevcut döngü toplamı kısmi başlangıç verisi içeriyor.'
        : '';
  }


  feed.replaceChildren();


  if (!rewards.length) {

    const empty =
      document.createElement(
        'div'
      );

    empty.className =
      'cloud-observe-empty';

    empty.textContent =
      'Henüz reward ölçümü yok.';

    feed.append(
      empty
    );

    return;
  }


  for (
    const reward
    of rewards
  ) {

    const row =
      document.createElement(
        'div'
      );

    row.className =
      'cloud-reward-row';


    const amount =
      document.createElement(
        'b'
      );

    amount.textContent =
      `+${
        numberValue(
          reward.amount,
          0
        ).toFixed(
          4
        )
      }`;


    const meta =
      document.createElement(
        'div'
      );

    meta.className =
      'cloud-reward-meta';


    const wallet =
      document.createElement(
        'span'
      );

    wallet.textContent =
      reward.walletName ||
      '—';


    const clock =
      document.createElement(
        'span'
      );

    clock.textContent =
      formatTime(
        reward.at
      );


    meta.append(
      wallet,
      clock
    );


    row.append(
      amount,
      meta
    );

    feed.append(
      row
    );
  }
}


function currentRemaining(
  clock:
    MiningCycleClock | null,
): number {

  if (!clock) {
    return 0;
  }


  const observed =
    Date.parse(
      clock.observedAt ||
      ''
    );


  const ageSeconds =
    Number.isFinite(
      observed
    )
      ? Math.max(
          0,
          (
            Date.now() -
            observed
          ) /
          1000
        )
      : 0;


  return Math.max(
    0,
    numberValue(
      clock.remainingSeconds,
      0
    ) -
    ageSeconds
  );
}


function renderClock(
  root: HTMLElement,
  clock:
    MiningCycleClock | null,
): void {

  const card =
    root.querySelector<HTMLElement>(
      '#cloud-cycle-monitor'
    );

  if (!card) {
    return;
  }


  const status =
    root.querySelector<HTMLElement>(
      '#cloud-cycle-status'
    );


  if (!clock) {

    setText(
      root,
      '#cloud-cycle-countdown',
      '—'
    );

    if (status) {

      status.textContent =
        'SYNC';

      status.className =
        'cloud-cycle-status';
    }

    return;
  }


  const remaining =
    currentRemaining(
      clock
    );


  const progress =
    Math.min(
      100,
      Math.max(
        0,
        numberValue(
          clock.progress,
          0
        )
      )
    );


  setText(
    root,
    '#cloud-cycle-countdown',
    formatCountdown(
      remaining
    )
  );


  setText(
    root,
    '#cloud-cycle-start',
    formatUtc(
      clock.epochStartAt
    )
  );


  setText(
    root,
    '#cloud-cycle-end',
    formatUtc(
      clock.epochEndAt
    )
  );


  setText(
    root,
    '#cloud-cycle-start-seq',
    Number(
      clock.epochStartSeq ||
      0
    ).toLocaleString(
      getUiLocale()
    )
  );


  setText(
    root,
    '#cloud-cycle-end-seq',
    Number(
      clock.epochEndSeq ||
      0
    ).toLocaleString(
      getUiLocale()
    )
  );


  setText(
    root,
    '#cloud-cycle-current-seq',
    Number(
      clock.currentSeqNo ||
      0
    ).toLocaleString(
      getUiLocale()
    )
  );


  setText(
    root,
    '#cloud-cycle-period',
    Number(
      clock.periodBlocks ||
      0
    ).toLocaleString(
      getUiLocale()
    )
  );


  const bps =
    numberValue(
      clock.blocksPerSecond,
      Number.NaN
    );


  setText(
    root,
    '#cloud-cycle-rate',
    Number.isFinite(
      bps
    )
      ? bps.toFixed(
          4
        )
      : '—'
  );


  setText(
    root,
    '#cloud-cycle-duration',
    formatCountdown(
      clock.fullCycleSeconds
    )
  );


  setText(
    root,
    '#cloud-cycle-progress-label',
    `${
      progress.toFixed(
        2
      )
    }%`
  );


  const bar =
    root.querySelector<HTMLElement>(
      '#cloud-cycle-progress-bar'
    );


  if (bar) {

    bar.style.width =
      `${
        progress.toFixed(
          2
        )
      }%`;
  }


  if (status) {

    if (
      clock.stale
    ) {

      status.textContent =
        'VERİ GECİKMELİ';

      status.className =
        'cloud-cycle-status stale';

    } else if (
      clock.rateSource ===
      'live'
    ) {

      status.textContent =
        'LIVE';

      status.className =
        'cloud-cycle-status live';

    } else {

      status.textContent =
        'SYNC';

      status.className =
        'cloud-cycle-status';
    }
  }
}


export function mountMiningObservability(
  root: HTMLElement,
  options: ObservabilityOptions,
): MiningObservabilityController {

  let destroyed =
    false;

  let refreshInFlight =
    false;

  let clockInfo:
    MiningCycleClock | null =
      null;


  const controller =
    new AbortController();


  /*
   * PHASE_7I_20260816
   *
   * Clear visible reward rows only.
   * The backend deliberately preserves the current
   * cycle total and epoch counter.
   */
  async function clearRewardFeed(
    button: HTMLButtonElement,
  ): Promise<void> {

    const confirmed =
      window.confirm(
        'Ödül listesi temizlensin mi?\n\n' +
        'Mevcut döngü NACKL toplamı ve epoch sayısı korunacaktır.'
      );


    if (!confirmed) {
      return;
    }


    button.disabled =
      true;

    button.classList.add(
      'busy'
    );


    try {

      const response =
        await fetch(
          '/api/dashboard/rewards/clear',
          {
            method:
              'POST',

            headers:
              authHeaders(),

            cache:
              'no-store',

            signal:
              controller.signal,
          }
        );


      if (
        response.status ===
        401
      ) {

        options.onUnauthorized();

        return;
      }


      if (!response.ok) {

        setText(
          root,
          '#cloud-reward-note',
          'Ödül listesi temizlenemedi.'
        );

        return;
      }


      const feed =
        root.querySelector<HTMLElement>(
          '#cloud-reward-feed'
        );


      if (feed) {

        feed.replaceChildren();


        const empty =
          document.createElement(
            'div'
          );


        empty.className =
          'cloud-observe-empty';


        empty.textContent =
          'Ödül listesi temizlendi. Döngü toplamı korunuyor.';


        feed.append(
          empty
        );
      }


      setText(
        root,
        '#cloud-reward-note',
        'Liste temizlendi · döngü toplamı korunuyor'
      );


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
        return;
      }


      setText(
        root,
        '#cloud-reward-note',
        'Ödül listesi temizlenemedi.'
      );


    } finally {

      if (
        button.isConnected
      ) {

        button.disabled =
          false;

        button.classList.remove(
          'busy'
        );
      }
    }
  }


  function observabilityClickHandler(
    event: MouseEvent,
  ): void {

    const target =
      event.target;


    if (
      !(target instanceof Element)
    ) {
      return;
    }


    const clearButton =
      target.closest<HTMLButtonElement>(
        '#cloud-reward-clear'
      );


    if (!clearButton) {
      return;
    }


    void clearRewardFeed(
      clearButton
    );
  }


  root.addEventListener(
    'click',
    observabilityClickHandler
  );


  function update(
    data:
      DashboardMeData,
  ): void {

    renderMiningHealth(
      root,
      data.miningHealth
    );

    renderRewards(
      root,
      data
    );

    renderClock(
      root,
      clockInfo
    );
  }


  async function refreshClock():
    Promise<void> {

    if (
      destroyed ||
      refreshInFlight ||
      !readSessionToken()
    ) {
      return;
    }


    refreshInFlight =
      true;


    try {

      const response =
        await fetch(
          '/api/dashboard/mining-cycle-clock',
          {
            headers:
              authHeaders(),

            cache:
              'no-store',

            signal:
              controller.signal,
          }
        );


      if (
        response.status ===
        401
      ) {

        options.onUnauthorized();

        return;
      }


      if (
        !response.ok
      ) {
        return;
      }


      const data = (await response.json()) as MiningCycleClockResponse;


      if (
        data.ok &&
        data.clock
      ) {

        clockInfo =
          data.clock;

        renderClock(
          root,
          clockInfo
        );
      }

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
        return;
      }


      /*
       * Keep the last valid clock sample alive.
       * A transient chain/provider error must not
       * blank the whole monitor.
       */
      renderClock(
        root,
        clockInfo
      );

    } finally {

      refreshInFlight =
        false;
    }
  }


  const tickTimer =
    window.setInterval(
      () => {

        if (
          destroyed
        ) {
          return;
        }

        renderClock(
          root,
          clockInfo
        );

      },
      1000
    );


  const pollTimer =
    window.setInterval(
      () => {

        void refreshClock();

      },
      15_000
    );


  /*
   * The controller may mount just before the
   * authenticated markup exists. Keep the sample;
   * update() will render it as soon as /dashboard/me
   * creates the view.
   */
  void refreshClock();


  return {

    update,

    refreshClock,

    cleanup:
      () => {

        destroyed =
          true;

        root.removeEventListener(
          'click',
          observabilityClickHandler
        );

        controller.abort();

        window.clearInterval(
          tickTimer
        );

        window.clearInterval(
          pollTimer
        );

        clockInfo =
          null;
      },
  };
}
