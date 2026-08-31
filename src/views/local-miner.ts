import '../styles/roadmap-products.css';


export function localMinerView():
  HTMLElement {

  const root =
    document.createElement(
      'section'
    );


  root.className =
    'roadmap-product-view';


  root.innerHTML = `
    <div class="roadmap-product-shell">

      <header class="roadmap-product-head">

        <div>

          <span class="roadmap-kicker">
            LOCAL COMPUTE / ROADMAP
          </span>

          <h1>
            Local Miner
          </h1>

          <p>
            Kendi bilgisayarınızın kaynaklarını
            kullanarak Acki Nacki ağına doğrudan
            katılacağınız masaüstü madenci deneyimi.
          </p>

        </div>

        <span class="roadmap-status">
          GELİŞTİRME AŞAMASINDA
        </span>

      </header>


      <section class="roadmap-hero">

        <div class="roadmap-hero-visual local">

          <div class="roadmap-monitor">

            <div class="roadmap-monitor-top">
              <span></span>
              <span></span>
              <span></span>
            </div>

            <div class="roadmap-terminal">

              <span>
                LOCAL MINER
              </span>

              <strong>
                DEVICE COMPUTE
              </strong>

              <i>
                DEVELOPMENT
              </i>

            </div>

          </div>

        </div>


        <div class="roadmap-hero-copy">

          <span class="roadmap-index">
            01 / PRODUCT
          </span>

          <h2>
            Madencilik gücü kendi cihazınızda.
          </h2>

          <p>
            Local Miner; Cloud Miner'dan farklı
            olarak kullanıcının kendi bilgisayar
            kaynaklarını kullanacağı bağımsız
            madencilik ürünü olarak planlanıyor.
          </p>

          <div class="roadmap-notice">

            <span>
              DURUM
            </span>

            <strong>
              Henüz kullanıma açılmadı
            </strong>

            <small>
              İndirme veya aktivasyon işlemi
              şu anda mevcut değil.
            </small>

          </div>

        </div>

      </section>


      <section class="roadmap-capabilities">

        <article>

          <span>
            01
          </span>

          <strong>
            YEREL KAYNAKLAR
          </strong>

          <p>
            Madencilik iş yükünün kullanıcının
            kendi bilgisayar kaynakları üzerinde
            çalışması hedefleniyor.
          </p>

        </article>


        <article>

          <span>
            02
          </span>

          <strong>
            DOĞRUDAN KATILIM
          </strong>

          <p>
            Ürün vizyonu, kullanıcının Acki Nacki
            ağına kendi cihazından doğrudan
            katılması üzerine kurulu.
          </p>

        </article>


        <article>

          <span>
            03
          </span>

          <strong>
            MASAÜSTÜ DENEYİMİ
          </strong>

          <p>
            Cloud Miner'ın yanında ayrı bir
            masaüstü madencilik deneyimi olarak
            konumlandırılıyor.
          </p>

        </article>

      </section>


      <footer class="roadmap-product-footer">

        <div>

          <span>
            ACKI NACKI RADAR
          </span>

          <strong>
            PRODUCT ROADMAP
          </strong>

        </div>

        <div class="roadmap-actions">

          <a
            href="/cloud-miner"
            data-link
          >
            CLOUD MINER
          </a>

          <a
            href="/boost-farm"
            data-link
          >
            BOOST FARM →
          </a>

        </div>

      </footer>

    </div>
  `;


  return root;
}
