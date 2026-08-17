const ACKI_MAINNET_GRAPHQL_URL =
  process.env.ACKI_MAINNET_GRAPHQL_URL || "https://mainnet.ackinacki.org/graphql";
const ackiGraphqlTimeoutFromEnv = Number(process.env.ACKI_GRAPHQL_TIMEOUT_MS || 12_000);
const ACKI_GRAPHQL_TIMEOUT_MS = Number.isFinite(ackiGraphqlTimeoutFromEnv)
  ? Math.min(60_000, Math.max(2_000, ackiGraphqlTimeoutFromEnv))
  : 12_000;
// Fix: mininghub.ackinacki.com removed as a data source.

const ACCOUNT_HEX_PATTERN = /^[a-fA-F0-9]{64}$/;
const WALLET_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

const ACKI_INDEXER_CODE = "te6ccgECIwEABTUABCSK7VMg4wMgwP/jAiDA/uMC8gseAwEiArSNCGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAT4aSHbPNMAAY4igwjXGCD4KMjOzsn5AAHTAAGU0/9QM5MC+ELiIPhl+RDyqJXTAAHyeuLTPwEcAgFO+EMhufK0IPgjgQPoqIIIG3dAoLnytPhj0x8B+CO88rnTHwHbPPI8BANa7UTQgQFA1yHXCgD4ZiLQ0wP6QDD4aak4ANwhxwDjAiHXDR/yvCHjAwHbPPI8HR0EBFAgghAxmusDu+MCIIIQQ/WwObvjAiCCEEqi0HG64wIgghBqk6xjuuMCEQkHBQN+MPhG8uBM+EJu4wAhk9TR0N76QNTU0//U0z/U0dDU1NM/0wfU1NHQ1NTT/9TT/9TR0NT0BNP/+kDR2zzbPPIAHAYYAfD4RSBukjBw3vhNuvLhkvgA2zyAE2H4a4ASYoAScGR/+EqAFGHIz4WIzo0EkBfXhAAAAAAAAAAAAAAAAAAADM8WgBRiyM+QCdUYYszKAMzMy/9V4MjMyz/MzMs/ywdVgMjMzMzL/1VAyMzL/8z0AMv/zc3Nzclx+wANAzQw+Eby4Ez4Qm7jACGT1NHQ3vpA0ds82zzyABwIGAAa+En4S8cF8uGX+AD4awIoIIIQP9hWVbrjAiCCEEP1sDm64wIOCgN+MPhG8uBM+EJu4wAhk9TR0N76QNTU0//U0z/U0dDU1NM/0wfU1NHQ1NTT/9TT/9TR0NT0BNP/03/R2zzjAPIAHAsTAvT4ACDC//LhmiCBA+i58uGagvAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAaDIz4oAQMv/ydD4SccF8uGX2zz4S4ATYccFgBJigBJwZIASYfhK+EnIz4WIzo0EkBfXhAAAAAAAAAAAAAAAAAAADM8WgBRiyA0MAGjPkAnVGGLMygDMzMv/VeDIzMs/zMzLP8sHVYDIzMzMy/9VQMjMy//M9ADL/83Nzc3JcfsAACz4J28QghgXSHboALzcghgXSHboAMcoAmIw+Eby4EzR2zwijh4k0NMB+kAwMcjPhyDOgGLPQBLPkv9hWVbMzMlw+wCRW+LjAPIADxMCBIiIIBAADkluZGV4ZXIDMiDAAeMCIIIQH2q/6rrjAiCCEDGa6wO64wIXFRIDcDD4RvLgTPhCbuMA0ds8Io4gJNDTAfpAMDHIz4cgznHPC2ECyM+SxmusDszOzclw+wCRW+LjAPIAHBQTACjtRNDT/9M/MfhDWMjL/8s/zsntVAAI+Er4SwMkMPhG8uBM+EJu4wDR2zzbPPIAHBYYADj4SfgoxwXy4Zf4APgoyM+FCM6Ac89AyYEAoPsABPgw+EJu4wD4RvJzIZPU0dDe+kDT/9N/1NHQ+kDR+AD4Kts8IG7yf9DU0Yj5AAH5ALry4Zf4bFj4awH4bYLwIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGgyM+KAEDL/8nQ+En4TMcFmPhJIccF8uGX3zDbPPIAHBkgGAA8+E34TPhL+Er4Q/hCyMv/yz/Pg8zOWcjOy//Nye1UAhjQIIs4rbNYxwWKiuIaGwEK103Q2zwbAEjXTNCLL0pA1yb0BDHTCTGLX0vfLATo1yYg10rCAZLXTZIwbeIARO1E0NP/0z/TANT6QNTR0PpA0//R+G34bPhr+Gr4Zvhj+GIACvhG8uBMAxD0pCD0vfLATiIhHwEAIAAKMS4wLjAAFHNvbCAwLjc5LjMAAA==";
const ACKI_INDEXER_ABI = {
    "ABI version": 2,
    version: "2.4",
    header: ["pubkey", "time", "expire"],
    functions: [{
        name: "constructor",
        inputs: [{
            name: "wallet",
            type: "address"
        }, {
            name: "rootPubkey",
            type: "uint256"
        }, {
            name: "index",
            type: "uint128"
        }, {
            name: "root",
            type: "address"
        }],
        outputs: []
    }, {
        name: "isOwner",
        inputs: [{
            name: "wallet",
            type: "address"
        }, {
            name: "zkid",
            type: "string"
        }, {
            name: "proof",
            type: "bytes"
        }, {
            name: "epk",
            type: "uint256"
        }, {
            name: "epk_sig",
            type: "bytes"
        }, {
            name: "epk_expire_at",
            type: "uint64"
        }, {
            name: "jwk_modulus",
            type: "bytes"
        }, {
            name: "kid",
            type: "bytes"
        }, {
            name: "jwk_modulus_expire_at",
            type: "uint64"
        }, {
            name: "index_mod_4",
            type: "uint8"
        }, {
            name: "iss_base_64",
            type: "string"
        }, {
            name: "provider",
            type: "string"
        }, {
            name: "header_base_64",
            type: "string"
        }, {
            name: "pub_recovery_key",
            type: "uint256"
        }, {
            name: "pub_recovery_key_sig",
            type: "bytes"
        }, {
            name: "jwk_update_key",
            type: "uint256"
        }, {
            name: "jwk_update_key_sig",
            type: "bytes"
        }, {
            name: "root_provider_certificates",
            type: "map(uint256,bytes)"
        }, {
            name: "owner_pubkey",
            type: "uint256"
        }, {
            name: "index",
            type: "uint128"
        }],
        outputs: []
    }, {
        name: "isOwnerRoot",
        inputs: [{
            name: "wallet",
            type: "address"
        }, {
            name: "zkid",
            type: "string"
        }, {
            name: "proof",
            type: "bytes"
        }, {
            name: "epk",
            type: "uint256"
        }, {
            name: "epk_sig",
            type: "bytes"
        }, {
            name: "epk_expire_at",
            type: "uint64"
        }, {
            name: "jwk_modulus",
            type: "bytes"
        }, {
            name: "kid",
            type: "bytes"
        }, {
            name: "jwk_modulus_expire_at",
            type: "uint64"
        }, {
            name: "index_mod_4",
            type: "uint8"
        }, {
            name: "iss_base_64",
            type: "string"
        }, {
            name: "provider",
            type: "string"
        }, {
            name: "header_base_64",
            type: "string"
        }, {
            name: "pub_recovery_key",
            type: "uint256"
        }, {
            name: "pub_recovery_key_sig",
            type: "bytes"
        }, {
            name: "jwk_update_key",
            type: "uint256"
        }, {
            name: "jwk_update_key_sig",
            type: "bytes"
        }, {
            name: "root_provider_certificates",
            type: "map(uint256,bytes)"
        }, {
            name: "owner_pubkey",
            type: "uint256"
        }, {
            name: "mirror",
            type: "address"
        }],
        outputs: []
    }, {
        name: "setNewWallet",
        inputs: [{
            name: "wallet",
            type: "address"
        }],
        outputs: []
    }, {
        name: "destroyNode",
        inputs: [],
        outputs: []
    }, {
        name: "getDetails",
        inputs: [],
        outputs: [{
            name: "name",
            type: "string"
        }, {
            name: "wallet",
            type: "address"
        }]
    }, {
        name: "getVersion",
        inputs: [],
        outputs: [{
            name: "value0",
            type: "string"
        }, {
            name: "value1",
            type: "string"
        }]
    }],
    events: [],
    fields: [{
        init: !0,
        name: "_pubkey",
        type: "uint256"
    }, {
        init: !1,
        name: "_timestamp",
        type: "uint64"
    }, {
        init: !1,
        name: "_constructorFlag",
        type: "bool"
    }, {
        init: !0,
        name: "_name",
        type: "string"
    }, {
        init: !1,
        name: "_wallet",
        type: "address"
    }, {
        init: !1,
        name: "_root",
        type: "address"
    }, {
        init: !1,
        name: "_rootPubkey",
        type: "uint256"
    }]
};

