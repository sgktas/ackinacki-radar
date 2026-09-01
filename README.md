# Acki Nacki Radar

Cloud mining and network telemetry for the [Acki Nacki](https://ackinacki.com)
blockchain — a Telegram bot and a web dashboard sharing one backend.

Live at **[ackinackiradar.com](https://ackinackiradar.com)** ·
bot: **[@ackinackiradar_bot](https://t.me/ackinackiradar_bot)**

> Independent project. Not affiliated with or endorsed by the Acki Nacki team.

## What it does

- **Cloud mining.** Connect an Acki Nacki wallet once, and the service runs
  mining sessions for it around the clock — no machine to keep online at home.
  Mining keys are authorised through the wallet's own deep-link approval, so the
  wallet is never handed over.
- **Network radar.** Live TPS, block height, block time and NACKL flow, sampled
  from mainnet and shown on the public dashboard.
- **Wallet lookup.** Search any wallet by name or address for balances, mining
  activity and reward history.
- **Subscriptions.** Three payment rails, all exercised end to end against live
  mainnet: Telegram Stars, USDT-on-TON, and native NACKL.
- **Arc testnet payments.** A separate, quota-limited trial flow uses native
  test USDC on Arc. Each invoice is bound to its on-chain payment, so the
  service confirms settlement from contract state instead of guessing from a
  wallet transaction list.

## Arc testnet payment flow

Acki Nacki Radar is a live integration of the open-source
[ArcPay InvoiceRegistry](https://github.com/sgktas/arcpay) pattern. It is a
testnet experiment, not a sale: users obtain test USDC from the faucet and a
successful payment grants a short, separately tracked trial. It can never be
credited as a normal paid subscription.

1. A user starts the Arc trial from the dashboard or the Telegram bot.
2. The backend creates a unique, human-readable invoice code and encodes it as
   a `bytes32` invoice id in the Arc payment call.
3. The payment watcher reads the registry's recorded amount for that exact
   merchant and invoice id.
4. Only after the contract state reaches the expected amount does the backend
   grant the trial. Open invoices reserve a quota slot, preventing a rush of
   pending invoices from exceeding the testnet allocation.

The integration is deliberately defensive: Arc log reads use bounded-range
`eth_getLogs` polling with multi-RPC failover, and payment confirmation reads
fresh state before granting access. See the [ArcPay README](https://github.com/sgktas/arcpay)
for the contract, SDK, and the testnet findings behind those choices.

## How the mining works

The Acki Nacki Bee SDK is compiled with `wasm-pack --target web` — its own
README states it is *not* a Node package, because it depends on browser
`WebAssembly` and `fetch`. Rather than shim those in Node, the miner runs the
SDK where it was built to run: a real headless Chromium page driven by
Playwright, served from a synthetic same-origin host so the wasm loader gets the
`fetch()` it expects.

Each epoch the scheduler picks eligible miners, runs a timed tapping session in
that page, waits for `submit_session_proof` to land on chain, then claims the
epoch reward. Sessions are guarded by a cross-process file lease so the
dashboard and payment readers stand down while a session holds the chain.

## Stack

| | |
|---|---|
| Runtime | Node.js 22, TypeScript |
| Bot | Telegraf (Telegram Bot API) |
| API | Express, behind nginx |
| Chain | `@teamgosh/bee-sdk`, Acki Nacki GraphQL |
| Mining host | Playwright + headless Chromium |
| Auth | Telegram OIDC, HMAC-signed sessions |
| Storage | JSON state files on disk |

## Layout

```
src/
  index.ts              entry point — starts the API and the bot
  server.ts             Express API: dashboard, payments, admin
  bot.ts                Telegram bot, mining scheduler, monitors
  beeWorker.ts          isolated mining worker process
  services/
    beeMiner.ts         Bee SDK session driver and chain-critical lease
    ackiProvider.ts     mainnet GraphQL reads (TPS, blocks, wallets)
    epochClock.ts       canonical 5-minute epoch countdown
    payments.ts         plans, subscriptions, Telegram Stars
    tonPayments.ts      USDT-on-TON invoice matching
    arcPayments.ts      Arc USDC InvoiceRegistry reads and reconciliation
    qr.ts               wallet-approval QR rendering
```

## Frontend

The dashboard SPA lives in `frontend/` (Vite + plain TypeScript, no
framework) — folded in as its own subtree from a formerly separate repo, kept
here because it deploys to the same VPS as part of the same project. It has
its own README with its own build/deploy notes.

## Running it

```bash
npm install
cp .env.example .env   # fill in BOT_TOKEN, BEE_APP_ID, payment addresses
npm run dev
```

Secrets and runtime state (`.env`, `data/`) are never committed — `data/` holds
mining private keys and user records.

## License

All rights reserved. Published for reference; not licensed for reuse.
