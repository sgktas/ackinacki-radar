import { uiText } from '../i18n/runtime';

import {
  authHeaders,
} from '../auth/session';


type MinerAction =
  | 'start'
  | 'stop'
  | 'remove';


type MinerControlResult = {
  ok?: boolean;
  error?: string;

  walletName?: string;
  status?: string;

  removed?: boolean;
};


type MinerControlOptions = {
  onChanged:
    (
      message: string,
    ) => Promise<void>;

  onUnauthorized:
    () => void;
};


function friendlyControlError(
  code: string | undefined,
  status: number,
): string {

  switch (code) {

    case 'INVALID_STATE':
      return 'Madenci bu işlem için uygun durumda değil.';

    case 'ONE_WALLET_PER_PLAN':
      return 'Planınız aynı anda yalnızca bir aktif mining cüzdanına izin veriyor. Önce diğer aktif cüzdanı durdurun.';

    case 'SUBSCRIPTION_REQUIRED':
      return 'Aktif aboneliğiniz yok. Önce bir plan etkinleştirin.';

    case 'MINER_NOT_FOUND':
      return 'Miner kaydı bulunamadı.';

    case 'WALLET_NAME_REQUIRED':
      return 'Cüzdan adı gerekli.';

    case 'UNAUTHORIZED':
      return 'Oturum sona erdi.';

    default:
      return status > 0
        ? `İşlem tamamlanamadı · HTTP ${status}`
        : 'İşlem tamamlanamadı.';
  }
}


function setControlMessage(
  root: HTMLElement,
  text: string,
  state:
    | 'normal'
    | 'ok'
    | 'error' =
      'normal',
): void {

  const element =
    root.querySelector<HTMLElement>(
      '#cloud-control-message'
    );

  if (!element) {
    return;
  }

  element.hidden =
    false;

  element.textContent =
    text;

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


function successMessage(
  action: MinerAction,
  walletName: string,
): string {

  if (action === 'start') {
    return `${walletName} başlatıldı.`;
  }

  if (action === 'stop') {
    return `${walletName} durduruldu.`;
  }

  return `${walletName} Cloud Miner hizmetinden kaldırıldı.`;
}


export function mountMinerControls(
  root: HTMLElement,
  options: MinerControlOptions,
): () => void {

  let destroyed =
    false;

  const controller =
    new AbortController();


  async function runAction(
    button: HTMLButtonElement,
    action: MinerAction,
    walletName: string,
  ): Promise<void> {

    /*
     * REMOVE is destructive:
     * the backend deletes the stored miner record
     * and its stored mining key material.
     *
     * Absolutely no request is sent until the
     * user explicitly confirms this dialog.
     */
    if (
      action === 'remove'
    ) {

      const confirmed =
        window.confirm(
          uiText(
            `"${walletName}" Cloud Miner hizmetinden tamamen kaldırılacak.\n\n` +
              'Bu işlem kayıtlı mining anahtarını da hizmetten siler ve geri alınamaz.\n\n' +
              'Devam etmek istiyor musunuz?',
            `"${walletName}" will be completely removed from Cloud Miner.\n\n` +
              'This also deletes the stored mining key from the service and cannot be undone.\n\n' +
              'Do you want to continue?',
            `"${walletName}" будет полностью удалён из Cloud Miner.\n\n` +
              'Сохранённый ключ майнинга также будет удалён из сервиса. Это действие необратимо.\n\n' +
              'Продолжить?'
          )
        );

      if (!confirmed) {
        return;
      }
    }


    const originalText =
      button.textContent ||
      '';

    button.disabled =
      true;

    button.textContent =
      action === 'remove'
        ? 'KALDIRILIYOR…'
        : 'İŞLENİYOR…';


    setControlMessage(
      root,
      `${walletName} · işlem yapılıyor…`
    );


    try {

      const response =
        await fetch(
          `/api/dashboard/miner/${action}`,
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

        return;
      }


      let data:
        MinerControlResult | null =
          null;


      try {

        data = (await response.json()) as MinerControlResult;

      } catch {

        data =
          null;
      }


      if (
        !response.ok ||
        !data ||
        data.ok === false
      ) {

        setControlMessage(
          root,
          friendlyControlError(
            data?.error,
            response.status
          ),
          'error'
        );

        return;
      }


      await options.onChanged(
        successMessage(
          action,
          data.walletName ||
            walletName
        )
      );

    } catch (error) {

      if (
        destroyed ||
        (
          error instanceof DOMException &&
          error.name === 'AbortError'
        )
      ) {
        return;
      }


      setControlMessage(
        root,
        'Sunucuya ulaşılamadı.',
        'error'
      );

    } finally {

      if (
        button.isConnected
      ) {

        button.disabled =
          false;

        button.textContent =
          originalText;
      }
    }
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


    const button =
      target.closest<HTMLButtonElement>(
        '[data-miner-action]'
      );


    if (!button) {
      return;
    }


    const rawAction =
      button.dataset.minerAction;

    const walletName =
      button.dataset.wallet ||
      '';


    if (
      (
        rawAction !== 'start' &&
        rawAction !== 'stop' &&
        rawAction !== 'remove'
      ) ||
      !walletName
    ) {
      return;
    }


    void runAction(
      button,
      rawAction,
      walletName
    );
  }


  root.addEventListener(
    'click',
    clickHandler
  );


  return () => {

    destroyed =
      true;

    controller.abort();

    root.removeEventListener(
      'click',
      clickHandler
    );
  };
}