const ACKI_POPIT_GAME_CODE = "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";
const ACKI_POPIT_GAME_ABI = {
    "ABI version": 2,
    version: "2.4",
    header: ["pubkey", "time", "expire"],
    functions: [{
        name: "constructor",
        inputs: [{
            name: "code",
            type: "map(uint8,cell)"
        }, {
            name: "root_pubkey",
            type: "uint256"
        }, {
            name: "index",
            type: "uint128"
        }],
        outputs: []
    }, {
        name: "addValuePopit",
        inputs: [{
            name: "name",
            type: "string"
        }, {
            name: "id",
            type: "uint256"
        }, {
            name: "value",
            type: "uint64"
        }],
        outputs: []
    }, {
        name: "popCoinRootDeployed",
        inputs: [{
            name: "name",
            type: "string"
        }],
        outputs: []
    }, {
        name: "popCoinWalletDeployed",
        inputs: [{
            name: "name",
            type: "string"
        }],
        outputs: []
    }, {
        name: "setMbiCur",
        inputs: [{
            name: "mbiCur",
            type: "uint64"
        }],
        outputs: []
    }, {
        name: "deployPopCoinWallet",
        inputs: [{
            name: "name",
            type: "string"
        }, {
            name: "value",
            type: "uint64"
        }],
        outputs: []
    }, {
        name: "deployPopCoinWalletOldTransfer",
        inputs: [{
            name: "name",
            type: "string"
        }, {
            name: "value",
            type: "uint64"
        }],
        outputs: []
    }, {
        name: "withdraw",
        inputs: [{
            name: "value",
            type: "uint128"
        }, {
            name: "to",
            type: "address"
        }],
        outputs: []
    }, {
        name: "getPopCoinWalletAddress",
        inputs: [{
            name: "name",
            type: "string"
        }],
        outputs: [{
            name: "popCoinWalletAddress",
            type: "address"
        }]
    }, {
        name: "getDetails",
        inputs: [],
        outputs: [{
            name: "owner",
            type: "address"
        }, {
            name: "root",
            type: "address"
        }, {
            name: "startTime",
            type: "uint32"
        }, {
            name: "mbiCur",
            type: "uint64"
        }, {
            name: "boost",
            type: "address"
        }, {
            name: "rewards",
            type: "uint128"
        }, {
            name: "minstake",
            type: "uint128"
        }]
    }, {
        name: "getVersion",
        inputs: [],
        outputs: [{
            name: "value0",
            type: "string"
        }, {
            name: "value1",
            type: "string"
        }]
    }],
    events: [{
        name: "PopCoinRootReceived",
        inputs: [{
            name: "name",
            type: "string"
        }],
        outputs: []
    }, {
        name: "PopCoinWalletReceived",
        inputs: [{
            name: "name",
            type: "string"
        }],
        outputs: []
    }],
    fields: [{
        init: !0,
        name: "_pubkey",
        type: "uint256"
    }, {
        init: !1,
        name: "_timestamp",
        type: "uint64"
    }, {
        init: !1,
        name: "_constructorFlag",
        type: "bool"
    }, {
        init: !1,
        name: "_code",
        type: "map(uint8,cell)"
    }, {
        init: !0,
        name: "_owner",
        type: "address"
    }, {
        init: !1,
        name: "_mbiCur",
        type: "uint64"
    }, {
        init: !1,
        name: "_root",
        type: "address"
    }, {
        init: !1,
        name: "_startTime",
        type: "uint32"
    }, {
        init: !1,
        name: "_root_pubkey",
        type: "uint256"
    }, {
        init: !1,
        name: "_boost",
        type: "address"
    }, {
        init: !1,
        name: "_rewards",
        type: "uint128"
    }]
};

