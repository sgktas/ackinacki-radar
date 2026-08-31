import { getUiLanguage, getUiLocale } from '../i18n/runtime';

import { navigate } from '../router';

type RadarChain = {
  latestBlock?: number;
  tps?: number;
  blocksPerSecond?: number;
  avgBlockTimeSeconds?: number;
  updatedAt?: string;
};

type RadarMining = {
  wallets?: number;
  nacklLast24hRaw?: string;
  nacklTotalRaw?: string;
  eventsTracked?: number;
};

type TpsHistory = {
  h24?: {
    avg?: number;
    peak?: number;
    min?: number;
  };

  series?: number[];
};

type RadarStats = {
  ok?: boolean;
  chain?: RadarChain | null;
  chainStale?: boolean;
  chainAgeSeconds?: number | null;
  mining?: RadarMining | null;
  tpsHistory?: TpsHistory | null;
};

const NACKL_DECIMALS = 9;

function metricIcon(kind: string): string {
  const icons: Record<string, string> = {
    speed: `
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <path d="M9 34a17 17 0 1 1 30 0"/>
        <path d="m24 27 9-9"/>
        <circle cx="24" cy="27" r="2"/>
        <path d="M12 31h3M33 31h3M15 20l3 2M30 22l3-2M24 13v4"/>
      </svg>
    `,

    block: `
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <path d="m24 8 14 8v16l-14 8-14-8V16z"/>
        <path d="m10 16 14 8 14-8M24 24v16M17 12l14 8"/>
      </svg>
    `,

    time: `
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r="16"/>
        <path d="M24 13v12l8 5"/>
        <path d="M24 7v4M24 37v4M7 24h4M37 24h4"/>
      </svg>
    `,

    wallet: `
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <path d="M9 14h27a4 4 0 0 1 4 4v18H12a5 5 0 0 1-5-5V13a5 5 0 0 1 5-5h22"/>
        <path d="M32 22h10v9H32a4.5 4.5 0 0 1 0-9Z"/>
        <circle cx="34" cy="26.5" r="1"/>
      </svg>
    `,

    coins: `
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <ellipse cx="18" cy="13" rx="9" ry="4"/>
        <path d="M9 13v7c0 2 4 4 9 4s9-2 9-4v-7"/>
        <path d="M9 20v7c0 2 4 4 9 4 2 0 4-.3 5.5-1"/>
        <path d="M27 23c1.3-1 3.5-1.6 6-1.6 5 0 9 2 9 4s-4 4-9 4-9-2-9-4"/>
        <path d="M24 25v7c0 2 4 4 9 4s9-2 9-4v-7"/>
      </svg>
    `,
  };

  return icons[kind] || '';
}


/*
 * PHASE_7J_SLOGAN_20260816
 * Main brand slogan.
 */
function homeRadarSlogan(): string {

  const language =
    getUiLanguage();

  if (language === 'en') {
    return (
      'Track the Acki Nacki network, mining flow, ' +
      'and live chain data from one place.'
    );
  }

  if (language === 'ru') {
    return (
      'Отслеживайте сеть Acki Nacki, майнинг и данные ' +
      'блокчейна в реальном времени в одном месте.'
    );
  }

  return (
    'Acki Nacki ağını, madencilik akışını ve canlı ' +
    'zincir verilerini tek merkezden takip edin.'
  );
}


