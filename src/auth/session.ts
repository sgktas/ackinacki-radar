export const SESSION_STORAGE_KEY =
  'radar_session';

type TelegramMiniAppWindow = Window & {
  Telegram?: {
    WebApp?: {
      initData?: string;
      ready?: () => void;
      expand?: () => void;
    };
  };
};

export async function bootstrapTelegramMiniAppSession():
  Promise<boolean> {

  const webApp =
    (window as TelegramMiniAppWindow).Telegram?.WebApp;

  if (!webApp) {
    return false;
  }

  webApp.ready?.();
  webApp.expand?.();

  const initData =
    String(webApp.initData || '').trim();

  if (!initData) {
    return Boolean(readSessionToken());
  }

  try {
    const response = await fetch(
      '/api/auth/telegram/mini-app',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ initData }),
        cache: 'no-store',
      }
    );

    if (!response.ok) {
      return Boolean(readSessionToken());
    }

    const data = await response.json() as {
      ok?: boolean;
      token?: string;
    };

    if (!data.ok || !data.token) {
      return Boolean(readSessionToken());
    }

    writeSessionToken(data.token);
    return true;
  } catch {
    return Boolean(readSessionToken());
  }
}

export type TelegramAuthFragment =
  | {
      kind: 'none';
    }
  | {
      kind: 'token';
      token: string;
      username: string | null;
    }
  | {
      kind: 'error';
      error: string;
    };


export type DashboardMiningHealth = {
  available?: boolean;

  status?:
    | 'healthy'
    | 'warning'
    | 'critical'
    | 'idle';

  scope?: 'cycle';

  windowHours?:
    number | null;

  total?: number;
  confirmed?: number;

  healthy?: number;
  recovered?: number;
  pending?: number;
  lost?: number;

  claimIssues?: number;

  successRate?:
    number | null;

  primaryIssue?: {
    code?:
      | 'producer_queue_congestion'
      | 'submission_proof_missing'
      | 'chain_confirmation_timeout'
      | 'session_rejected'
      | 'sdk_error'
      | 'claim_failed';

    count?: number;
  } | null;

  issueCounts?:
    Record<string, number>;

  latest?: Array<{
    at?: string;

    minerId?: string;
    walletName?: string;

    epoch5mStart?:
      string | number;

    status?:
      | 'healthy'
      | 'recovered'
      | 'pending'
      | 'lost';

    issueCode?:
      | 'producer_queue_congestion'
      | 'submission_proof_missing'
      | 'chain_confirmation_timeout'
      | 'session_rejected'
      | 'sdk_error'
      | 'claim_failed'
      | null;

    taps?:
      number | null;

    tapDelta?:
      number | null;

    retries?: number;

    retryMode?: string;

    settlement?: string;

    rejected?: boolean;

    queueOverflowRetriesObserved?: number;
    queueOverflowExhaustedObserved?: number;

    claim?:
      | 'none'
      | 'queued'
      | 'failed'
      | 'collected';
  }>;
};


export type DashboardRewardRow = {
  amount?:
    number | string;

  at?: string;

  walletName?: string;

  [key: string]:
    unknown;
};


export type DashboardMeData = {
  ok?: boolean;

  miners?: Array<{
    walletName?: string;
    status?: string;

    lastSessionAt?: string | null;
    lastSessionStartedAt?: string | null;

    lastTapsSent?: number | null;
    lastRewardAt?: string | null;
    lastError?: string | null;

    tapSum?: number | null;
    tapSumAt?: string | null;

    epoch5mStart?: number | null;
    epoch5mChangedAt?: string | null;

    sessionEpoch5mStart?: number | null;
    sessionEpochStatus?: string | null;

    claimedEpoch5mStart?: number | null;
    cycleEpochCount?: number;

    rewardLastChainReadAt?: string | null;
  }>;

  subscription?: {
    planId?: string;
    activeUntil?: string;
  } | null;

  plans?: Array<{
    id?: string;
    label?: string;
    days?: number;
    priceUsd?: number;
    priceShellRaw?: string;
    priceNackl?: string;
    stars?: number;
    starsPriceUsd?: number;
  }>;

  miningHealth?: DashboardMiningHealth;
  referral?: unknown;

  rewards?: DashboardRewardRow[];

  rewardCycle?: {
    totalNackl?: number;
    count?: number;
    partial?: boolean;
  } | null;

  epochClock?: unknown;

  cycle?: {
    tapCap?: number;
    hours?: number;
    tapsPerSession?: number;
    sessionIntervalSeconds?: number;
  };

  rewardFeedPollSeconds?: number;
};

export type DashboardAuthResult =
  | {
      kind: 'anonymous';
    }
  | {
      kind: 'authenticated';
      data: DashboardMeData;
    }
  | {
      kind: 'unauthorized';
    }
  | {
      kind: 'error';
      status: number | null;
      message: string;
    };


export function readSessionToken():
  string | null {

  const raw =
    window.localStorage.getItem(
      SESSION_STORAGE_KEY
    );

  if (!raw) {
    return null;
  }

  const token =
    raw.trim();

  return token || null;
}


export function writeSessionToken(
  token: string,
): void {

  const clean =
    token.trim();

  if (!clean) {
    return;
  }

  window.localStorage.setItem(
    SESSION_STORAGE_KEY,
    clean
  );
}