type AckiNetworkStats = {
  source: "acki-mainnet-graphql";
  latestBlock: number;
  latestBlockHash: string;
  latestBlockTime: number | null;
  // Measured over a window of recent blocks rather than reported by the node,
  // so it moves around a bit between samples — that is real throughput
  // variance, not a bug.
  tps: number | null;
  blocksPerSecond: number | null;
  avgBlockTimeSeconds: number | null;
  windowTransactions: number | null;
  windowSeconds: number | null;
  windowBlocks: number | null;
  epoch: null;
  updatedAt: string;
  cached: boolean;
};

type AckiTokenBalance = {
  currency: number;
  symbol: string;
  balanceRaw: string;
  balanceFormatted: string;
  decimals: number;
};

type AckiPopitDecodedState = {
  mbiCur: string | null;
  rewards: string | null;
  startTime: string | null;
  boost: string | null;
};

type AckiLinkedPopitGame = {
  address: string;
  accountId: string;
  dappId: string;
  codeHash: string | null;
  balanceRaw: string;
  lockedTokens: AckiTokenBalance[];
  mamaboardLevel: string | null;
  decodedState: AckiPopitDecodedState | null;
  lastPaid: number | null;
  lastTransactionLt: string | null;
};

type AckiMiningStats = {
  source: "mininghub-miner-stats";
  walletName: string;
  currentTaps: number | null;
  tapHistory: Array<{ date: string; taps: number }>;
  lockedNackl: number | null;
  lockedUpdatedAt: string | null;
  updatedAt: string;
};

type AckiWalletResolution = {
  input: string;
  inputType: "address" | "name";
  address: string;
  accountId: string;
  dappId: string;
  name: string | null;
  indexerAddress: string | null;
};

type AckiWalletActivity = {
  source: "acki-mainnet-graphql" | "acki-mainnet-graphql-popit-only";
  input: string;
  inputType: "address" | "name";
  name: string | null;
  address: string;
  accountId: string;
  dappId: string;
  indexerAddress: string | null;
  balanceRaw: string;
  nativeBalanceFormatted: string;
  tokens: AckiTokenBalance[];
  lockedTokens: AckiTokenBalance[];
  popitGame: AckiLinkedPopitGame | null;
  miningStats: AckiMiningStats | null;
  mamaboardLevel: string | null;
  lastPaid: number | null;
  lastTransactionLt: string | null;
  latestTransaction: {
    id: string;
    lt: string | null;
  } | null;
  updatedAt: string;
  cached: boolean;
};

let networkCache:
  | {
      expiresAt: number;
      data: AckiNetworkStats;
    }
  | null = null;

const walletCache = new Map<
  string,
  {
    expiresAt: number;
    data: AckiWalletActivity;
  }
>();

const nameResolutionCache = new Map<
  string,
  {
    expiresAt: number;
    data: AckiWalletResolution;
  }
>();

const miningStatsCache = new Map<
  string,
  {
    expiresAt: number;
    data: AckiMiningStats | null;
  }
>();

let tvmClientPromise: Promise<any> | null = null;
let tvmLibraryReady = false;

const NETWORK_CACHE_MS = 30 * 1000;
const WALLET_CACHE_MS = 30 * 1000;
const NAME_RESOLUTION_CACHE_MS = 5 * 60 * 1000;
const MINING_STATS_CACHE_MS = 60 * 1000;

const TOKEN_METADATA: Record<number, { symbol: string; decimals: number }> = {
  1: { symbol: "NACKL", decimals: 9 },
  2: { symbol: "SHELL", decimals: 9 },
  3: { symbol: "USDC", decimals: 6 },
};

function toFiniteNumber(value: unknown): number | null {
  const numberValue = typeof value === "number" ? value : Number(value);

  return Number.isFinite(numberValue) ? numberValue : null;
}

// Fix: mininghub REST API removed as a data source (unreliable). Kept as a
// no-op stub only so any leftover references don't crash; it always returns
// null and never makes a network call.
async function getAckiMiningStats(_walletName: string | null): Promise<AckiMiningStats | null> {
  return null;
}