export function homeView(): HTMLElement {
  const section =
    document.createElement('section');

  section.className =
    'home-command-view';

  section.innerHTML = `
    <div class="home-command-grid">

      <aside
        class="home-metric-rail"
        aria-label="Acki Nacki mainnet metrikleri"
      >
        <div class="rail-heading">
          <i></i>
          ACKI NACKI MAINNET
        </div>

        <article class="home-metric">
          <div class="metric-symbol">
            ${metricIcon('speed')}
          </div>

          <div>
            <span>TPS</span>
            <b id="home-tps">—</b>
            <small>İŞLEM / SANİYE</small>
          </div>
        </article>

        <article class="home-metric">
          <div class="metric-symbol">
            ${metricIcon('block')}
          </div>

          <div>
            <span>BLOK</span>
            <b id="home-block">—</b>
            <small>SON BLOK</small>
          </div>
        </article>

        <article class="home-metric">
          <div class="metric-symbol">
            ${metricIcon('time')}
          </div>

          <div>
            <span>BLOK SÜRESİ</span>
            <b id="home-block-time">—</b>
            <small>AĞ HIZI</small>
          </div>
        </article>
      </aside>


      <section class="home-radar-stage">
        <div class="radar-stage-head">

          <!-- PHASE_7J_RADAR_HEADER_SLOGAN_V2_20260816 -->
          <div class="radar-stage-message">

            <span class="radar-stage-slogan">
              ${homeRadarSlogan()}
            </span>

          </div>

        </div>

        <div
          class="network-observatory"
          id="home-radar"
          aria-hidden="true"
        >
          <canvas
            id="home-network-canvas"
          ></canvas>

          <div class="radar-hud-ring ring-a"></div>
          <div class="radar-hud-ring ring-b"></div>
          <div class="radar-hud-ring ring-c"></div>

          <div class="radar-scan-sweep"></div>

          <div class="radar-center-logo">
            <img
              src="/logo.png"
              alt=""
            />
          </div>
        </div>

        <span class="radar-coordinate left">
          SCAN / <b>360°</b><br>
          ROTATION / <b>20S</b>
        </span>

        <span class="radar-coordinate right">
          NETWORK / <b>MAINNET</b><br>
          MODE / <b>LIVE</b>
        </span>
      </section>


      <aside
        class="home-metric-rail"
        aria-label="Radar tarama metrikleri"
      >
        <div class="rail-heading">
          <i></i>
          RADAR · 7/24 TARAMA
        </div>

        <article class="home-metric">
          <div class="metric-symbol">
            ${metricIcon('wallet')}
          </div>

          <div>
            <span>İZLENEN CÜZDAN</span>
            <b id="home-wallets">—</b>
            <small>CANLI TAKİP</small>
          </div>
        </article>

        <article class="home-metric">
          <div class="metric-symbol text-symbol">
            24S
          </div>

          <div>
            <span>NACKL · 24S</span>
            <b id="home-nackl">—</b>
            <small>NACKL</small>
          </div>
        </article>

        <article class="home-metric">
          <div class="metric-symbol">
            ${metricIcon('coins')}
          </div>

          <div>
            <span>NACKL · TOPLAM</span>
            <b id="home-nackl-total">—</b>
            <small>TOPLAM AKIŞ</small>
          </div>
        </article>
      </aside>

    </div>


    <div class="home-lower-grid">

      <section class="home-spark-card">
        <div class="spark-head">
          <span>
            TPS · SON 24 SAAT
          </span>

          <div
            class="spark-summary"
            id="home-spark-summary"
          ></div>
        </div>

        <div
          class="spark-chart"
          id="home-spark-chart"
        >
          <div class="spark-waiting">
            VERİ BEKLENİYOR
          </div>
        </div>
      </section>

      <!-- PHASE_7J_STEP1_20260816 MINING CONSOLE REMOVED -->

    </div>


    <section
      class="home-activity"
      aria-label="Canlı sistem durumu"
    >
      <div class="activity-live">
        <i></i>
        <span>CANLI AKTİVİTE</span>
      </div>

      <div class="activity-cell">
        <span>YENİ BLOK</span>
        <b id="activity-block">—</b>
        <small>LIVE / CHAIN</small>
      </div>

      <div class="activity-cell">
        <span>TPS</span>
        <b id="activity-tps">—</b>
        <small>LIVE / TPS</small>
      </div>

      <div class="activity-cell">
        <span>NACKL · 24S</span>
        <b id="activity-nackl">—</b>
        <small>24H / FLOW</small>
      </div>

      <div class="activity-cell">
        <span>İZLENEN CÜZDAN</span>
        <b id="activity-wallets">—</b>
        <small>RADAR / TRACKED</small>
      </div>

      <div class="activity-cell">
        <span>BLOK SÜRESİ</span>
        <b id="activity-block-time">—</b>
        <small>CHAIN / LATENCY</small>
      </div>

      <div class="activity-cell">
        <span>RADAR TARAMASI</span>
        <b>7 / 24 AKTİF</b>
        <small>NOMİNAL</small>
      </div>
    </section>

  `;

  return section;
}


