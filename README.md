# Gnome

Pay-per-request API payments for autonomous agents, settled on **Robinhood Chain**.

Gnome is an EVM-native payment rail that lets any agent or person pay for a premium API one call at a time, on-chain, from a balance they cannot overspend. It uses the [x402](https://x402.org) standard (HTTP 402 Payment Required) and settles every call as an **EIP-3009 `transferWithAuthorization`** ERC-20 transfer on Robinhood Chain.

## What changed from the Casper version

This is a full EVM port of the original Casper implementation. Instead of CEP-18 token transfers signed with Casper keys, Gnome now speaks the **EVM flavor of x402**: the client signs an EIP-712 `TransferWithAuthorization` (EIP-3009) with an ordinary EVM key, and the facilitator submits it on-chain to any ERC-20 stablecoin (e.g. USDC) on **Robinhood Chain** — Robinhood's EVM Layer 2. The rail, the paywall, the facilitator, the dashboard, and the reference agent are all EVM-native. Deepgram text-to-speech remains the reference upstream.

## The problem

Autonomous agents can hold crypto, but the world's APIs still run on credit cards, subscriptions, and manually issued keys. An agent cannot sign up for a card, and nothing stops it from running up an unbounded bill. Gnome solves both: metered, pay-as-you-go access with a hard spending cap enforced by the payment itself. When the balance runs out, calls stop. There is no overdraft.

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

- **`onchain`** — submits real `transferWithAuthorization` transactions against a live ERC-20 (e.g. USDC). This is the default: the shipped config settles on **Base Sepolia** against Circle's testnet USDC (`0x036CbD…dCF7e`). Requires a facilitator key funded with gas and an agent/treasury key funded with USDC. At go-live, swap the network block for Robinhood Chain mainnet (see `.env.example`).
- **`simulate`** — the full x402 round-trip (402 → sign → verify → settle → serve) with a deterministic pseudo tx hash and no chain access. Handy for pure UI/demo runs.

Faucets for the Base Sepolia testnet: [ETH (gas)](https://portal.cdp.coinbase.com/products/faucet) · [USDC](https://faucet.circle.com).

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
import { createPayer, wrapFetchWithPayment } from "gnome/client"; // src/lib/client.ts

const payer = createPayer(process.env.AGENT_PRIVATE_KEY as `0x${string}`);
const pay = wrapFetchWithPayment(fetch, payer);

const res = await pay("https://gnome.app/v1/speak", {
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

### Render (easiest, no CLI)

A `render.yaml` blueprint is included. In the [Render dashboard](https://dashboard.render.com/): **New > Blueprint**, connect this repo, then **Apply**. It comes up green with **no secrets and no funding**, because it defaults to `SETTLEMENT_MODE=simulate`: the full 402 flow (sign, verify, settle, serve) runs and settlements show a deterministic simulated hash. Pushes auto-deploy after that.

To go live with real on-chain settlement, in the Render dashboard set `SETTLEMENT_MODE=onchain`, fill the secrets (`FACILITATOR_PRIVATE_KEY`, `TREASURY_PRIVATE_KEY`, `PAYEE_ADDRESS`, `DEEPGRAM_API_KEY`), and fund the keys (Base Sepolia ETH for the facilitator's gas, USDC for the treasury/demo wallet).

Free-plan notes: the service spins down when idle (cold start on the next visit) and has no persistent disk, so the ledger/live-feed resets on restart. Use a paid instance with a disk for persistence and always-on.

### Fly.io (CLI)

Deployed on **Fly.io** as a single container running the facilitator plus the proxy (see `Dockerfile` and `fly.toml`). The non-secret network config (Base Sepolia, USDC, price) is baked into `fly.toml [env]`; only secrets need setting. A persistent volume keeps the settlement ledger across deploys.

**One-time setup** (from a machine with [flyctl](https://fly.io/docs/flyctl/install/) installed and `fly auth login` done):

```bash
fly apps create gnome                     # or: fly launch --no-deploy --copy-config --name gnome
fly volumes create gnome_data --size 1 --region iad
fly secrets set \
  FACILITATOR_PRIVATE_KEY=0x... \
  TREASURY_PRIVATE_KEY=0x... \
  DEMO_AGENT_PRIVATE_KEY=0x... \
  PAYEE_ADDRESS=0x... \
  DEEPGRAM_API_KEY=...
fly deploy --remote-only
```

Fund the keys before the demo works on-chain: the facilitator key needs Base Sepolia ETH for gas, and the treasury/demo key needs Base Sepolia USDC (see the faucet links above).

**Continuous deploys via GitHub Actions:** `.github/workflows/fly-deploy.yml` runs `flyctl deploy` on every push once the app exists. Add a `FLY_API_TOKEN` repository secret (`flyctl tokens create deploy`) and pushes deploy automatically. Runtime secrets stay in Fly, never in the repo.

**Going live on Robinhood Chain mainnet:** update the network vars in `fly.toml [env]` (`CAIP2_CHAIN_ID`, `NETWORKS`, `ROBINHOOD_CHAIN_ID`, `RPCURL_ROBINHOOD`, `ROBINHOOD_EXPLORER`, `ASSET_ADDRESS`) to the mainnet values, then deploy. No code changes required.

`vercel.json` deploys the static marketing/dashboard pages (`web/`) as a preview; the full rail runs on Fly.

## Why this is bigger than the demo

The reference integration gates Deepgram text-to-speech because it produces an obvious, verifiable output (audio you can play) for a payment you can click through to on-chain. But the gateway is provider-agnostic: the same paywall, facilitator, and settlement flow work in front of any HTTP API on any EVM chain. The value is the rail, not the specific API behind it.

## Tech stack

TypeScript, Express, [viem](https://viem.sh), the x402 protocol (HTTP 402 + EIP-3009 `transferWithAuthorization`), an ERC-20 stablecoin on Robinhood Chain, Deepgram as the first paid upstream, deployed as a container on Fly.io (or Vercel for the static pages).

## License

MIT. See [LICENSE](LICENSE).