async function postAckiGraphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  let response: Response;

  try {
    response = await fetch(ACKI_MAINNET_GRAPHQL_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query,
        variables,
      }),
      signal: AbortSignal.timeout(ACKI_GRAPHQL_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
      throw new Error(`Acki mainnet GraphQL timed out after ${ACKI_GRAPHQL_TIMEOUT_MS}ms`);
    }

    throw error;
  }

  if (!response.ok) {
    throw new Error("Acki mainnet GraphQL request failed: " + response.status);
  }

  const json: any = await response.json();

  if (json?.errors?.length) {
    const message = json.errors
      .map((item: any) => item?.message)
      .filter(Boolean)
      .join(" | ");

    throw new Error(message || "Acki mainnet GraphQL returned an error");
  }

  return json as T;
}

function normalizeHexAddressInput(input: string) {
  const value = String(input || "").trim();
  const accountId = value.startsWith("0:") ? value.slice(2) : value;

  if (!ACCOUNT_HEX_PATTERN.test(accountId)) {
    return null;
  }

  const lowerAccountId = accountId.toLowerCase();

  return {
    address: "0:" + lowerAccountId,
    accountId: lowerAccountId,
    dappId: lowerAccountId,
  };
}

function normalizeNameInput(input: string) {
  const value = String(input || "").trim().replace(/^@/, "").toLowerCase();

  if (!WALLET_NAME_PATTERN.test(value)) {
    throw new Error("INVALID_ACKI_WALLET_INPUT");
  }

  return value;
}

function normalizeCurrencyId(value: unknown) {
  const numberValue = Number(value);

  return Number.isFinite(numberValue) ? Math.trunc(numberValue) : 0;
}

function formatTokenAmount(rawValue: string, decimals: number) {
  const raw = String(rawValue || "0").trim();

  if (!/^\d+$/.test(raw)) {
    return raw || "0";
  }

  const value = BigInt(raw);
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "");

  return fraction ? `${whole.toString()}.${fraction}` : whole.toString();
}

function mapTokenBalances(balanceOther: any): AckiTokenBalance[] {
  if (!Array.isArray(balanceOther)) {
    return [];
  }

  return balanceOther
    .map((item: any) => {
      const currency = normalizeCurrencyId(item?.currency);
      const metadata = TOKEN_METADATA[currency] || {
        symbol: "Currency " + String(currency || "?"),
        decimals: 9,
      };
      const balanceRaw = String(item?.value || "0");

      return {
        currency,
        symbol: metadata.symbol,
        balanceRaw,
        balanceFormatted: formatTokenAmount(balanceRaw, metadata.decimals),
        decimals: metadata.decimals,
      };
    })
    .filter((item) => item.balanceRaw !== "0" || Boolean(TOKEN_METADATA[item.currency]));
}

async function getTvmClient() {
  if (!tvmClientPromise) {
    tvmClientPromise = (async () => {
      try {
        const core = await import("@eversdk/core");
        const libNodeModule = await import("@eversdk/lib-node");
        const TonClient = (core as any).TonClient;
        const libNode = (libNodeModule as any).libNode || (libNodeModule as any).default;

        if (!tvmLibraryReady) {
          TonClient.useBinaryLibrary(libNode);
          tvmLibraryReady = true;
        }

        return new TonClient({ network: { endpoints: [ACKI_MAINNET_GRAPHQL_URL] } });
      } catch (error) {
        tvmClientPromise = null;
        throw new Error("ACKI_NAME_RESOLUTION_SDK_UNAVAILABLE");
      }
    })();
  }

  return tvmClientPromise;
}

async function getIndexerAddressByName(name: string) {
  const client = await getTvmClient();
  const encoded = await client.abi.encode_message({
    abi: {
      type: "Contract",
      value: ACKI_INDEXER_ABI,
    },
    deploy_set: {
      code: ACKI_INDEXER_CODE,
      initial_data: {
        _pubkey: "0x0",
        _name: name,
      },
    },
    signer: {
      type: "None",
    },
  });

  if (!encoded?.address) {
    throw new Error("ACKI_NAME_RESOLUTION_FAILED");
  }

  return String(encoded.address);
}

async function resolveMvFromIndexerAddress(indexerAddress: string) {
  const normalizedIndexer = normalizeHexAddressInput(indexerAddress);

  if (!normalizedIndexer) {
    throw new Error("ACKI_NAME_RESOLUTION_FAILED");
  }

  const query = `
    query GetIndexerData($accountId: String!, $dappId: String!) {
      blockchain {
        account(account_id: $accountId, dapp_id: $dappId) {
          info {
            data
          }
        }
      }
    }
  `;

  const json = await postAckiGraphql<any>(query, {
    accountId: normalizedIndexer.accountId,
    dappId: normalizedIndexer.dappId,
  });
  const data = json?.data?.blockchain?.account?.info?.data;

  if (!data) {
    throw new Error("ACKI_NAME_NOT_FOUND");
  }

  const client = await getTvmClient();
  const decoded = await client.abi.decode_account_data({
    abi: {
      type: "Contract",
      value: ACKI_INDEXER_ABI,
    },
    data,
    allow_partial: true,
  });
  const walletAddress = decoded?.data?._wallet;

  if (!walletAddress) {
    throw new Error("ACKI_NAME_NOT_FOUND");
  }

  return String(walletAddress);
}