function getElement(
  root: HTMLElement,
  id: string,
): HTMLElement | null {
  return root.querySelector<HTMLElement>(
    `#${id}`
  );
}


function compactNumber(value: number): string {
  const abs =
    Math.abs(value);

  if (abs >= 1e9) {
    return (
      value / 1e9
    ).toLocaleString(
      getUiLocale(),
      {
        maximumFractionDigits: 1,
      }
    ) + 'B';
  }

  if (abs >= 1e6) {
    return (
      value / 1e6
    ).toLocaleString(
      getUiLocale(),
      {
        maximumFractionDigits: 1,
      }
    ) + 'M';
  }

  if (abs >= 1e4) {
    return Math.round(
      value / 1e3
    ).toLocaleString(
      getUiLocale()
    ) + 'K';
  }

  return Math.round(
    value
  ).toLocaleString(
    getUiLocale()
  );
}


function rawToNackl(
  raw: string | undefined,
): number {
  if (!raw) {
    return 0;
  }

  try {
    const scale =
      10n ** BigInt(
        NACKL_DECIMALS
      );

    return Number(
      BigInt(raw) / scale
    );
  } catch {
    return 0;
  }
}


function renderSparkline(
  root: HTMLElement,
  history: TpsHistory | null | undefined,
): void {

  const chart =
    getElement(
      root,
      'home-spark-chart'
    );

  const summary =
    getElement(
      root,
      'home-spark-summary'
    );


  if (!chart || !summary) {
    return;
  }


  const rawSeries =
    history?.series;


  const series =
    Array.isArray(rawSeries)
      ? rawSeries
          .map(
            value =>
              Number(value)
          )
          .filter(
            value =>
              Number.isFinite(value)
          )
      : [];


  if (series.length < 2) {

    chart.innerHTML =
      '<div class="spark-waiting">VERİ BEKLENİYOR</div>';

    summary.innerHTML =
      '';

    return;
  }


  /*
   * PHASE_7J_STEP2_20260816
   *
   * Every hourly TPS sample gets a visible point.
   * Time labels are shown at readable intervals.
   */


  const maximum =
    Math.max(...series);

  const minimumValue =
    Math.min(...series);

  const valueSpan =
    maximum -
    minimumValue ||
    1;


  const averageFallback =
    series.reduce(
      (sum, value) =>
        sum + value,
      0
    ) /
    series.length;


  const average =
    Number.isFinite(
      Number(
        history?.h24?.avg
      )
    )
      ? Number(
          history?.h24?.avg
        )
      : averageFallback;


  const peak =
    Number.isFinite(
      Number(
        history?.h24?.peak
      )
    )
      ? Number(
          history?.h24?.peak
        )
      : maximum;


  const minimum =
    Number.isFinite(
      Number(
        history?.h24?.min
      )
    )
      ? Number(
          history?.h24?.min
        )
      : minimumValue;


  summary.innerHTML = `
    <span>
      ORT
      <b>${Math.round(average)}</b>
    </span>

    <span>
      ZİRVE
      <b>${Math.round(peak)}</b>
    </span>

    <span>
      MİN
      <b>${Math.round(minimum)}</b>
    </span>
  `;


  const width =
    1200;

  const height =
    280;

  const left =
    26;

  const right =
    1174;

  const top =
    24;

  const bottom =
    215;

  const labelY =
    258;


  const xStep =
    (
      right -
      left
    ) /
    (
      series.length -
      1
    );


  const points =
    series.map(
      (
        value,
        index
      ) => {

        const x =
          left +
          index *
          xStep;


        const y =
          bottom -
          (
            (
              value -
              minimumValue
            ) /
            valueSpan
          ) *
          (
            bottom -
            top
          );


        return {
          x,
          y,
          value,
          index,
        };
      }
    );


  const polyline =
    points
      .map(
        point =>
          `${point.x.toFixed(2)},${point.y.toFixed(2)}`
      )
      .join(' ');


  const area =
    [
      `${left},${bottom}`,
      polyline,
      `${right},${bottom}`,
    ].join(' ');


  /*
   * Align timestamps to exact clock hours.
   *
   * Example:
   * 02:00 / 06:00 / 10:00 / 14:00 ...
   */
  const currentHour =
    new Date();

  currentHour.setMinutes(
    0,
    0,
    0
  );


  function hourLabel(
    index: number,
  ): string {

    const hoursAgo =
      (
        series.length -
        1
      ) -
      index;


    const sampleTime =
      new Date(
        currentHour.getTime() -
        hoursAgo *
        60 *
        60 *
        1000
      );


    return sampleTime
      .toLocaleTimeString(
        getUiLocale(),
        {
          hour:
            '2-digit',

          minute:
            '2-digit',
        }
      );
  }


  /*
   * Roughly six time labels on desktop.
   * Every sample still gets a cyan point.
   */
  const labelStride =
    Math.max(
      1,
      Math.round(
        series.length /
        6
      )
    );


  const labelIndexes =
    new Set<number>();


  for (
    let index = 0;
    index < series.length;
    index += labelStride
  ) {
    labelIndexes.add(
      index
    );
  }


  labelIndexes.add(
    series.length -
    1
  );


  const guides =
    points
      .map(
        (
          point,
          index
        ) => {

          if (
            !labelIndexes.has(
              index
            )
          ) {
            return '';
          }


          return `
            <line
              class="spark-hour-grid"
              x1="${point.x.toFixed(2)}"
              y1="${top}"
              x2="${point.x.toFixed(2)}"
              y2="${bottom}"
            ></line>
          `;
        }
      )
      .join('');


  /*
   * PHASE_7J_HOVER_V2_20260816
   *
   * TPS nodes are invisible by default.
   * Hovering near a sample reveals its marker
   * and exact hour / TPS value.
   */

  const dots =
    points
      .map(
        point => {

          const tooltipWidth =
            138;

          const tooltipHeight =
            42;

          const tooltipX =
            point.x < 100
              ? point.x + 14
              : (
                  point.x >
                  width - 100
                    ? point.x -
                      tooltipWidth -
                      14
                    : point.x -
                      tooltipWidth /
                      2
                );

          const tooltipY =
            Math.max(
              6,
              point.y - 58
            );

          const time =
            hourLabel(
              point.index
            );

          return `
            <g
              class="spark-hour-node"
              tabindex="0"
              aria-label="${time} TPS ${Math.round(point.value)}"
            >

              <circle
                class="spark-hour-hit"
                cx="${point.x.toFixed(2)}"
                cy="${point.y.toFixed(2)}"
                r="17"
              ></circle>

              <circle
                class="spark-hour-point"
                cx="${point.x.toFixed(2)}"
                cy="${point.y.toFixed(2)}"
                r="5"
              ></circle>

              <g
                class="spark-hour-tooltip"
                pointer-events="none"
              >

                <rect
                  x="${tooltipX.toFixed(2)}"
                  y="${tooltipY.toFixed(2)}"
                  width="${tooltipWidth}"
                  height="${tooltipHeight}"
                  rx="6"
                ></rect>

                <text
                  class="spark-tooltip-time"
                  x="${(tooltipX + 11).toFixed(2)}"
                  y="${(tooltipY + 17).toFixed(2)}"
                >
                  ${time}
                </text>

                <text
                  class="spark-tooltip-value"
                  x="${(tooltipX + 11).toFixed(2)}"
                  y="${(tooltipY + 33).toFixed(2)}"
                >
                  TPS ${Math.round(point.value)}
                </text>

              </g>

            </g>
          `;
        }
      )
      .join('');


  const labels =
    points
      .map(
        (
          point,
          index
        ) => {

          if (
            !labelIndexes.has(
              index
            )
          ) {
            return '';
          }


          const anchor =
            index === 0
              ? 'start'
              : (
                  index ===
                    series.length - 1
                    ? 'end'
                    : 'middle'
                );


          return `
            <text
              class="spark-hour-label"
              x="${point.x.toFixed(2)}"
              y="${labelY}"
              text-anchor="${anchor}"
            >
              ${hourLabel(index)}
            </text>
          `;
        }
      )
      .join('');


  chart.innerHTML = `

    <svg
      viewBox="0 0 ${width} ${height}"
      role="img"
      aria-label="Son 24 saat TPS grafiği"
    >

      <defs>

        <linearGradient
          id="v2SparkFill"
          x1="0"
          y1="0"
          x2="0"
          y2="1"
        >

          <stop
            offset="0%"
            stop-color="#00e5ff"
            stop-opacity=".30"
          ></stop>

          <stop
            offset="100%"
            stop-color="#00e5ff"
            stop-opacity=".015"
          ></stop>

        </linearGradient>

      </defs>


      <g>
        ${guides}
      </g>


      <polygon
        class="spark-hour-area"
        points="${area}"
        fill="url(#v2SparkFill)"
      ></polygon>


      <polyline
        class="spark-hour-line"
        points="${polyline}"
        fill="none"
        stroke="#00e5ff"
        stroke-width="2.3"
        vector-effect="non-scaling-stroke"
      ></polyline>


      <g>
        ${dots}
      </g>


      <g>
        ${labels}
      </g>

    </svg>

  `;
}


