// The Arc page.
//
// Everything about the Arc rail lives here rather than being sprinkled across
// home, plans and cloud-miner. The reason is the faucet: someone who does not
// already hold test USDC cannot complete the flow at all, and a promo card on
// the plans page has nowhere to put "first, go get some". A page can hold the
// whole path — wallet, faucet, trial, proof — in the order a person needs it.
//
// Section order is deliberately: hero -> how it works -> trial card -> facts.
// A first-time visitor should understand the three steps before being asked
// to click a button that starts one of them.
//
// The mark below is ours, not Arc's. Arc publishes Brand Guidelines and a
// Partner Toolkit that govern their logo, with approvals for some uses, so
// until we have that toolkit we use the name in text and a neutral glyph. That
// also keeps our product visually distinct from the network it runs on, which
// is what their guidelines ask for.
//
// The gold accent below is the site's own "premium" language — the same one
// the Cloud Miner console uses for its "PREMIUM CONSOLE" badge — reused here
// so the page reads as a genuine feature rather than a flat info panel.

import '../styles/arc-page.css';

import { authHeaders } from '../auth/session';
import { renderArcTrialCard } from './arc-trial';

const REGISTRY = '0xAa7704CFE6A114f70F185d9fd445aC432856a213';
const EXPLORER = 'https://testnet.arcscan.app';
const FAUCET = 'https://faucet.circle.com';

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

function link(href: string, text: string, className: string): HTMLAnchorElement {
  const a = el('a', className, text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}

// A neutral arc glyph: our own mark, deliberately not Arc's logo.
function glyph(): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');

  svg.setAttribute('viewBox', '0 0 40 40');
  svg.setAttribute('class', 'arcp-glyph');
  svg.setAttribute('aria-hidden', 'true');

  const ring = document.createElementNS(NS, 'circle');
  ring.setAttribute('cx', '20');
  ring.setAttribute('cy', '20');
  ring.setAttribute('r', '18.25');
  ring.setAttribute('fill', 'none');
  ring.setAttribute('class', 'arcp-glyph-ring');
  ring.setAttribute('stroke-width', '1');

  const arc = document.createElementNS(NS, 'path');
  arc.setAttribute('d', 'M5 30 A 17 17 0 0 1 35 30');
  arc.setAttribute('fill', 'none');
  arc.setAttribute('stroke', 'currentColor');
  arc.setAttribute('stroke-width', '2.5');
  arc.setAttribute('stroke-linecap', 'round');

  const dot = document.createElementNS(NS, 'circle');
  dot.setAttribute('cx', '20');
  dot.setAttribute('cy', '30');
  dot.setAttribute('r', '2.6');
  dot.setAttribute('fill', 'currentColor');

  svg.append(ring, arc, dot);

  return svg;
}

function badge(text: string): HTMLElement {
  const b = el('div', 'arcp-badge');
  b.append(el('i', 'arcp-badge-dot'), el('span', undefined, text));
  return b;
}

// A small icon per step, sharing the pay page's stroke-icon style, so the
// steps read as a flow rather than three interchangeable numbered blocks.
function stepIcon(kind: 'wallet' | 'faucet' | 'bolt'): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'arcp-step-icon');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');

  const path = (d: string) => {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  };
  const circle = (cx: string, cy: string, r: string, fill = false) => {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', cx);
    c.setAttribute('cy', cy);
    c.setAttribute('r', r);
    if (fill) {
      c.setAttribute('fill', 'currentColor');
      c.setAttribute('stroke', 'none');
    }
    svg.append(c);
  };

  if (kind === 'wallet') {
    path('M2.5 6.5h15a2 2 0 0 1 2 2v.5');
    path('M2.5 6.5v11a2 2 0 0 0 2 2h15.5a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2H9');
    circle('16.7', '14', '1.1', true);
  } else if (kind === 'faucet') {
    path('M4 4v9a5 5 0 0 0 5 5');
    path('M4 4h6');
    path('M14 8h4a2 2 0 0 1 2 2v1');
    path('M9 18c0 1.5 1.5 2.5 3 2.5s3-1 3-2.5c0-1.8-3-4.8-3-4.8s-3 3-3 4.8Z');
  } else {
    path('M12.5 2 4 14h6.5L11 22l8.5-13H13l-.5-7Z');
  }

  return svg;
}

function step(
  index: string,
  icon: 'wallet' | 'faucet' | 'bolt',
  title: string,
  body: Node[],
): HTMLElement {
  const box = el('div', 'arcp-step');

  const marker = el('div', 'arcp-step-marker');
  marker.append(stepIcon(icon), el('span', 'arcp-step-num', index));

  const content = el('div', 'arcp-step-content');
  content.append(el('h3', 'arcp-step-title', title));

  const inner = el('div', 'arcp-step-body');
  inner.append(...body);
  content.append(inner);

  box.append(marker, content);

  return box;
}

function factRow(key: string, value: Node | string): HTMLElement {
  const row = el('div', 'arcp-fact');
  row.append(el('span', 'arcp-fact-key', key));

  if (typeof value === 'string') {
    row.append(el('span', 'arcp-fact-value', value));
  } else {
    const wrap = el('span', 'arcp-fact-value');
    wrap.append(value);
    row.append(wrap);
  }

  return row;
}

