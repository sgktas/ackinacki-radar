import '../styles/roadmap-products.css';


export function boostFarmView():
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
            MINING POWER / ROADMAP
          </span>

          <h1>
            Boost Farm
          </h1>

          <p>
            Madencilik kapasitenizi dönemsel
            güç paketleriyle büyütüp performansı
            tek merkezden izleyeceğiniz
            ölçekleme katmanı.
          </p>

        </div>

        <span class="roadmap-status">
          GELİŞTİRME AŞAMASINDA
        </span>

      </header>


      <section class="roadmap-hero">

        <div class="roadmap-hero-visual boost">

          <div class="roadmap-boost-core">

            <div class="roadmap-boost-ring ring-a"></div>
            <div class="roadmap-boost-ring ring-b"></div>

            <div class="roadmap-boost-bolt">
              ⚡
            </div>

            <span>
              BOOST
            </span>

          </div>

        </div>


        <div class="roadmap-hero-copy">

          <span class="roadmap-index">
            02 / PRODUCT
          </span>

          <h2>
            Madencilik kapasitesi için
            ölçekleme katmanı.
          </h2>

          <p>
            Boost Farm; madencilik kapasitesini
            dönemsel güç paketleriyle büyütmeyi
            ve performansı tek merkezden
            izlemeyi amaçlayan ürün olarak
            planlanıyor.
          </p>

          <div class="roadmap-notice">

            <span>
              DURUM
            </span>

            <strong>
              Henüz kullanıma açılmadı
            </strong>

            <small>
              Güç paketi satın alma veya Boost
              aktivasyonu şu anda mevcut değil.
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
            GÜÇ PAKETLERİ
          </strong>

          <p>
            Ürün vizyonunda madencilik
            kapasitesinin dönemsel güç
            paketleriyle artırılması bulunuyor.
          </p>

        </article>


        <article>

          <span>
            02
          </span>

          <strong>
            ÖLÇEKLEME
          </strong>

          <p>
            Boost Farm, mevcut madencilik
            kapasitesinin üzerinde çalışan
            ayrı bir ölçekleme katmanı olarak
            konumlandırılıyor.
          </p>

        </article>


        <article>

          <span>
            03
          </span>

          <strong>
            MERKEZİ İZLEME
          </strong>

          <p>
            Güç ve performans durumunun tek
            merkezden takip edilmesi ürünün
            temel hedeflerinden biri.
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
            href="/local-miner"
            data-link
          >
            ← LOCAL MINER
          </a>

          <a
            href="/cloud-miner"
            data-link
          >
            CLOUD MINER
          </a>

        </div>

      </footer>

    </div>
  `;


  return root;
}
