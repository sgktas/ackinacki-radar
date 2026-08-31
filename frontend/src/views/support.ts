import '../styles/support.css';


const SUPPORT_EMAIL =
  'info@ackinackiradar.com';

const SUPPORT_TELEGRAM =
  'https://t.me/ackinackiradar_bot';


function setSupportMessage(
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
      '#support-status'
    );


  if (!target) {
    return;
  }


  target.textContent =
    text;

  target.className =
    `support-status ${kind}`;
}


function buildMailto(
  category: string,
  subject: string,
  message: string,
): string {

  const mailSubject =
    `[Acki Radar · ${category}] ${subject}`;


  const body =
    `${category}\n\n` +
    `${message}\n\n` +
    '— Acki Nacki Radar Dashboard';


  return (
    `mailto:${SUPPORT_EMAIL}` +
    `?subject=${encodeURIComponent(mailSubject)}` +
    `&body=${encodeURIComponent(body)}`
  );
}


export function mountSupport(
  root: HTMLElement,
): () => void {

  const form =
    root.querySelector<HTMLFormElement>(
      '#support-form'
    );


  const category =
    root.querySelector<HTMLSelectElement>(
      '#support-category'
    );


  const subject =
    root.querySelector<HTMLInputElement>(
      '#support-subject'
    );


  const message =
    root.querySelector<HTMLTextAreaElement>(
      '#support-message'
    );


  if (
    !form ||
    !category ||
    !subject ||
    !message
  ) {

    return () => {};
  }


  const submit =
    (
      event: SubmitEvent
    ) => {

      event.preventDefault();


      const categoryValue =
        category.value;


      const subjectValue =
        subject.value.trim();


      const messageValue =
        message.value.trim();


      if (
        !subjectValue ||
        !messageValue
      ) {

        setSupportMessage(
          root,
          'Konu ve mesaj alanlarını doldurun.',
          'error'
        );

        return;
      }


      const mailto =
        buildMailto(
          categoryValue,
          subjectValue,
          messageValue
        );


      setSupportMessage(
        root,
        'E-posta uygulaması açılıyor.',
        'ok'
      );


      window.location.href =
        mailto;
    };


  form.addEventListener(
    'submit',
    submit
  );


  return () => {

    form.removeEventListener(
      'submit',
      submit
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
        mountSupport(
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


export function supportView():
  HTMLElement {

  const root =
    document.createElement(
      'section'
    );


  root.className =
    'support-view';


  root.innerHTML = `
    <div class="support-shell">

      <header class="support-page-head">

        <div>

          <span class="support-kicker">
            SUPPORT / FEEDBACK
          </span>

          <h1>
            Dilek / İstek / Şikayet
          </h1>

          <p>
            Geri bildiriminizi doğrudan
            Acki Nacki Radar ekibine iletin.
          </p>

        </div>

        <span class="support-channel-status">
          DIRECT CONTACT
        </span>

      </header>


      <section class="support-layout">

        <article class="support-form-card">

          <header>

            <span class="support-index">
              01 / MESSAGE
            </span>

            <h2>
              E-posta hazırla
            </h2>

            <p>
              Form mesajınızı hazırlar ve
              cihazınızdaki varsayılan
              e-posta uygulamasını açar.
            </p>

          </header>


          <form
            id="support-form"
            class="support-form"
          >

            <label>

              <span>
                KATEGORİ
              </span>

              <select
                id="support-category"
                aria-label="Kategori"
              >
                <option value="Dilek">
                  Dilek
                </option>

                <option value="İstek">
                  İstek
                </option>

                <option value="Şikayet">
                  Şikayet
                </option>

                <option value="Teknik Destek">
                  Teknik Destek
                </option>
              </select>

            </label>


            <label>

              <span>
                KONU
              </span>

              <input
                id="support-subject"
                type="text"
                maxlength="120"
                autocomplete="off"
                placeholder="Konu"
              >

              <small>
                Maksimum 120 karakter
              </small>

            </label>


            <label>

              <span>
                MESAJ
              </span>

              <textarea
                id="support-message"
                maxlength="2000"
                placeholder="Mesajınızı ayrıntılı biçimde yazın"
              ></textarea>

              <small>
                Maksimum 2000 karakter
              </small>

            </label>


            <button
              type="submit"
              class="support-submit"
            >
              E-POSTA HAZIRLA
            </button>

          </form>


          <div
            id="support-status"
            class="support-status info"
            aria-live="polite"
          ></div>

        </article>


        <aside class="support-contact-card">

          <span class="support-index">
            02 / DIRECT
          </span>

          <h2>
            Doğrudan iletişim
          </h2>

          <p>
            Daha hızlı iletişim için
            Telegram botunu kullanabilir
            veya doğrudan e-posta
            gönderebilirsiniz.
          </p>


          <div class="support-contact-list">

            <a
              href="mailto:${SUPPORT_EMAIL}"
              class="support-contact-link"
            >

              <span>
                EMAIL
              </span>

              <strong>
                ${SUPPORT_EMAIL}
              </strong>

              <b>
                →
              </b>

            </a>


            <a
              href="${SUPPORT_TELEGRAM}"
              target="_blank"
              rel="noopener noreferrer"
              class="support-contact-link telegram"
            >

              <span>
                TELEGRAM
              </span>

              <strong>
                @ackinackiradar_bot
              </strong>

              <b>
                ↗
              </b>

            </a>

          </div>


          <div class="support-info">

            <span>
              NASIL ÇALIŞIR?
            </span>

            <ol>

              <li>
                Kategoriyi seçin.
              </li>

              <li>
                Konu ve mesajınızı yazın.
              </li>

              <li>
                “E-posta hazırla” düğmesine
                basın.
              </li>

              <li>
                Cihazınızdaki e-posta
                uygulamasında gönderimi
                onaylayın.
              </li>

            </ol>

          </div>

        </aside>

      </section>


      <footer class="support-footer">

        <span>
          ACKI NACKI RADAR · SUPPORT
        </span>

        <a
          href="/"
          data-link
        >
          ANA SAYFA →
        </a>

      </footer>

    </div>
  `;


  scheduleMount(
    root
  );


  return root;
}