// Real uptake, not a fabricated number: how many accounts have actually taken
// the trial, out of the quota. Renders nothing until the fetch resolves, and
// nothing at all if the rail is off — an empty stat line reads worse than none.
function renderStat(): HTMLElement {
  const box = el('div', 'arcp-stat');
  box.hidden = true;

  fetch('/api/dashboard/arc/trial', { headers: authHeaders() })
    .then((r) => r.json())
    .then((status: { ok?: boolean; enabled?: boolean; taken?: number; quota?: number }) => {
      if (!status?.ok || !status.enabled || !status.quota) return;

      box.replaceChildren();
      const bar = el('div', 'arcp-stat-bar');
      const fill = el('i');
      fill.style.width = `${Math.min(100, ((status.taken ?? 0) / status.quota) * 100)}%`;
      bar.append(fill);

      box.append(
        el('span', 'arcp-stat-text', `${status.taken ?? 0} / ${status.quota} kullanıcı Arc denemesini aldı`),
        bar,
      );
      box.hidden = false;
    })
    .catch(() => {
      // A stat that failed to load is not worth showing a gap for.
    });

  return box;
}

export function renderArc(): HTMLElement {
  const view = el('section', 'arcp-view');

  // --- hero ---------------------------------------------------------

  const hero = el('section', 'arcp-hero');
  hero.append(el('i', 'arcp-hero-corner tl'), el('i', 'arcp-hero-corner tr'));

  const heroInner = el('div', 'arcp-hero-inner');

  const heroText = el('div', 'arcp-hero-text');
  heroText.append(
    badge('ARC TESTNET · SINIRLI TEKLİF'),
    el('h1', 'arcp-title', 'Arc üzerinde USDC ile öde, 3 gün hediye al'),
    el(
      'p',
      'arcp-lead',
      'Arc, Circle’ın stablecoin için tasarladığı yeni bir blokzincir — gaz ücreti bile ' +
        'USDC ile ödeniyor. Cloud Miner aboneliğini Arc test ağı üzerinden denedik ve ' +
        'akışı sana açtık: birkaç dakikada tamamlanıyor, sana hiçbir maliyeti yok.',
    ),
  );

  const heroMark = el('div', 'arcp-hero-mark');
  heroMark.append(glyph());

  heroInner.append(heroText, heroMark);
  hero.append(heroInner);
  view.append(hero);

  // --- steps, before the card: explain the three steps before asking for one

  const steps = el('div', 'arcp-steps');

  steps.append(
    step('01', 'wallet', 'Cüzdanını hazırla', [
      el(
        'p',
        'arcp-text',
        'MetaMask yeterli. Arc Testnet ağını elle eklemene gerek yok — ödeme ' +
          'sayfası cüzdanına ağı kendisi tanıtıyor, sen onaylıyorsun.',
      ),
    ]),

    step('02', 'faucet', 'Ücretsiz test USDC al', [
      el(
        'p',
        'arcp-text',
        'Test ağı parası Circle’ın musluğundan ücretsiz alınır. Şu an sadece ' +
          'MetaMask’ı destekliyoruz — musluğa da MetaMask cüzdanını bağla ya da ' +
          'MetaMask adresini yapıştır, ağ olarak Arc Testnet ve token olarak USDC ' +
          'seç. 1 USDC yeter; işlem ücreti de aynı bakiyeden karşılanır.',
      ),
      link(FAUCET, 'CIRCLE FAUCET’İ AÇ', 'arcp-btn'),
    ]),

    step('03', 'bolt', 'Denemeyi başlat', [
      el(
        'p',
        'arcp-text',
        'Aşağıdaki karttan denemeyi başlat, çıkan ödeme sayfasında 1 test USDC ' +
          'gönder. Ödeme zincirde onaylandığı an aboneliğine 3 gün ekleniyor — ' +
          'ortalama yarım dakika sürüyor.',
      ),
    ]),
  );

  view.append(el('h2', 'arcp-section-title', 'Nasıl çalışır'), steps, renderStat());

  // --- the trial card, same component the plans page uses ------------

  view.append(renderArcTrialCard({ alwaysVisible: true }));

  // --- facts ---------------------------------------------------------

  const facts = el('div', 'arcp-facts');

  facts.append(
    factRow('Ağ', 'Arc Testnet · chain id 5042002'),
    factRow('Gaz token’ı', 'USDC'),
    factRow(
      'Ödeme kontratı',
      link(`${EXPLORER}/address/${REGISTRY}`, `${REGISTRY.slice(0, 10)}…${REGISTRY.slice(-8)}`, 'arcp-link mono'),
    ),
    factRow(
      'Kaynak kod',
      link('https://github.com/sgktas/arcpay', 'github.com/sgktas/arcpay', 'arcp-link'),
    ),
  );

  view.append(el('h2', 'arcp-section-title', 'Teknik detay'), facts);

  view.append(
    el(
      'p',
      'arcp-disclaimer',
      'Bu bir test ağı denemesidir, satın alma değil. Kullanılan USDC gerçek para ' +
        'değildir ve herhangi bir bedeli yoktur. Acki Nacki Radar bağımsız bir ' +
        'projedir; Circle veya Arc ekibiyle bir ortaklığı ya da onayı yoktur.',
    ),
  );

  return view;
}
