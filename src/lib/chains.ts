// EVM chain registry for the rail. Robinhood Chain is the primary settlement
// network; the others are here so the same rail can settle on any EVM chain
// (and so the demo can run against a public testnet while Robinhood mainnet
// access is provisioned).
//
// x402 identifies networks with CAIP-2 ids: "eip155:<chainId>".

import type { Chain } from "viem";
import { base, baseSepolia, mainnet, arbitrum } from "viem/chains";

export interface ChainInfo {
  /** CAIP-2 network id used in x402 payloads, e.g. "eip155:42161". */
  caip2: string;
  /** Numeric EVM chain id. */
  chainId: number;
  /** Human label. */
  name: string;
  /** Default JSON-RPC endpoint (override with RPCURL_<SUFFIX>). */
  rpcUrl: string;
  /** Block explorer base for building tx links. */
  explorer: string;
  /** viem Chain object for building clients. */
  chain: Chain;
  /** Native currency symbol (for gas). */
  nativeSymbol: string;
}

// Robinhood Chain — Robinhood's EVM Layer 2 (Arbitrum Orbit stack) for
// tokenized real-world assets. Chain id / RPC are provisioned per environment;
// override ROBINHOOD_CHAIN_ID and RPCURL_ROBINHOOD in .env for mainnet access.
const ROBINHOOD_CHAIN_ID = Number(process.env.ROBINHOOD_CHAIN_ID || "42161");
const ROBINHOOD_RPC =
  process.env.RPCURL_ROBINHOOD || process.env.ROBINHOOD_RPC_URL || "https://arb1.arbitrum.io/rpc";
const ROBINHOOD_EXPLORER =
  process.env.ROBINHOOD_EXPLORER || "https://arbiscan.io";

const robinhood: Chain = {
  id: ROBINHOOD_CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [ROBINHOOD_RPC] } },
  blockExplorers: { default: { name: "Robinhood Explorer", url: ROBINHOOD_EXPLORER } },
};

export const CHAINS: Record<string, ChainInfo> = {
  "eip155:8453": {
    caip2: "eip155:8453",
    chainId: 8453,
    name: "Base",
    rpcUrl: process.env.RPCURL_BASE || "https://mainnet.base.org",
    explorer: "https://basescan.org",
    chain: base,
    nativeSymbol: "ETH",
  },
  "eip155:84532": {
    caip2: "eip155:84532",
    chainId: 84532,
    name: "Base Sepolia",
    rpcUrl: process.env.RPCURL_BASE_SEPOLIA || "https://sepolia.base.org",
    explorer: "https://sepolia.basescan.org",
    chain: baseSepolia,
    nativeSymbol: "ETH",
  },
  "eip155:42161": {
    caip2: "eip155:42161",
    chainId: 42161,
    name: "Arbitrum One",
    rpcUrl: process.env.RPCURL_ARBITRUM || "https://arb1.arbitrum.io/rpc",
    explorer: "https://arbiscan.io",
    chain: arbitrum,
    nativeSymbol: "ETH",
  },
  "eip155:1": {
    caip2: "eip155:1",
    chainId: 1,
    name: "Ethereum",
    rpcUrl: process.env.RPCURL_MAINNET || "https://eth.llamarpc.com",
    explorer: "https://etherscan.io",
    chain: mainnet,
    nativeSymbol: "ETH",
  },
};

// Robinhood Chain is the primary rail. Register it last so its branding wins
// even when its chain id overlaps a well-known chain (e.g. today it settles on
// the Arbitrum Orbit stack). Override ROBINHOOD_CHAIN_ID / RPCURL_ROBINHOOD for
// mainnet access.
CHAINS[`eip155:${ROBINHOOD_CHAIN_ID}`] = {
  caip2: `eip155:${ROBINHOOD_CHAIN_ID}`,
  chainId: ROBINHOOD_CHAIN_ID,
  name: "Robinhood Chain",
  rpcUrl: ROBINHOOD_RPC,
  explorer: ROBINHOOD_EXPLORER,
  chain: robinhood,
  nativeSymbol: "ETH",
};

/** The chain the rail charges on by default (CAIP-2 id). */
export function primaryNetwork(): string {
  return process.env.CAIP2_CHAIN_ID || `eip155:${ROBINHOOD_CHAIN_ID}`;
}

export function getChain(caip2: string): ChainInfo {
  const info = CHAINS[caip2];
  if (info) return info;
  // Allow an arbitrary eip155 chain configured purely from env.
  const m = /^eip155:(\d+)$/.exec(caip2);
  if (m) {
    const id = Number(m[1]);
    const rpc = process.env.RPCURL_ROBINHOOD || process.env[`RPCURL_EIP155_${id}`];
    if (rpc) {
      return {
        caip2,
        chainId: id,
        name: `EVM ${id}`,
        rpcUrl: rpc,
        explorer: process.env.ROBINHOOD_EXPLORER || "",
        chain: { ...robinhood, id },
        nativeSymbol: "ETH",
      };
    }
  }
  throw new Error(`Unknown / unconfigured network: ${caip2}`);
}

export function explorerTx(caip2: string, hash: string): string {
  try {
    const base = getChain(caip2).explorer;
    return base ? `${base}/tx/${hash}` : hash;
  } catch {
    return hash;
  }
}