async function resolveAckiWalletInput(input: string): Promise<AckiWalletResolution> {
  const rawInput = String(input || "").trim();
  const normalizedAddress = normalizeHexAddressInput(rawInput);

  if (normalizedAddress) {
    return {
      input: rawInput,
      inputType: "address",
      name: null,
      indexerAddress: null,
      ...normalizedAddress,
    };
  }

  const name = normalizeNameInput(rawInput);
  const now = Date.now();
  const cached = nameResolutionCache.get(name);

  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  const indexerAddress = await getIndexerAddressByName(name);
  const walletAddress = await resolveMvFromIndexerAddress(indexerAddress);
  const resolvedAddress = normalizeHexAddressInput(walletAddress);

  if (!resolvedAddress) {
    throw new Error("ACKI_NAME_RESOLUTION_FAILED");
  }

  const data: AckiWalletResolution = {
    input: rawInput,
    inputType: "name",
    name,
    indexerAddress,
    ...resolvedAddress,
  };

  nameResolutionCache.set(name, {
    expiresAt: now + NAME_RESOLUTION_CACHE_MS,
    data,
  });

  return data;
}


async function getPopitGameAddress(ownerAddress: string) {
  const client = await getTvmClient();
  const encoded = await client.abi.encode_message({
    abi: {
      type: "Contract",
      value: ACKI_POPIT_GAME_ABI,
    },
    deploy_set: {
      code: ACKI_POPIT_GAME_CODE,
      initial_data: {
        _pubkey: "0x0",
        _owner: ownerAddress,
      },
    },
    signer: {
      type: "None",
    },
  });

  return encoded?.address ? String(encoded.address) : null;
}

// NOTE: kept for reference / potential future use, but NOT currently called
// anywhere — this specific mainnet endpoint returns "Deprecated API is
// disabled" for the root accounts(filter:{id:{in:[...]}}) query described in
// Ackinacki's docs, even though the docs present it as supported. If a
// working batch/multi-account endpoint is confirmed later, this is the
// intended integration point.
export type AckiAccountBatchInfo = {
  id: string;
  balanceRaw: string | null;
  lastPaid: number | null;
  lastTransLt: string | null;
};

// Scaling fix: mainnet.ackinacki.org supports batching MANY account lookups
// into ONE request via accounts(filter:{id:{in:[...]}}) — but per the docs,
// this batch endpoint can only return balance/last_paid/last_trans_lt, NOT
// the raw contract data (BOC) needed to decode locked NACKL. So this is used
// as a cheap "did anything change" pre-check across ALL watched wallets in
// 1-2 requests total; only wallets whose last_trans_lt actually changed then
// get the expensive per-account getAckiPopitGameSummary call. This lets the
// monitor check every wallet every tick instead of rotating through a
// handful, without multiplying the request count.
export async function getAckiAccountsBatchInfo(
  ids: string[],
): Promise<Map<string, AckiAccountBatchInfo>> {
  const result = new Map<string, AckiAccountBatchInfo>();
  const unique = Array.from(
    new Set(ids.map((id) => String(id || "").trim()).filter(Boolean)),
  );

  if (!unique.length) {
    return result;
  }

  const CHUNK_SIZE = 50;

  for (let i = 0; i < unique.length; i += CHUNK_SIZE) {
    const chunk = unique.slice(i, i + CHUNK_SIZE);
    const query = `
      query GetAccountsBatchInfo($ids: [String!]) {
        accounts(filter: { id: { in: $ids } }) {
          id
          balance(format: DEC)
          last_paid
          last_trans_lt(format: DEC)
        }
      }
    `;

    const json = await postAckiGraphql<any>(query, { ids: chunk });
    const accounts = Array.isArray(json?.data?.accounts)
      ? json.data.accounts
      : [];

    for (const acc of accounts) {
      if (!acc?.id) continue;

      const normalizedId = String(acc.id).trim().toLowerCase();
      result.set(normalizedId, {
        id: String(acc.id),
        balanceRaw: acc.balance != null ? String(acc.balance) : null,
        lastPaid: typeof acc.last_paid === "number" ? acc.last_paid : null,
        lastTransLt:
          acc.last_trans_lt != null ? String(acc.last_trans_lt) : null,
      });
    }
  }

  return result;
}