function renderStats(
  root: HTMLElement,
  data: RadarStats,
): void {

  const set =
    (
      id: string,
      value: string,
    ) => {
      const element =
        getElement(
          root,
          id
        );

      if (element) {
        element.textContent =
          value;
      }
    };

  const chain =
    data.chain;

  const mining =
    data.mining;

  if (chain) {

    if (
      typeof chain.tps ===
      'number'
    ) {
      const value =
        chain.tps.toLocaleString(
          getUiLocale(),
          {
            maximumFractionDigits: 1,
          }
        );

      set('home-tps', value);
      set('activity-tps', value);
    }

    if (
      typeof chain.latestBlock ===
      'number'
    ) {
      const compact =
        compactNumber(
          chain.latestBlock
        );

      set(
        'home-block',
        compact
      );

      set(
        'activity-block',
        chain.latestBlock.toLocaleString(
          getUiLocale()
        )
      );
    }

    if (
      typeof chain.avgBlockTimeSeconds ===
      'number'
    ) {
      /*
       * PHASE_7E_HOME_LIVE_LOCALE_20260816
       */
      const language =
        getUiLanguage();

      const secondsUnit =
        language === 'en'
          ? 's'
          : (
              language === 'ru'
                ? 'с'
                : 'sn'
            );

      const value =
        chain.avgBlockTimeSeconds
          .toLocaleString(
            getUiLocale(),
            {
              maximumFractionDigits: 2,
            }
          ) + ` ${secondsUnit}`;

      set(
        'home-block-time',
        value
      );

      set(
        'activity-block-time',
        value
      );
    }
  }

  if (mining) {

    if (
      typeof mining.wallets ===
      'number'
    ) {
      const value =
        mining.wallets.toLocaleString(
          getUiLocale()
        );

      set(
        'home-wallets',
        value
      );

      set(
        'activity-wallets',
        value
      );
    }

    const nackl24 =
      rawToNackl(
        mining.nacklLast24hRaw
      );

    const nacklTotal =
      rawToNackl(
        mining.nacklTotalRaw
      );

    const value24 =
      compactNumber(
        nackl24
      );

    set(
      'home-nackl',
      value24
    );

    set(
      'activity-nackl',
      value24
    );

    set(
      'home-nackl-total',
      compactNumber(
        nacklTotal
      )
    );
  }

  const status =
    getElement(
      root,
      'home-chain-status'
    );

  if (status) {
    status.classList.remove(
      'stale',
      'offline'
    );

    const text =
      status.querySelector(
        'span'
      );

    if (!chain) {
      status.classList.add(
        'offline'
      );

      if (text) {
        text.textContent =
          'CHAIN BEKLENİYOR';
      }

    } else if (data.chainStale) {

      status.classList.add(
        'stale'
      );

      if (text) {
        text.textContent =
          'VERİ GECİKMELİ';
      }

    } else if (text) {

      text.textContent =
        'CANLI VERİ';
    }
  }

  renderSparkline(
    root,
    data.tpsHistory
  );
}


