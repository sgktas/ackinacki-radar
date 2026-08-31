// Arc testnet trial promo.
//
// Deliberately its own card above the plans rather than a fourth payment
// option inside them. It is paid for with faucet USDC that costs the payer
// nothing, so sitting it beside the 5/10/25 USD plans would read as "the cheap
// tier" — which it is not. It is a promo, with its own ledger and quota, and
// it says so.
//
// Renders nothing at all when the rail is off or the quota is full, so the
// page is unchanged for everyone when we are not running the promo.

import '../styles/arc-trial.css';

import { authHeaders } from '../auth/session';

import { getUiLocale } from '../i18n/runtime';

type ArcTrialInvoice = {
  code: string | null;
  amountRaw: string;
  expiresAt: string;
  payUrl: string;
};

type ArcTrialStatus = {
  ok?: boolean;
  enabled?: boolean;
  used?: boolean;
  quotaReached?: boolean;
  days?: number;
  priceUsd?: number;
  taken?: number;
  quota?: number;
  subscription?: {
    planId?: string;
    activeUntil?: string;
    active?: boolean;
  } | null;
  grantedAt?: string | null;
  grantedUntil?: string | null;
  invoice?: ArcTrialInvoice | null;
  error?: string;
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  if (className) {
    node.className = className;
  }

  if (text !== undefined) {
    node.textContent = text;
  }

  return node;
}

// 18-decimal native units. The USDC ERC-20 view on Arc uses 6 decimals; this
// promo never touches that one, so there is exactly one convention here.
function formatUsdc(raw: string): string {
  let s = String(raw || '0');

  if (s.length <= 18) {
    s = '0'.repeat(19 - s.length) + s;
  }

  const whole = s.slice(0, s.length - 18);
  const frac = s.slice(s.length - 18).slice(0, 2);

  return `${whole}.${frac}`;
}

function minutesLeft(expiresAt: string): number {
  return Math.max(
    0,
    Math.round((new Date(expiresAt).getTime() - Date.now()) / 60000),
  );
}

function friendlyError(code: string | undefined): string {
  switch (code) {
    case 'ARC_NOT_LIVE':
      return 'Arc denemesi şu anda kapalı.';

    case 'ARC_TRIAL_ALREADY_USED':
      return 'Arc denemeni zaten kullandın.';

    case 'ARC_TRIAL_QUOTA_REACHED':
      return 'Kontenjan doldu.';

    case 'UNAUTHORIZED':
      return 'Oturumun düşmüş görünüyor, sayfayı yenile.';

    default:
      return 'Bir şeyler ters gitti, tekrar dene.';
  }
}

// Head row shared by both states: kicker and chip on the left, the thing the
// user actually gets on the right. Mirrors the .plans-kicker / .plans-sub-status
// pairing the rest of the page uses.
function head(chip: string, aside: string): HTMLElement {
  const row = el('div', 'arc-head');

  const left = el('div', 'arc-head-left');
  left.append(
    el('span', 'arc-kicker', 'ARC TESTNET'),
    el('span', 'arc-chip', chip),
  );

  row.append(left, el('span', 'arc-aside', aside));

  return row;
}

function button(label: string, tag: 'button' | 'a'): HTMLElement {
  const node = el(tag, 'arc-btn', label);

  if (tag === 'button') {
    (node as HTMLButtonElement).type = 'button';
  }

  return node;
}

function renderInvoice(
  box: HTMLElement,
  invoice: ArcTrialInvoice,
  days: number,
): void {
  box.replaceChildren();

  box.append(
    head('ÖDEME BEKLENİYOR', `+${days} GÜN`),
    el('h3', 'arc-title', 'Ödemeni bekliyoruz'),
  );

  const rows = el('div', 'arc-rows');

  const add = (key: string, value: string, mono = false) => {
    const row = el('div', 'arc-row');
    row.append(
      el('span', 'arc-key', key),
      el('span', `arc-value${mono ? ' mono' : ''}`, value),
    );
    rows.append(row);
  };

  add('Tutar', `${formatUsdc(invoice.amountRaw)} test USDC`);
  add('Kod', invoice.code ?? '—', true);
  add('Süre', `${minutesLeft(invoice.expiresAt)} dakika`);

  box.append(rows);

  const link = button('ÖDEME SAYFASINI AÇ', 'a') as HTMLAnchorElement;
  link.href = invoice.payUrl;
  link.target = '_blank';
  link.rel = 'noopener';

  box.append(
    link,
    el(
      'p',
      'arc-note',
      'Ödeme zincirde onaylandığı an aboneliğin açılır. Bu sayfayı kapatabilirsin.',
    ),
  );
}