async function getAckiPopitGameSummary(ownerAddress: string): Promise<AckiLinkedPopitGame | null> {
  try {
    const popitAddress = await getPopitGameAddress(ownerAddress);

    if (!popitAddress) {
      return null;
    }

    const normalizedPopit = normalizeHexAddressInput(popitAddress);

    if (!normalizedPopit) {
      return null;
    }

    const query = `
      query GetPopitGameAccount($accountId: String!, $dappId: String!) {
        blockchain {
          account(account_id: $accountId, dapp_id: $dappId) {
            info {
              balance(format: DEC)
              balance_other {
                currency
                value(format: DEC)
              }
              code_hash
              data
              last_paid
              last_trans_lt(format: DEC)
            }
          }
        }
      }
    `;

    const json = await postAckiGraphql<any>(query, {
      accountId: normalizedPopit.accountId,
      dappId: normalizedPopit.dappId,
    });
    const info = json?.data?.blockchain?.account?.info;

    if (!info) {
      return null;
    }

    let mamaboardLevel: string | null = null;
    let decodedState: AckiPopitDecodedState | null = null;

    if (info.data) {
      try {
        const client = await getTvmClient();
        const decoded = await client.abi.decode_account_data({
          abi: {
            type: "Contract",
            value: ACKI_POPIT_GAME_ABI,
          },
          data: info.data,
          allow_partial: true,
        });
        const decodedData = decoded?.data || {};
        const mbiCur = decodedData?._mbiCur;

        if (mbiCur !== null && mbiCur !== undefined) {
          mamaboardLevel = String(mbiCur);
        }

        decodedState = {
          mbiCur: mbiCur === null || mbiCur === undefined ? null : String(mbiCur),
          rewards:
            decodedData?._rewards === null || decodedData?._rewards === undefined
              ? null
              : String(decodedData._rewards),
          startTime:
            decodedData?._startTime === null || decodedData?._startTime === undefined
              ? null
              : String(decodedData._startTime),
          boost:
            decodedData?._boost === null || decodedData?._boost === undefined
              ? null
              : String(decodedData._boost),
        };
      } catch {
        mamaboardLevel = null;
        decodedState = null;
      }
    }

    return {
      address: normalizedPopit.address,
      accountId: normalizedPopit.accountId,
      dappId: normalizedPopit.dappId,
      codeHash: info.code_hash ? String(info.code_hash) : null,
      balanceRaw: String(info.balance || "0"),
      lockedTokens: mapTokenBalances(info.balance_other),
      mamaboardLevel,
      decodedState,
      lastPaid: typeof info.last_paid === "number" ? info.last_paid : null,
      lastTransactionLt:
        info.last_trans_lt === null || info.last_trans_lt === undefined
          ? null
          : String(info.last_trans_lt),
    };
  } catch (error) {
    // Fix: previously this caught *everything*, including 429/rate-limit and
    // network-level failures from the mainnet GraphQL call above, and turned
    // them all into a silent `null`. Upstream that null becomes the generic
    // "POPIT_LOCKED_SOURCE_UNAVAILABLE" error, which hid real rate-limit hits
    // behind a misleading label and meant those specific failures never
    // triggered the monitor's rate-limit backoff. Rate-limit/network errors
    // now rethrow so the caller can detect and back off correctly; only
    // genuinely benign lookup failures (e.g. malformed address) still return
    // null.
    const message = error instanceof Error ? error.message : String(error);

    if (/\b429\b|rate limit|too many requests|\b5\d\d\b|timed out|ECONNRESET|ETIMEDOUT/i.test(message)) {
      throw error;
    }

    return null;
  }
}

export async function getAckiNetworkStats(): Promise<AckiNetworkStats> {
  const now = Date.now();

  if (networkCache && networkCache.expiresAt > now) {
    return {
      ...networkCache.data,
      cached: true,
    };
  }

  // A window of recent blocks, not just the tip: tr_count + gen_utime across
  // the window is what makes a real TPS number possible. 300 blocks is ~100
  // seconds of chain at the current ~3 blocks/s, which is long enough to be
  // stable without being an expensive query (measured ~1.2s, and the result
  // is cached for NETWORK_CACHE_MS so the page never drives mainnet load).
  const WINDOW_BLOCKS = 300;

  const query = `
    query GetNetworkWindow($limit: Int!) {
      blockchain {
        blocks(last: $limit) {
          edges {
            node {
              seq_no
              hash
              gen_utime
              tr_count
            }
          }
        }
      }
    }
  `;

  const json = await postAckiGraphql<any>(query, { limit: WINDOW_BLOCKS });
  const edges = json?.data?.blockchain?.blocks?.edges;
  const nodes = Array.isArray(edges)
    ? edges.map((edge: any) => edge?.node).filter(Boolean)
    : [];

  if (!nodes.length) {
    throw new Error("Acki mainnet GraphQL response is missing latest block data");
  }

  // The newest block in the window is the tip we report as block height.
  const tip = nodes.reduce((best: any, node: any) =>
    (node.seq_no || 0) > (best.seq_no || 0) ? node : best,
  );

  if (typeof tip.seq_no !== "number") {
    throw new Error("Acki mainnet GraphQL response is missing latest block data");
  }

  const times = nodes
    .map((node: any) => node.gen_utime)
    .filter((time: any) => typeof time === "number");
  const windowSeconds = times.length > 1 ? Math.max(...times) - Math.min(...times) : 0;
  const windowTransactions = nodes.reduce(
    (sum: number, node: any) => sum + (Number(node.tr_count) || 0),
    0,
  );

  const data: AckiNetworkStats = {
    source: "acki-mainnet-graphql",
    latestBlock: tip.seq_no,
    latestBlockHash: String(tip.hash || ""),
    latestBlockTime: typeof tip.gen_utime === "number" ? tip.gen_utime : null,
    tps: windowSeconds > 0 ? Math.round((windowTransactions / windowSeconds) * 10) / 10 : null,
    blocksPerSecond:
      windowSeconds > 0 ? Math.round((nodes.length / windowSeconds) * 10) / 10 : null,
    // Same window, no extra query. Measured ~0.32s, which lines up with the
    // sub-second finality Acki Nacki advertises.
    avgBlockTimeSeconds:
      nodes.length > 1 && windowSeconds > 0
        ? Math.round((windowSeconds / (nodes.length - 1)) * 100) / 100
        : null,
    windowTransactions,
    windowSeconds: windowSeconds || null,
    windowBlocks: nodes.length,
    epoch: null,
    updatedAt: new Date().toISOString(),
    cached: false,
  };

  networkCache = {
    expiresAt: now + NETWORK_CACHE_MS,
    data,
  };

  return data;
}