function initNetworkCanvas(
  root: HTMLElement,
): () => void {

  const canvas =
    root.querySelector<HTMLCanvasElement>(
      '#home-network-canvas'
    );

  const stage =
    canvas?.closest<HTMLElement>(
      '.home-radar-stage'
    );

  if (!canvas || !stage) {
    return () => {};
  }

  const context =
    canvas.getContext('2d');

  if (!context) {
    return () => {};
  }

  /*
   * Permanent non-null references.
   *
   * TypeScript correctly narrows canvas/stage/context above,
   * but does not preserve that narrowing inside nested
   * resize/draw/pointer callbacks.
   */
  const canvasElement: HTMLCanvasElement =
    canvas;

  const stageElement: HTMLElement =
    stage;

  const drawingContext: CanvasRenderingContext2D =
    context;

  const prefersReduced =
    window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;

  /*
   * PHASE_7G_V3_PINGS_20260816
   *
   * Former production behavior:
   * interval 950ms
   * lifetime 2700ms
   * radius 18..46%
   */

  const pingLayer =
    canvasElement.closest<HTMLElement>(
      '.network-observatory'
    ) ||
    stageElement;

  let pingInterval:
    number | null =
      null;


  function spawnRadarPing():
    void {

    if (
      prefersReduced ||
      pingLayer.offsetParent === null
    ) {
      return;
    }


    const ping =
      document.createElement(
        'div'
      );


    ping.className =
      'radar-live-ping';


    const angle =
      Math.random() *
      Math.PI *
      2;


    const radius =
      18 +
      Math.random() *
      28;


    ping.style.left =
      (
        50 +
        radius *
        Math.cos(angle)
      ) + '%';


    ping.style.top =
      (
        50 +
        radius *
        Math.sin(angle)
      ) + '%';


    pingLayer.appendChild(
      ping
    );


    window.setTimeout(
      () => {
        ping.remove();
      },
      2700
    );

  }


  if (!prefersReduced) {

    pingInterval =
      window.setInterval(
        spawnRadarPing,
        950
      );


    spawnRadarPing();

  }


  const nodeCount =
    76;

  const goldenAngle =
    Math.PI *
    (
      3 -
      Math.sqrt(5)
    );

  const nodes =
    Array.from(
      {
        length: nodeCount,
      },
      (_, index) => {

        const y =
          1 -
          (
            index /
            (nodeCount - 1)
          ) * 2;

        const radius =
          Math.sqrt(
            Math.max(
              0,
              1 - y * y
            )
          );

        const angle =
          goldenAngle * index;

        return {
          x:
            Math.cos(angle) *
            radius,

          y,

          z:
            Math.sin(angle) *
            radius,

          pulse:
            (
              index * .73
            ) %
            (
              Math.PI * 2
            ),
        };
      }
    );

  const edges:
    Array<[number, number]> =
    [];

  for (
    let first = 0;
    first < nodes.length;
    first++
  ) {
    for (
      let second = first + 1;
      second < nodes.length;
      second++
    ) {
      const dx =
        nodes[first].x -
        nodes[second].x;

      const dy =
        nodes[first].y -
        nodes[second].y;

      const dz =
        nodes[first].z -
        nodes[second].z;

      if (
        dx * dx +
        dy * dy +
        dz * dz <
        .255
      ) {
        edges.push(
          [first, second]
        );
      }
    }
  }

  let width = 0;
  let height = 0;
  let frame = 0;

  const pointer = {
    x: 0,
    y: 0,
    targetX: 0,
    targetY: 0,
  };

  function resize(): void {
    const rect =
      canvasElement.getBoundingClientRect();

    const ratio =
      Math.min(
        window.devicePixelRatio || 1,
        2
      );

    width =
      Math.max(
        1,
        Math.floor(rect.width)
      );

    height =
      Math.max(
        1,
        Math.floor(rect.height)
      );

    canvasElement.width =
      Math.floor(
        width * ratio
      );

    canvasElement.height =
      Math.floor(
        height * ratio
      );

    canvasElement.style.width =
      `${width}px`;

    canvasElement.style.height =
      `${height}px`;

    drawingContext.setTransform(
      ratio,
      0,
      0,
      ratio,
      0,
      0
    );
  }

  function project(
    node: {
      x: number;
      y: number;
      z: number;
    },
    rotationY: number,
    rotationX: number,
    sphereRadius: number,
    centerX: number,
    centerY: number,
  ) {

    const cosY =
      Math.cos(rotationY);

    const sinY =
      Math.sin(rotationY);

    const x1 =
      node.x * cosY -
      node.z * sinY;

    const z1 =
      node.x * sinY +
      node.z * cosY;

    const cosX =
      Math.cos(rotationX);

    const sinX =
      Math.sin(rotationX);

    const y2 =
      node.y * cosX -
      z1 * sinX;

    const z2 =
      node.y * sinX +
      z1 * cosX;

    const perspective =
      2.9 /
      (
        2.9 - z2
      );

    return {
      x:
        centerX +
        x1 *
        sphereRadius *
        perspective,

      y:
        centerY +
        y2 *
        sphereRadius *
        perspective,

      z:
        z2,

      scale:
        perspective,
    };
  }

  function draw(
    now: number,
  ): void {

    if (
      !width ||
      !height
    ) {
      frame =
        requestAnimationFrame(
          draw
        );

      return;
    }

    drawingContext.clearRect(
      0,
      0,
      width,
      height
    );

    pointer.x +=
      (
        pointer.targetX -
        pointer.x
      ) * .045;

    pointer.y +=
      (
        pointer.targetY -
        pointer.y
      ) * .045;

    const time =
      now / 1000;

    const sphereRadius =
      Math.min(
        width * .29,
        height * .35,
        175
      );

    const centerX =
      width * .5;

    const centerY =
      height * .427;

    const rotationY =
      (
        prefersReduced
          ? 0
          : time * .16
      ) +
      pointer.x * .26;

    const rotationX =
      -.12 +
      pointer.y * .18;

    const projected =
      nodes.map(
        (node) =>
          project(
            node,
            rotationY,
            rotationX,
            sphereRadius,
            centerX,
            centerY
          )
      );

    drawingContext.lineWidth = .75;

    for (
      const [first, second]
      of edges
    ) {

      const a =
        projected[first];

      const b =
        projected[second];

      const depth =
        (
          a.z +
          b.z +
          2
        ) / 4;

      const alpha =
        .035 +
        depth * .17;

      drawingContext.strokeStyle =
        `rgba(89,226,242,${alpha})`;

      drawingContext.beginPath();

      drawingContext.moveTo(
        a.x,
        a.y
      );

      drawingContext.lineTo(
        b.x,
        b.y
      );

      drawingContext.stroke();
    }

    projected
      .map(
        (point, index) => ({
          point,
          index,
        })
      )
      .sort(
        (a, b) =>
          a.point.z -
          b.point.z
      )
      .forEach(
        ({
          point,
          index,
        }) => {

          const front =
            Math.max(
              0,
              Math.min(
                1,
                (
                  point.z + 1
                ) / 2
              )
            );

          const pulse =
            (
              Math.sin(
                time * 2.2 +
                nodes[index].pulse
              ) +
              1
            ) / 2;

          const radius =
            (
              1.1 +
              front * 1.6 +
              pulse * .35
            ) *
            point.scale;

          drawingContext.fillStyle =
            `rgba(157,255,107,${
              .18 +
              front * .68
            })`;

          drawingContext.beginPath();

          drawingContext.arc(
            point.x,
            point.y,
            radius,
            0,
            Math.PI * 2
          );

          drawingContext.fill();

          /* PHASE_7G_V3_SPECIAL_MARKERS_REMOVED */
        }
      );

    frame =
      requestAnimationFrame(
        draw
      );
  }

  function pointerMove(
    event: PointerEvent,
  ): void {

    const rect =
      stageElement.getBoundingClientRect();

    pointer.targetX =
      (
        (
          event.clientX -
          rect.left
        ) /
        rect.width -
        .5
      ) * 2;

    pointer.targetY =
      (
        (
          event.clientY -
          rect.top
        ) /
        rect.height -
        .5
      ) * 2;
  }

  function pointerLeave(): void {
    pointer.targetX = 0;
    pointer.targetY = 0;
  }

  const resizeObserver =
    new ResizeObserver(
      resize
    );

  resizeObserver.observe(
    stageElement
  );

  stageElement.addEventListener(
    'pointermove',
    pointerMove
  );

  stageElement.addEventListener(
    'pointerleave',
    pointerLeave
  );

  resize();

  frame =
    requestAnimationFrame(
      draw
    );

  return () => {

    if (
      pingInterval !== null
    ) {
      window.clearInterval(
        pingInterval
      );
    }


    pingLayer
      .querySelectorAll(
        '.radar-live-ping'
      )
      .forEach(
        node => {
          node.remove();
        }
      );


    cancelAnimationFrame(
      frame
    );

    resizeObserver.disconnect();

    stageElement.removeEventListener(
      'pointermove',
      pointerMove
    );

    stageElement.removeEventListener(
      'pointerleave',
      pointerLeave
    );
  };
}