function renderOffer(
  box: HTMLElement,
  status: ArcTrialStatus,
  onStart: () => void,
): void {
  box.replaceChildren();

  const days = status.days ?? 3;
  const price = status.priceUsd ?? 1;

  box.append(
    head('ÜCRETSİZ', `+${days} GÜN`),
    el('h3', 'arc-title', 'Arc’ı dene, hediye kazan'),
    el(
      'p',
      'arc-lead',
      `Circle’ın yeni zinciri Arc üzerinde ${price} test USDC’lik bir ödeme yap, ` +
        `Cloud Miner aboneliğine ${days} gün eklensin.`,
    ),
  );

  const btn = button('DENEMEYİ BAŞLAT', 'button');
  btn.addEventListener('click', onStart);

  box.append(
    btn,
    el(
      'p',
      'arc-note',
      'Test ağı denemesidir, satın alma değil. Kullanacağın USDC Circle faucet’inden ücretsiz alınır ve gerçek para değildir.',
    ),
  );
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return date.toLocaleString(getUiLocale(), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function daysLeft(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const ms = new Date(value).getTime() - Date.now();

  return Number.isNaN(ms) ? null : Math.max(0, Math.ceil(ms / 86400000));
}

// Once the trial has been taken, the card stops being an offer and becomes a
// receipt: what was granted, when, and how long is left. Saying only "you used
// it" wastes the one place the user comes to check.
function renderGranted(box: HTMLElement, status: ArcTrialStatus): void {
  box.replaceChildren();

  const days = status.days ?? 3;
  const until = status.grantedUntil ?? status.subscription?.activeUntil ?? null;
  const left = daysLeft(status.subscription?.activeUntil ?? until);

  box.append(
    head('KULLANILDI', `+${days} GÜN`),
    el('h3', 'arc-title', 'Arc hediyesi hesabına tanımlandı'),
  );

  const rows = el('div', 'arc-rows');

  const add = (key: string, value: string, tone?: string) => {
    const row = el('div', 'arc-row');
    row.append(
      el('span', 'arc-key', key),
      el('span', `arc-value${tone ? ` ${tone}` : ''}`, value),
    );
    rows.append(row);
  };

  add('Kazanılan', `${days} gün`, 'good');
  add('Tanımlandı', formatDate(status.grantedAt));
  add('Abonelik bitişi', formatDate(status.subscription?.activeUntil ?? until));

  if (left !== null) {
    add('Kalan', `${left} gün`, 'good');
  }

  box.append(
    rows,
    el(
      'p',
      'arc-note',
      'Bu hesap Arc denemesini kullandı. Deneme hesap başına bir kezdir; ' +
        'aboneliğini uzatmak için Planlar sayfasını kullanabilirsin.',
    ),
  );
}

// Closed for a reason other than "you already took it".
function renderClosed(box: HTMLElement, status: ArcTrialStatus): void {
  box.replaceChildren();

  box.append(
    head('KAPALI', '—'),
    el('h3', 'arc-title', 'Arc denemesi'),
    el(
      'p',
      'arc-lead',
      status.quotaReached
        ? 'Kontenjan doldu. Yeni kontenjan açtığımızda burada duyuracağız.'
        : 'Deneme şu anda kapalı.',
    ),
  );
}

export function renderArcTrialCard(
  options: { alwaysVisible?: boolean } = {},
): HTMLElement {
  const box = el('section', 'arc-trial');

  // Hidden until we know there is something to show, so the page never flashes
  // an empty promo slot.
  box.hidden = true;

  const fail = (message: string) => {
    const note = box.querySelector<HTMLElement>('.arc-error');

    if (note) {
      note.textContent = message;
      return;
    }

    box.append(el('p', 'arc-error', message));
  };

  const start = () => {
    const btn = box.querySelector<HTMLButtonElement>('button.arc-btn');

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'HAZIRLANIYOR…';
    }

    fetch('/api/dashboard/arc/trial', {
      method: 'POST',
      headers: authHeaders(),
    })
      .then((response) => response.json())
      .then((data: ArcTrialStatus & ArcTrialInvoice & { payUrl?: string }) => {
        if (!data?.ok || !data?.payUrl) {
          fail(friendlyError(data?.error));

          if (btn) {
            btn.disabled = false;
            btn.textContent = 'TEKRAR DENE';
          }

          return;
        }

        renderInvoice(
          box,
          {
            code: data.code ?? null,
            amountRaw: data.amountRaw,
            expiresAt: data.expiresAt,
            payUrl: data.payUrl,
          },
          data.days ?? 3,
        );
      })
      .catch(() => {
        fail('Sunucuya ulaşılamadı.');

        if (btn) {
          btn.disabled = false;
          btn.textContent = 'TEKRAR DENE';
        }
      });
  };

  fetch('/api/dashboard/arc/trial', { headers: authHeaders() })
    .then((response) => response.json())
    .then((status: ArcTrialStatus) => {
      if (!status?.ok) {
        return;
      }

      // Nothing to offer. On the plans page stay invisible rather than
      // explaining an absence; on the Arc page say where things stand.
      if (!status.enabled || status.used || status.quotaReached) {
        if (!options.alwaysVisible) {
          return;
        }

        if (status.used) {
          renderGranted(box, status);
        } else {
          renderClosed(box, status);
        }

        box.hidden = false;
        return;
      }

      if (status.invoice) {
        renderInvoice(box, status.invoice, status.days ?? 3);
      } else {
        renderOffer(box, status, start);
      }

      box.hidden = false;
    })
    .catch(() => {
      // A promo that cannot load is not worth an error message on a page the
      // user came to for something else.
    });

  return box;
}