export async function getAckiPopitDebug(input: string) {
  const wallet = await getAckiWalletActivity(input);
  const popitGame = wallet.popitGame;

  return {
    input: wallet.input,
    inputType: wallet.inputType,
    name: wallet.name,
    indexerAddress: wallet.indexerAddress,
    walletAddress: wallet.address,
    walletAccountId: wallet.accountId,
    walletDappId: wallet.dappId,
    popitGameAddress: popitGame?.address || null,
    popitGameAccountId: popitGame?.accountId || null,
    popitGameDappId: popitGame?.dappId || null,
    popitGameCodeHash: popitGame?.codeHash || null,
    popitGameBalanceRaw: popitGame?.balanceRaw || null,
    lockedTokens: popitGame?.lockedTokens || [],
    mamaboardLevel: popitGame?.mamaboardLevel || null,
    decodedState: popitGame?.decodedState || null,
    lastPaid: popitGame?.lastPaid || null,
    lastTransactionLt: popitGame?.lastTransactionLt || null,
    updatedAt: wallet.updatedAt,
    cached: wallet.cached,
  };
}


// Fix: mininghub debug helper removed along with the mininghub data source.
// See /debug_popit for the mainnet-GraphQL-backed equivalent.

// Scaling fix: the mining monitor tick only ever reads wallet.popitGame (see
// getLockedNacklRawForMonitor / getPopitLastTransactionLt in bot.ts) — the
// main account query's fields (native balance, tokens, last_paid etc.) are
// never used by the monitor, only by /info and friends. getAckiWalletActivity
// always fetched both, so the monitor was paying for a network call it threw
// away every single tick. This variant skips the main account query entirely
// and only does the PopitGame lookup, halving network calls per wallet scan.
export async function getAckiPopitGameActivity(
  input: string,
): Promise<AckiWalletActivity> {
  const resolved = await resolveAckiWalletInput(input);
  const popitGame = await getAckiPopitGameSummary(resolved.address);

  return {
    source: "acki-mainnet-graphql-popit-only",
    input: resolved.input,
    inputType: resolved.inputType,
    name: resolved.name,
    address: resolved.address,
    accountId: resolved.accountId,
    dappId: resolved.dappId,
    indexerAddress: resolved.indexerAddress,
    // Intentionally not fetched here — this path is monitor-only, and the
    // monitor never reads these fields. Left as safe empty defaults so the
    // shared AckiWalletActivity type still holds if something unexpected
    // reads them.
    balanceRaw: "0",
    nativeBalanceFormatted: formatTokenAmount("0", 9),
    tokens: [],
    lockedTokens: popitGame?.lockedTokens || [],
    popitGame,
    miningStats: null,
    mamaboardLevel: popitGame?.mamaboardLevel || null,
    lastPaid: popitGame?.lastPaid ?? null,
    lastTransactionLt: popitGame?.lastTransactionLt
      ? String(popitGame.lastTransactionLt)
      : null,
    latestTransaction: null,
    updatedAt: new Date().toISOString(),
    cached: false,
  };
}

// Payment monitoring: lightweight SHELL-balance-only query for the payments
// wallet. SHELL is an Extra Currency (collection index 2), held in
// balance_other — NOT the plain "balance" field, which is the native/VMSHELL
// gas balance. Deliberately separate from getAckiWalletActivity (which also
// fetches PopitGame data we don't need here) to keep the payment-check
// scheduler cheap.
export async function getShellBalance(
  walletNameOrAddress: string,
): Promise<{ address: string; shellBalanceRaw: string; lastTransactionLt: string | null }> {
  const resolved = await resolveAckiWalletInput(walletNameOrAddress);

  const query = `
    query GetShellBalance($accountId: String!, $dappId: String!) {
      blockchain {
        account(account_id: $accountId, dapp_id: $dappId) {
          info {
            balance_other {
              currency
              value(format: DEC)
            }
            last_trans_lt(format: DEC)
          }
        }
      }
    }
  `;

  const json = await postAckiGraphql<any>(query, {
    accountId: resolved.accountId,
    dappId: resolved.dappId,
  });

  const info = json?.data?.blockchain?.account?.info;

  if (!info) {
    throw new Error("ACKI_WALLET_NOT_FOUND");
  }

  const tokens = mapTokenBalances(info.balance_other);
  const shellToken = tokens.find((token) => token.currency === 2);

  return {
    address: resolved.address,
    shellBalanceRaw: shellToken?.balanceRaw || "0",
    lastTransactionLt:
      info.last_trans_lt != null ? String(info.last_trans_lt) : null,
  };
}

export type IncomingShellTransfer = {
  id: string;
  src: string;
  shellValueRaw: string;
  createdAt: number;
};

export type IncomingNacklTransfer = {
  id: string;
  src: string;
  nacklValueRaw: string;
  createdAt: number;
};

type IncomingTokenTransfer = {
  id: string;
  src: string;
  valueRaw: string;
  createdAt: number;
};

