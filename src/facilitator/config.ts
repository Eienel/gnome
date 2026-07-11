// Facilitator config: one EVM signing key that verifies authorizations and
// settles EIP-3009 transfers on-chain (paying gas) for each supported network.

import type { Hex } from "viem";
import { primaryNetwork } from "../lib/chains.js";

export interface FacilitatorEnv {
  port: number;
  /** CAIP-2 networks this facilitator will settle on. */
  networks: string[];
  /** Facilitator/treasury private key (pays gas). */
  privateKey: Hex;
  /** "onchain" submits real txs; "simulate" fakes settlement for demos. */
  settlementMode: "onchain" | "simulate";
}

function requireKey(mode: string): Hex {
  const k = process.env.FACILITATOR_PRIVATE_KEY || process.env.TREASURY_PRIVATE_KEY;
  if (k) return (k.startsWith("0x") ? k : `0x${k}`) as Hex;
  if (mode === "simulate") {
    // Deterministic throwaway key; never used to move funds in simulate mode.
    return "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
  }
  throw new Error("FACILITATOR_PRIVATE_KEY is required for on-chain settlement");
}

export function parseEnv(): FacilitatorEnv {
  const settlementMode = (process.env.SETTLEMENT_MODE || "onchain") === "simulate" ? "simulate" : "onchain";
  const networksRaw = process.env.NETWORKS || primaryNetwork();
  const networks = networksRaw.split(",").map(n => n.trim()).filter(Boolean);
  // Facilitator is internal-only. Use its own port var so the public PORT (set
  // by hosts like Render) is free for the proxy.
  const port = parseInt(process.env.FACILITATOR_PORT || "4022", 10);
  return { port, networks, privateKey: requireKey(settlementMode), settlementMode };
}