export function clearSessionToken():
  void {

  window.localStorage.removeItem(
    SESSION_STORAGE_KEY
  );
}



// GLOBAL_PENDING_REFERRAL_BIND_20260815
//
// A referral link is captured on /referrals before Telegram login.
// Production OIDC returns to a protected application route, so the
// stored referral must be bound as soon as the Telegram session token
// is received. /referrals keeps its existing richer binder/UI; this
// fallback intentionally skips that route to avoid duplicate requests.
const GLOBAL_PENDING_REFERRAL_STORAGE_KEY =
  'radar_pending_referral';

const GLOBAL_PENDING_REFERRAL_PERMANENT_ERRORS =
  new Set<string>([
    'INVALID_REFERRAL_CODE',
    'REFERRAL_CODE_NOT_FOUND',
    'SELF_REFERRAL_NOT_ALLOWED',
    'REFERRAL_ALREADY_BOUND',
    'REFERRAL_BIND_TOO_LATE',
  ]);


async function bindPendingReferralAfterAuth(
  token: string,
): Promise<void> {

  if (
    window.location.pathname ===
    '/referrals'
  ) {
    return;
  }


  const code =
    String(
      window.localStorage.getItem(
        GLOBAL_PENDING_REFERRAL_STORAGE_KEY
      ) ||
      ''
    ).trim();


  if (!code) {
    return;
  }


  try {

    const response =
      await fetch(
        '/api/dashboard/referral/bind',
        {
          method:
            'POST',

          headers: {
            Authorization:
              `Bearer ${token}`,

            'Content-Type':
              'application/json',
          },

          body:
            JSON.stringify({
              code,
            }),

          cache:
            'no-store',
        }
      );


    let payload: {
      ok?: boolean;
      error?: string;
    } = {};


    try {

      payload =
        await response.json() as {
          ok?: boolean;
          error?: string;
        };

    } catch {
      payload = {};
    }


    if (
      response.ok &&
      payload.ok
    ) {

      window.localStorage.removeItem(
        GLOBAL_PENDING_REFERRAL_STORAGE_KEY
      );

      return;
    }


    const error =
      String(
        payload.error ||
        ''
      );


    if (
      GLOBAL_PENDING_REFERRAL_PERMANENT_ERRORS.has(
        error
      )
    ) {

      window.localStorage.removeItem(
        GLOBAL_PENDING_REFERRAL_STORAGE_KEY
      );
    }

  } catch {

    /*
     * Network/transient errors deliberately leave the referral code
     * in localStorage so the existing /referrals flow can retry it.
     */
  }
}


export function consumeTelegramAuthFragment():
  TelegramAuthFragment {

  const raw =
    window.location.hash.replace(
      /^#/,
      ''
    );

  if (!raw) {
    return {
      kind: 'none',
    };
  }

  const params =
    new URLSearchParams(
      raw
    );

  const token =
    params.get(
      'tg_token'
    );

  const error =
    params.get(
      'tg_error'
    );

  /*
   * Other hashes do not belong to auth.
   */
  if (!token && !error) {
    return {
      kind: 'none',
    };
  }

  /*
   * Remove credentials/error details immediately.
   *
   * A refresh, copy/paste or shared URL must not
   * replay the auth result.
   */
  window.history.replaceState(
    null,
    '',
    window.location.pathname +
      window.location.search
  );

  if (error) {
    return {
      kind: 'error',
      error,
    };
  }

  if (!token) {
    return {
      kind: 'none',
    };
  }

  writeSessionToken(
    token
  );

  
  void bindPendingReferralAfterAuth(
    token
  );

return {
    kind: 'token',
    token,
    username:
      params.get(
        'tg_user'
      ),
  };
}


export function authHeaders():
  Record<string, string> {

  const token =
    readSessionToken();

  if (!token) {
    return {};
  }

  return {
    Authorization:
      `Bearer ${token}`,
  };
}


export async function fetchDashboardMe(
  signal?: AbortSignal,
): Promise<DashboardAuthResult> {

  const token =
    readSessionToken();

  if (!token) {
    return {
      kind: 'anonymous',
    };
  }

  try {

    const response =
      await fetch(
        '/api/dashboard/me',
        {
          method: 'GET',

          headers: {
            Authorization:
              `Bearer ${token}`,
          },

          cache:
            'no-store',

          signal,
        }
      );

    if (
      response.status === 401
    ) {
      clearSessionToken();

      return {
        kind: 'unauthorized',
      };
    }

    if (!response.ok) {

      return {
        kind: 'error',
        status:
          response.status,
        message:
          `HTTP ${response.status}`,
      };
    }

    const data = (await response.json()) as DashboardMeData;

    if (!data.ok) {
      return {
        kind: 'error',
        status:
          response.status,
        message:
          'INVALID_DASHBOARD_RESPONSE',
      };
    }

    return {
      kind: 'authenticated',
      data,
    };

  } catch (error) {

    if (
      error instanceof DOMException &&
      error.name === 'AbortError'
    ) {
      throw error;
    }

    return {
      kind: 'error',
      status: null,
      message:
        error instanceof Error
          ? error.message
          : String(error),
    };
  }
}
