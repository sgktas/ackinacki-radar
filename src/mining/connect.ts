import {
  authHeaders,
} from '../auth/session';


type MinerWriteResult = {
  ok?: boolean;
  error?: string;

  walletName?: string;

  deepLink?: string;
  reused?: boolean;

  status?: string;
  paused?: boolean;
};


type MinerConnectOptions = {
  onConnected:
    (
      message: string,
    ) => Promise<void>;

  onUnauthorized:
    () => void;
};


declare global {
  interface Window {
    makeQrSvg?:
      (
        value: string,
      ) => string;
  }
}


function minerError(
  code:
    string | undefined,
): string {

  switch (code) {

    case 'WALLET_NAME_REQUIRED':
      return 'Cüzdan adı gerekli.';

    case 'BEE_APP_ID_NOT_CONFIGURED':
      return 'Cloud Miner servisi şu anda hazır değil.';

    case 'SUBSCRIPTION_REQUIRED':
      return 'Aktif aboneliğiniz yok. Önce bir plan etkinleştirin.';

    case 'CONNECT_FAILED':
      return 'Cüzdan doğrulaması başlatılamadı. Biraz sonra tekrar deneyin.';

    case 'NO_PENDING_CONNECTION':
      return 'Bekleyen bir bağlantı bulunamadı.';

    case 'NOT_YET_APPROVED':
      return 'Onay henüz zincirde görünmüyor.';

    case 'UNAUTHORIZED':
      return 'Oturum sona erdi.';

    default:
      return 'İşlem tamamlanamadı.';
  }
}


function setMessage(
  root: HTMLElement,
  message: string,
  state:
    | 'normal'
    | 'ok'
    | 'error' =
      'normal',
): void {

  const element =
    root.querySelector<HTMLElement>(
      '#cloud-connect-message'
    );

  if (!element) {
    return;
  }

  element.textContent =
    message;

  element.classList.remove(
    'ok',
    'error'
  );

  if (
    state === 'ok' ||
    state === 'error'
  ) {
    element.classList.add(
      state
    );
  }
}


function setBusy(
  root: HTMLElement,
  busy: boolean,
): void {

  const button =
    root.querySelector<HTMLButtonElement>(
      '#cloud-connect-button'
    );

  if (!button) {
    return;
  }

  button.disabled =
    busy;

  button.textContent =
    busy
      ? 'HAZIRLANIYOR…'
      : 'CÜZDAN BAĞLA';
}


function renderApproval(
  root: HTMLElement,
  walletName: string,
  deepLink: string,
  reused: boolean,
): void {

  const result =
    root.querySelector<HTMLElement>(
      '#cloud-connect-result'
    );

  if (!result) {
    return;
  }

  result.replaceChildren();


  const approval =
    document.createElement(
      'div'
    );

  approval.className =
    'cloud-connect-approval';


  const copy =
    document.createElement(
      'div'
    );

  copy.className =
    'cloud-connect-approval-copy';


  const kicker =
    document.createElement(
      'span'
    );

  kicker.className =
    'cloud-data-kicker';

  kicker.textContent =
    reused
      ? 'PENDING AUTHORIZATION · DEVAM EDİYOR'
      : 'PENDING AUTHORIZATION';


  const heading =
    document.createElement(
      'b'
    );

  heading.textContent =
    `${walletName} için AN Wallet onayı bekleniyor`;


  const text =
    document.createElement(
      'p'
    );

  text.textContent =
    reused
      ? 'Daha önce oluşturulan güvenli onay bağlantısı yeniden kullanılıyor. Yeni mining anahtarı oluşturulmadı.'
      : 'AN Wallet içinde mining anahtarı yetkisini onaylayın. Sistem onayı otomatik kontrol edecek.';


  copy.append(
    kicker,
    heading,
    text
  );


  const qr =
    document.createElement(
      'div'
    );

  qr.className =
    'cloud-connect-qr';

  qr.id =
    'cloud-connect-qr';


  if (
    typeof window.makeQrSvg ===
    'function'
  ) {

    try {

      qr.innerHTML =
        window.makeQrSvg(
          deepLink
        );

    } catch {

      qr.textContent =
        'QR oluşturulamadı.';
    }

  } else {

    qr.textContent =
      'QR modülü yüklenemedi.';
  }


  const actions =
    document.createElement(
      'div'
    );

  actions.className =
    'cloud-connect-actions';


  const open =
    document.createElement(
      'a'
    );

  open.className =
    'cloud-connect-open';

  open.id =
    'cloud-connect-open';

  open.href =
    deepLink;

  open.target =
    '_blank';

  open.rel =
    'noopener noreferrer';

  open.textContent =
    'AN WALLET’TA AÇ';


  const copyButton =
    document.createElement(
      'button'
    );

  copyButton.type =
    'button';

  copyButton.className =
    'cloud-connect-secondary';

  copyButton.dataset.connectCopy =
    deepLink;

  copyButton.textContent =
    'LİNKİ KOPYALA';


  const checkButton =
    document.createElement(
      'button'
    );

  checkButton.type =
    'button';

  checkButton.id =
    'cloud-connect-check';

  checkButton.className =
    'cloud-connect-secondary';

  checkButton.dataset.connectCheck =
    walletName;

  checkButton.textContent =
    'ONAYI ŞİMDİ KONTROL ET';


  actions.append(
    open,
    copyButton,
    checkButton
  );


  approval.append(
    copy,
    qr,
    actions
  );

  result.append(
    approval
  );


  setMessage(
    root,
    'Onay bekleniyor · otomatik kontrol yaklaşık 20 saniye sonra başlayacak.'
  );
}


