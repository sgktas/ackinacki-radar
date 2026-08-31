// The Arc page.
//
// Everything about the Arc rail lives here rather than being sprinkled across
// home, plans and cloud-miner. The reason is the faucet: someone who does not
// already hold test USDC cannot complete the flow at all, and a promo card on
// the plans page has nowhere to put "first, go get some". A page can hold the
// whole path — wallet, faucet, trial, proof — in the order a person needs it.
//
// The mark below is ours, not Arc's. Arc publishes Brand Guidelines and a
// Partner Toolkit that govern their logo, with approvals for some uses, so
// until we have that toolkit we use the name in text and a neutral glyph. That
// also keeps our product visually distinct from the network it runs on, which
// is what their guidelines ask for.

import '../styles/arc-page.css';

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

  svg.append(arc, dot);

  return svg;
}

function step(index: string, title: string, body: Node[]): HTMLElement {
  const box = el('div', 'arcp-step');

  const head = el('div', 'arcp-step-head');
  head.append(
    el('span', 'arcp-step-index', index),
    el('span', 'arcp-step-title', title),
  );

  box.append(head);

  const content = el('div', 'arcp-step-body');
  content.append(...body);
  box.append(content);

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

export function renderArc(): HTMLElement {
  const view = el('section', 'arcp-view');

  // --- hero ---------------------------------------------------------

  const hero = el('section', 'arcp-hero');

  const heroText = el('div', 'arcp-hero-text');
  heroText.append(
    el('span', 'arcp-kicker', 'ARC TESTNET'),
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

  hero.append(heroText, heroMark);
  view.append(hero);

  // --- the trial card, same component the plans page uses ------------

  view.append(renderArcTrialCard({ alwaysVisible: true }));

  // --- steps --------------------------------------------------------

  const steps = el('div', 'arcp-steps');

  steps.append(
    step('01', 'Cüzdanını hazırla', [
      el(
        'p',
        'arcp-text',
        'MetaMask yeterli. Arc Testnet ağını elle eklemene gerek yok — ödeme ' +
          'sayfası cüzdanına ağı kendisi tanıtıyor, sen onaylıyorsun.',
      ),
    ]),

    step('02', 'Ücretsiz test USDC al', [
      el(
        'p',
        'arcp-text',
        'Test ağı parası Circle’ın musluğundan ücretsiz alınır. Cüzdan adresini ' +
          'yapıştır, ağ olarak Arc Testnet ve token olarak USDC seç. 1 USDC yeter; ' +
          'işlem ücreti de aynı bakiyeden karşılanır.',
      ),
      link(FAUCET, 'CIRCLE FAUCET’İ AÇ', 'arcp-btn'),
    ]),

    step('03', 'Denemeyi başlat', [
      el(
        'p',
        'arcp-text',
        'Yukarıdaki karttan denemeyi başlat, çıkan ödeme sayfasında 1 test USDC ' +
          'gönder. Ödeme zincirde onaylandığı an aboneliğine 3 gün ekleniyor — ' +
          'ortalama yarım dakika sürüyor.',
      ),
    ]),
  );

  view.append(el('h2', 'arcp-section-title', 'Nasıl çalışır'), steps);

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
