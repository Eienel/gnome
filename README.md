# Tab402

Pay-per-request API payments for autonomous agents, settled on **Robinhood Chain**.

Tab402 is an EVM-native payment rail that lets any agent or person pay for a premium API one call at a time, on-chain, from a balance they cannot overspend. It uses the [x402](https://x402.org) standard (HTTP 402 Payment Required) and settles every call as an **EIP-3009 `transferWithAuthorization`** ERC-20 transfer on Robinhood Chain.

## What changed from the Casper version

This is a full EVM port of the original Casper implementation. Instead of CEP-18 token transfers signed with Casper keys, Tab402 now speaks the **EVM flavor of x402**: the client signs an EIP-712 `TransferWithAuthorization` (EIP-3009) with an ordinary EVM key, and the facilitator submits it on-chain to any ERC-20 stablecoin (e.g. USDC) on **Robinhood Chain** — Robinhood's EVM Layer 2. The rail, the paywall, the facilitator, the dashboard, and the reference agent are all EVM-native. Deepgram text-to-speech remains the reference upstream.

## The problem

Autonomous agents can hold crypto, but the world's APIs still run on credit cards, subscriptions, and manually issued keys. An agent cannot sign up for a card, and nothing stops it from running up an unbounded bill. Tab402 solves both: metered, pay-as-you-go access with a hard spending cap enforced by the payment itself. When the balance runs out, calls stop. There is no overdraft.

## How a paid call works

```
client ── POST /v1/speak ─────────────▶ proxy (rail)
proxy  ── 402 Payment Required + terms ▶ client
client ── signs EIP-3009 authorization ▶ proxy   (X-PAYMENT header)
proxy  ── /verify, /settle ───────────▶ facilitator ── transferWithAuthorization ──▶ Robinhood Chain
proxy  ── (only after settlement) ────▶ upstream API ── result ──▶ client
```

1. The client requests a paid endpoint and receives an HTTP 402 with the price and payment requirements.
2. It signs an EIP-712 `TransferWithAuthorization` with its EVM key.
3. The facilitator verifies the signature off-chain, then submits the transfer on Robinhood Chain, paying gas.
4. Only after the payment settles on-chain does the upstream API run and return its result.

Every call is a final on-chain settlement — an ERC-20 transfer that either lands or the request is refused.

## Components

| Service | Path | Port | Role |
|---|---|---|---|
| Facilitator | `src/facilitator` | 4022 | Verifies EIP-3009 authorizations, settles transfers on-chain, pays gas |
| Proxy (rail) | `src/proxy` | 4021 | x402 paywall in front of the upstream API; serves the dashboard, demo, and API |
| Agent | `src/agent` | — | Reference client that holds tokens and pays per call; balance is its hard cap |
| Dashboard API | `src/dashboard` | on 4021 | Wallet provisioning, treasury funding, usage, stats, live feed |
| Core lib | `src/lib` | — | `x402.ts` (EIP-712 + header codec), `evm.ts` (viem), `client.ts`, `chains.ts`, `ledger.ts` |

## Settlement modes

- **`simulate`** — the full x402 round-trip (402 → sign → verify → settle → serve) with a deterministic pseudo tx hash. Perfect for demoing before mainnet access or token funding is provisioned. This is the default in `.env.example`.
- **`onchain`** — submits real `transferWithAuthorization` transactions to Robinhood Chain against a live ERC-20 (e.g. USDC). Requires a funded facilitator key and a token that implements EIP-3009.

## Run locally

Prerequisites: Node 22+.

```bash
npm install
cp .env.example .env

# Generate a keypair for the facilitator/treasury/agent
npm run keygen

# (onchain mode only) inspect the payment token's EIP-3009 domain
npm run token-info -- 0xYourTokenAddress

# Start the stack
npm run facilitator   # :4022
npm run proxy         # :4021  (dashboard at http://localhost:4021/dashboard)
npm run agent         # makes one paid call and writes out.mp3
```

Open http://localhost:4021 for the landing page, `/demo` for the no-wallet demo, and `/dashboard` for the developer dashboard.

## Use it in your own agent

```ts
import { createPayer, wrapFetchWithPayment } from "tab402/client"; // src/lib/client.ts

const payer = createPayer(process.env.AGENT_PRIVATE_KEY as `0x${string}`);
const pay = wrapFetchWithPayment(fetch, payer);

const res = await pay("https://tab402.app/v1/speak", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ text: "Hello, paid on Robinhood Chain." }),
});
const audio = Buffer.from(await res.arrayBuffer()); // your MP3, paid on-chain
```

The agent's address needs a token balance; fund it from the dashboard. Every 402 is signed and settled automatically.

## Configuration

| Variable | Meaning |
|---|---|
| `CAIP2_CHAIN_ID` | Network the rail charges on, e.g. `eip155:42161` |
| `ROBINHOOD_CHAIN_ID` / `RPCURL_ROBINHOOD` | Robinhood Chain id + JSON-RPC endpoint |
| `SETTLEMENT_MODE` | `simulate` or `onchain` |
| `FACILITATOR_PRIVATE_KEY` | EVM key that settles transfers and pays gas |
| `PAYEE_ADDRESS` | Address that receives payments |
| `ASSET_ADDRESS` | ERC-20 payment token (EIP-3009 capable) |
| `PRICE` | Price per call: `$0.001` or raw base units |
| `DEEPGRAM_API_KEY` | Key for the upstream API behind the paywall |
| `TREASURY_PRIVATE_KEY` | Holds token supply; powers funding + the no-wallet demo |
| `CLIENT_PRIVATE_KEY` | The reference agent's key |

See `.env.example` for the full list.

## Deploy

Single container running the facilitator plus the proxy — see `Dockerfile` and `fly.toml`.

```bash
fly deploy
fly secrets set FACILITATOR_PRIVATE_KEY=0x… TREASURY_PRIVATE_KEY=0x… \
  DEEPGRAM_API_KEY=… PAYEE_ADDRESS=0x… ASSET_ADDRESS=0x… SETTLEMENT_MODE=onchain
```

`vercel.json` deploys the static marketing/dashboard pages (`web/`) as a preview; the full rail (facilitator + proxy) runs best as the Fly container.

## Why this is bigger than the demo

The reference integration gates Deepgram text-to-speech because it produces an obvious, verifiable output (audio you can play) for a payment you can click through to on-chain. But the gateway is provider-agnostic: the same paywall, facilitator, and settlement flow work in front of any HTTP API on any EVM chain. The value is the rail, not the specific API behind it.

## Tech stack

TypeScript, Express, [viem](https://viem.sh), the x402 protocol (HTTP 402 + EIP-3009 `transferWithAuthorization`), an ERC-20 stablecoin on Robinhood Chain, Deepgram as the first paid upstream, deployed as a container on Fly.io (or Vercel for the static pages).

## License

MIT. See [LICENSE](LICENSE).