export function mountMinerConnect(
  root: HTMLElement,
  options: MinerConnectOptions,
): () => void {

  let destroyed =
    false;

  let connectRun =
    0;

  const controller =
    new AbortController();


  async function post(
    endpoint: 'connect' | 'check',
    walletName: string,
  ): Promise<MinerWriteResult> {

    const response =
      await fetch(
        `/api/dashboard/miner/${endpoint}`,
        {
          method:
            'POST',

          headers: {
            'Content-Type':
              'application/json',

            ...authHeaders(),
          },

          body:
            JSON.stringify({
              walletName,
            }),

          cache:
            'no-store',

          signal:
            controller.signal,
        }
      );


    if (
      response.status === 401
    ) {

      options.onUnauthorized();

      return {
        ok:
          false,

        error:
          'UNAUTHORIZED',
      };
    }


    const data = (await response.json()) as MinerWriteResult;

    return data;
  }


  async function finish(
    message: string,
  ): Promise<void> {

    connectRun += 1;

    await options.onConnected(
      message
    );
  }


  async function checkWallet(
    walletName: string,
    manualButton?:
      HTMLButtonElement,
  ): Promise<boolean> {

    if (
      destroyed
    ) {
      return true;
    }


    if (manualButton) {

      manualButton.disabled =
        true;

      manualButton.textContent =
        'KONTROL EDİLİYOR…';
    }


    try {

      const data =
        await post(
          'check',
          walletName
        );


      if (
        destroyed
      ) {
        return true;
      }


      if (data.ok) {

        await finish(
          data.paused
            ? 'Cüzdan bağlandı. Başka aktif miner olduğu için bu cüzdan durdurulmuş durumda.'
            : 'Cüzdan bağlandı ve Cloud Miner aktif.'
        );

        return true;
      }


      if (
        data.error ===
        'NO_PENDING_CONNECTION'
      ) {

        await finish(
          'Bağlantı durumu yenilendi.'
        );

        return true;
      }


      if (
        data.error ===
        'NOT_YET_APPROVED'
      ) {

        setMessage(
          root,
          'Onay henüz zincirde görünmüyor. AN Wallet onayından sonra tekrar kontrol edebilirsiniz.'
        );

        return false;
      }


      if (
        data.error !==
        'UNAUTHORIZED'
      ) {

        setMessage(
          root,
          minerError(
            data.error
          ),
          'error'
        );
      }


      return false;

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
        return true;
      }


      setMessage(
        root,
        'Sunucuya ulaşılamadı.',
        'error'
      );

      return false;

    } finally {

      if (
        manualButton &&
        manualButton.isConnected
      ) {

        manualButton.disabled =
          false;

        manualButton.textContent =
          'ONAYI ŞİMDİ KONTROL ET';
      }
    }
  }


  async function autoConfirm(
    walletName: string,
  ): Promise<void> {

    const run =
      ++connectRun;


    for (
      let attempt = 1;
      attempt <= 3;
      attempt += 1
    ) {

      const waitMs =
        attempt === 1
          ? 20_000
          : 5_000;


      await new Promise<void>(
        resolve => {
          window.setTimeout(
            resolve,
            waitMs
          );
        }
      );


      if (
        destroyed ||
        run !== connectRun
      ) {
        return;
      }


      const done =
        await checkWallet(
          walletName
        );


      if (
        done ||
        destroyed ||
        run !== connectRun
      ) {
        return;
      }


      setMessage(
        root,
        `Onay bekleniyor · otomatik kontrol ${attempt}/3`
      );
    }


    if (
      destroyed ||
      run !== connectRun
    ) {
      return;
    }


    setMessage(
      root,
      'Otomatik kontrol tamamlandı. Onay verdiyseniz “Onayı şimdi kontrol et” düğmesini kullanabilirsiniz.'
    );
  }


  async function connectWallet():
    Promise<void> {

    const input =
      root.querySelector<HTMLInputElement>(
        '#cloud-wallet-input'
      );

    const walletName =
      input?.value.trim() ||
      '';


    if (!walletName) {

      setMessage(
        root,
        'Önce cüzdan adını girin.',
        'error'
      );

      input?.focus();

      return;
    }


    connectRun += 1;

    setBusy(
      root,
      true
    );

    setMessage(
      root,
      'Mining anahtarı hazırlanıyor…'
    );


    try {

      const data =
        await post(
          'connect',
          walletName
        );


      if (
        destroyed
      ) {
        return;
      }


      if (
        !data.ok
      ) {

        if (
          data.error !==
          'UNAUTHORIZED'
        ) {

          setMessage(
            root,
            minerError(
              data.error
            ),
            'error'
          );
        }

        return;
      }


      if (
        !data.deepLink
      ) {

        setMessage(
          root,
          'Onay bağlantısı alınamadı.',
          'error'
        );

        return;
      }


      renderApproval(
        root,
        data.walletName ||
          walletName,
        data.deepLink,
        data.reused === true
      );


      void autoConfirm(
        data.walletName ||
          walletName
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


      setMessage(
        root,
        'Sunucuya ulaşılamadı.',
        'error'
      );

    } finally {

      setBusy(
        root,
        false
      );
    }
  }


  function submitHandler(
    event: SubmitEvent,
  ): void {

    const target =
      event.target;

    if (
      !(
        target instanceof
        HTMLFormElement
      )
    ) {
      return;
    }


    if (
      target.id !==
      'cloud-connect-form'
    ) {
      return;
    }


    event.preventDefault();

    void connectWallet();
  }


  function clickHandler(
    event: MouseEvent,
  ): void {

    const target =
      event.target;

    if (
      !(target instanceof Element)
    ) {
      return;
    }


    const check =
      target.closest<HTMLButtonElement>(
        '[data-connect-check]'
      );


    if (check) {

      const walletName =
        check.dataset.connectCheck ||
        '';

      if (walletName) {

        void checkWallet(
          walletName,
          check
        );
      }

      return;
    }


    const copy =
      target.closest<HTMLButtonElement>(
        '[data-connect-copy]'
      );


    if (copy) {

      const link =
        copy.dataset.connectCopy ||
        '';

      if (!link) {
        return;
      }


      void navigator.clipboard
        .writeText(
          link
        )
        .then(
          () => {

            copy.textContent =
              'KOPYALANDI';

            window.setTimeout(
              () => {

                if (
                  copy.isConnected
                ) {
                  copy.textContent =
                    'LİNKİ KOPYALA';
                }

              },
              1400
            );
          }
        )
        .catch(
          () => {

            setMessage(
              root,
              'Link kopyalanamadı.',
              'error'
            );
          }
        );
    }
  }


  root.addEventListener(
    'submit',
    submitHandler
  );

  root.addEventListener(
    'click',
    clickHandler
  );


  return () => {

    destroyed =
      true;

    connectRun += 1;

    controller.abort();

    root.removeEventListener(
      'submit',
      submitHandler
    );

    root.removeEventListener(
      'click',
      clickHandler
    );
  };
}