// Payment monitoring, sender-based (preferred): reads recent INCOMING
// internal transfers (msg_type: IntIn) to the payments wallet and extracts
// the SHELL (ECC index 2) portion of each one via `value_other`, plus the
// sender address (`src`). This lets us match a payment to a user by WHICH
// WALLET sent it (matched against their connected mining wallet), instead
// of relying on a unique fractional amount per invoice.
//
// VERIFIED against mainnet.ackinacki.org/graphql by schema introspection and
// a live query (2026-08-03):
//   - `Message.value_other` exists, typed `[OtherCurrency!]`, and really does
//     carry per-currency amounts on live internal messages. `currency` comes
//     back as a Float (e.g. 1.0), which normalizeCurrencyId already truncates.
//   - `blockchain.account` takes `account_id` + `dapp_id` (BOTH required),
//     NOT `address` — and `account_id` must be the bare 64-hex id with no
//     "0:" prefix. This is the same call shape getShellBalance already uses.
//   - `Message.created_at_string` does NOT exist; the field is `created_at`
//     (Int, unix seconds).
// The previous version of this query used `address:` and `created_at_string`,
// so it failed schema validation on every single call and the caller silently
// fell back to balance-diff 100% of the time. The caller's fallback is kept
// as a safety net, but this path should now be the one that runs.
async function getIncomingTokenTransfers(
  walletNameOrAddress: string,
  currency: number,
  limit: number,
): Promise<IncomingTokenTransfer[]> {
  const resolved = await resolveAckiWalletInput(walletNameOrAddress);

  const query = `
    query GetIncomingTokenTransfers($accountId: String!, $dappId: String!, $limit: Int!) {
      blockchain {
        account(account_id: $accountId, dapp_id: $dappId) {
          messages(msg_type: [IntIn], last: $limit) {
            edges {
              node {
                id
                src
                created_at
                value_other {
                  currency
                  value(format: DEC)
                }
              }
            }
          }
        }
      }
    }
  `;

  const json = await postAckiGraphql<any>(query, {
    accountId: resolved.accountId,
    dappId: resolved.dappId,
    limit,
  });

  const edges = json?.data?.blockchain?.account?.messages?.edges;

  if (!Array.isArray(edges)) {
    return [];
  }

  const transfers: IncomingTokenTransfer[] = [];

  for (const edge of edges) {
    const node = edge?.node;
    if (!node) continue;

    const otherCurrencies = Array.isArray(node.value_other) ? node.value_other : [];
    const tokenEntry = otherCurrencies.find(
      (entry: any) => normalizeCurrencyId(entry?.currency) === currency,
    );

    if (!tokenEntry) continue;

    transfers.push({
      id: String(node.id),
      src: String(node.src || ""),
      valueRaw: String(tokenEntry.value || "0"),
      createdAt: Number(node.created_at) || 0,
    });
  }

  return transfers;
}

export async function getIncomingShellTransfers(
  walletNameOrAddress: string,
  limit = 20,
): Promise<IncomingShellTransfer[]> {
  const transfers = await getIncomingTokenTransfers(walletNameOrAddress, 2, limit);
  return transfers.map((transfer) => ({
    id: transfer.id,
    src: transfer.src,
    shellValueRaw: transfer.valueRaw,
    createdAt: transfer.createdAt,
  }));
}

export async function getIncomingNacklTransfers(
  walletNameOrAddress: string,
  limit = 100,
): Promise<IncomingNacklTransfer[]> {
  const transfers = await getIncomingTokenTransfers(walletNameOrAddress, 1, limit);
  return transfers.map((transfer) => ({
    id: transfer.id,
    src: transfer.src,
    nacklValueRaw: transfer.valueRaw,
    createdAt: transfer.createdAt,
  }));
}

export async function getAckiWalletActivity(input: string): Promise<AckiWalletActivity> {
  const resolved = await resolveAckiWalletInput(input);
  const cacheKey = resolved.address;
  const now = Date.now();
  const cached = walletCache.get(cacheKey);

  if (cached && cached.expiresAt > now) {
    return {
      ...cached.data,
      input: resolved.input,
      inputType: resolved.inputType,
      name: resolved.name,
      indexerAddress: resolved.indexerAddress,
      cached: true,
    };
  }

  const query = `
    query GetLatestAccountActivity($accountId: String!, $dappId: String!) {
      blockchain {
        account(account_id: $accountId, dapp_id: $dappId) {
          info {
            balance(format: DEC)
            balance_other {
              currency
              value(format: DEC)
            }
            last_paid
            last_trans_lt(format: DEC)
          }
          transactions(last: 1) {
            nodes {
              id
              lt
            }
          }
        }
      }
    }
  `;

  const json = await postAckiGraphql<any>(query, {
    accountId: resolved.accountId,
    dappId: resolved.dappId,
  });

  const account = json?.data?.blockchain?.account;
  const info = account?.info;
  const latestTransaction = account?.transactions?.nodes?.[0] || null;

  if (!info) {
    throw new Error("ACKI_WALLET_NOT_FOUND");
  }

  // Fix: mininghub.ackinacki.com removed as a data source — it was returning
  // wrong/unreliable data. Wallet activity now comes only from the Acki Nacki
  // mainnet GraphQL endpoint (account info + PopitGame contract read). This
  // also drops one network call per wallet scan, which helps monitor
  // throughput at scale.
  const popitGame = await getAckiPopitGameSummary(resolved.address);
  const miningStats: AckiMiningStats | null = null;

  const data: AckiWalletActivity = {
    source: "acki-mainnet-graphql",
    input: resolved.input,
    inputType: resolved.inputType,
    name: resolved.name,
    address: resolved.address,
    accountId: resolved.accountId,
    dappId: resolved.dappId,
    indexerAddress: resolved.indexerAddress,
    balanceRaw: String(info.balance || "0"),
    nativeBalanceFormatted: formatTokenAmount(String(info.balance || "0"), 9),
    tokens: mapTokenBalances(info.balance_other),
    lockedTokens: popitGame?.lockedTokens || [],
    popitGame,
    miningStats,
    mamaboardLevel: popitGame?.mamaboardLevel || null,
    lastPaid: typeof info.last_paid === "number" ? info.last_paid : null,
    lastTransactionLt:
      info.last_trans_lt === null || info.last_trans_lt === undefined
        ? null
        : String(info.last_trans_lt),
    latestTransaction: latestTransaction
      ? {
          id: String(latestTransaction.id || ""),
          lt:
            latestTransaction.lt === null || latestTransaction.lt === undefined
              ? null
              : String(latestTransaction.lt),
        }
      : null,
    updatedAt: new Date().toISOString(),
    cached: false,
  };

  walletCache.set(cacheKey, {
    expiresAt: now + WALLET_CACHE_MS,
    data,
  });

  return data;
}
