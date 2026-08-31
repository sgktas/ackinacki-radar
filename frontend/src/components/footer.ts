/*
 * PHASE_7J_STEP3_20260816
 *
 * Expanded footer using only real
 * Acki Nacki Radar routes and links.
 */


function telegramIcon():
  string {

  return `
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        d="m21 3-7.4 18-4.2-7.2L3 10.5 21 3Z"
      ></path>

      <path
        d="m9.4 13.8 5.2-4.7"
      ></path>
    </svg>
  `;
}


function xIcon():
  string {

  return `
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d="M5 4l14 16"></path>
      <path d="M19 4 5 20"></path>
    </svg>
  `;
}


function mailIcon():
  string {

  return `
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <rect
        x="3"
        y="5"
        width="18"
        height="14"
        rx="2"
      ></rect>

      <path
        d="m4 7 8 6 8-6"
      ></path>
    </svg>
  `;
}


export function renderFooter():
  HTMLElement {

  const footer =
    document.createElement(
      'footer'
    );

  footer.className =
    'site-footer';

  const year =
    new Date()
      .getFullYear();


  footer.innerHTML = `

    <div class="footer-expanded">

      <div class="footer-expanded-grid">


        <section
          class="footer-brand-column"
        >

          <a
            class="footer-brand-lockup"
            href="/"
          >

            <img
              src="/logo.png"
              alt=""
            />

            <span>

              <strong>
                ACKI NACKI
                <b>RADAR</b>
              </strong>

              <small>
                MAINNET INTELLIGENCE
              </small>

            </span>

          </a>


          <p>
            Acki Nacki ağını,
            madencilik akışını ve
            canlı zincir verilerini
            tek merkezden takip edin.
          </p>


          <span
            class="footer-live-status"
          >
            <i></i>
            MAINNET LIVE
          </span>

        </section>


        <nav
          class="footer-link-column"
          aria-label="Platform"
        >

          <strong>
            PLATFORM
          </strong>

          <a href="/">
            Ana Sayfa
          </a>

          <a href="/plans">
            Planlar
          </a>

          <a href="/referrals">
            Referanslar
          </a>

          <a href="/support">
            Destek
          </a>

        </nav>


        <nav
          class="footer-link-column"
          aria-label="Mining araçları"
        >

          <strong>
            MINING & TOOLS
          </strong>

          <a href="/cloud-miner">
            Cloud Miner
          </a>

          <a href="/local-miner">
            Local Miner
          </a>

          <a href="/boost-farm">
            Boost Farm
          </a>

        </nav>


        <nav
          class="footer-link-column"
          aria-label="Topluluk"
        >

          <strong>
            TOPLULUK
          </strong>

          <a
            href="https://t.me/Ackinackiradarofficial"
            target="_blank"
            rel="noopener noreferrer"
          >
            Official Telegram
          </a>

          <a
            href="https://t.me/ackinackiradar"
            target="_blank"
            rel="noopener noreferrer"
          >
            Telegram Community
          </a>

          <a
            href="https://x.com/elturko_sg"
            target="_blank"
            rel="noopener noreferrer"
          >
            X / Twitter
          </a>

          <a
            href="https://t.me/ackinackiradar_bot"
            target="_blank"
            rel="noopener noreferrer"
          >
            Radar Bot
          </a>

          <a
            href="mailto:info@ackinackiradar.com"
          >
            info@ackinackiradar.com
          </a>

        </nav>


      

        <!-- PHASE_7J_SOURCES_V4_20260816 -->
        <nav
          class="footer-link-column footer-source-column"
          aria-label="Kaynaklar"
        >

          <strong>
            KAYNAKLAR
          </strong>

          <a
            href="https://mainnet.ackinacki.org/graphql"
            target="_blank"
            rel="noopener noreferrer"
          >
            Mainnet GraphQL
          </a>

          <a
            href="https://docs.ackinacki.com/for-developers/getting-started-with-acki-nacki"
            target="_blank"
            rel="noopener noreferrer"
          >
            Developer Docs
          </a>

          <a
            href="https://dev.ackinacki.com/js-ts-guides/installation/add_sdk_to_your_app"
            target="_blank"
            rel="noopener noreferrer"
          >
            TVM SDK
          </a>

          <a
            href="https://dev.ackinacki.com/bee-engine/bee-engine-sdk-integration-documentation"
            target="_blank"
            rel="noopener noreferrer"
          >
            Bee Engine SDK
          </a>

          <a
            href="https://github.com/ackinacki/ackinacki"
            target="_blank"
            rel="noopener noreferrer"
          >
            Acki Nacki GitHub
          </a>

        </nav>


</div>


      
      <div class="footer-community-note">

        <span>
          BAĞIMSIZ TOPLULUK PROJESİ
        </span>

        <p>
          Acki Nacki Radar bağımsız ve topluluk tarafından
          geliştirilen bir platformdur. Acki Nacki'nin resmi
          sitesi, ürünü veya temsilcisi değildir.
        </p>

      </div>


<div
        class="footer-expanded-bottom"
      >

        <div
          class="footer-copyright"
        >

          <span>
            © ${year} Acki Nacki Radar
          </span>

          <small>
            MAINNET · LIVE NETWORK DATA
          </small>

        </div>


        <nav
          class="footer-social-icons"
          aria-label="Sosyal medya"
        >

          <a
            class="telegram official"
            href="https://t.me/Ackinackiradarofficial"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Official Telegram"
            title="Official Telegram"
          >
            ${telegramIcon()}
          </a>


          <a
            class="telegram community"
            href="https://t.me/ackinackiradar"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Telegram Community"
            title="Telegram Community"
          >
            ${telegramIcon()}
          </a>


          <a
            class="x"
            href="https://x.com/elturko_sg"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="X"
            title="X"
          >
            ${xIcon()}
          </a>


          <a
            class="telegram bot"
            href="https://t.me/ackinackiradar_bot"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Radar Bot"
            title="Radar Bot"
          >
            ${telegramIcon()}
          </a>


          <a
            class="mail"
            href="mailto:info@ackinackiradar.com"
            aria-label="E-posta"
            title="E-posta"
          >
            ${mailIcon()}
          </a>

        </nav>

      </div>

    </div>

  `;


  return footer;
}