export function mountHome(
  root: HTMLElement,
): () => void {

  let destroyed =
    false;

  let statsTimer:
    number | null =
    null;

  /*
   * Keep the latest read-only API sample in memory.
   * Language switches can re-render it immediately
   * without another network request.
   */
  let latestStats:
    RadarStats | null =
    null;

  const cleanCanvas =
    initNetworkCanvas(
      root
    );

  const cloudEntry =
    root.querySelector<HTMLAnchorElement>(
      '#home-cloud-entry'
    );

  const onCloudClick =
    (
      event: MouseEvent,
    ) => {
      event.preventDefault();

      navigate(
        '/cloud-miner'
      );
    };

  cloudEntry?.addEventListener(
    'click',
    onCloudClick
  );


  async function refreshStats():
    Promise<void> {

    try {
      const response =
        await fetch(
          '/api/radar/stats',
          {
            cache:
              'no-store',
          }
        );

      if (
        !response.ok ||
        destroyed
      ) {
        return;
      }

      const data = (await response.json()) as RadarStats;

      if (!destroyed) {

        latestStats =
          data;

        renderStats(
          root,
          data
        );
      }

    } catch {
      const status =
        getElement(
          root,
          'home-chain-status'
        );

      if (status) {
        status.classList.add(
          'offline'
        );

        const text =
          status.querySelector(
            'span'
          );

        if (text) {
          text.textContent =
            'VERİ BAĞLANTISI YOK';
        }
      }
    }
  }

  const onLanguageChange =
    () => {

      if (
        destroyed ||
        !latestStats
      ) {
        return;
      }

      renderStats(
        root,
        latestStats
      );
    };

  window.addEventListener(
    'radar:language',
    onLanguageChange
  );


  void refreshStats();

  statsTimer =
    window.setInterval(
      () => {
        void refreshStats();
      },
      60_000
    );

  return () => {
    destroyed = true;

    if (
      statsTimer !== null
    ) {
      window.clearInterval(
        statsTimer
      );
    }

    window.removeEventListener(
      'radar:language',
      onLanguageChange
    );

    cloudEntry?.removeEventListener(
      'click',
      onCloudClick
    );

    cleanCanvas();
  };
}
