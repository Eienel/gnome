// Developer + dashboard API: platform stats, wallet provisioning, treasury
// funding, per-address usage, and the global live settlement feed. All EVM.

import { Router, type Request, type Response } from "express";
import { randomBytes } from "node:crypto";
import { getAddress, type Address, type Hex } from "viem";
import { explorerTx } from "../lib/chains.js";
import { newWallet, fundTransfer, balanceOf } from "../lib/evm.js";
import { readSettlements, type Settlement } from "../lib/ledger.js";
import type { TokenMeta } from "../lib/evm.js";

interface Runtime {
  network: string;
  chainName: string;
  explorer: string;
  token: TokenMeta;
  priceBaseUnits: string;
  payTo: Address;
  settlementMode: string;
  treasuryKey: Hex | null;
}

let runtime: Runtime = {
  network: "eip155:42161",
  chainName: "Robinhood Chain",
  explorer: "",
  token: { address: "0x0000000000000000000000000000000000000000", name: "USD Coin", symbol: "USDC", decimals: 6, version: "2" },
  priceBaseUnits: "1000",
  payTo: "0x0000000000000000000000000000000000000000",
  settlementMode: "onchain",
  treasuryKey: null,
};

export function setRuntime(r: Runtime) {
  runtime = r;
}

const router = Router();

router.get("/config", (_req, res) => {
  res.json({
    network: runtime.network,
    chainName: runtime.chainName,
    explorer: runtime.explorer,
    settlementMode: runtime.settlementMode,
    token: {
      address: runtime.token.address,
      name: runtime.token.name,
      symbol: runtime.token.symbol,
      decimals: runtime.token.decimals,
    },
    priceBaseUnits: runtime.priceBaseUnits,
    payTo: runtime.payTo,
  });
});

router.get("/stats", (_req, res) => {
  const s = readSettlements();
  const volume = s.reduce((sum, x) => sum + BigInt(x.amount || "0"), 0n).toString();
  res.json({
    token: { symbol: runtime.token.symbol, name: runtime.token.name, decimals: runtime.token.decimals, address: runtime.token.address },
    chainName: runtime.chainName,
    totalCalls: s.length,
    volumeBaseUnits: volume,
    settlementMode: runtime.settlementMode,
  });
});

// Provision a fresh EVM wallet + API key. The agent signs x402 authorizations
// with the returned private key; its token balance is its hard spend cap.
router.post("/provision", (_req, res) => {
  try {
    const { privateKey, address } = newWallet();
    res.json({
      apiKey: randomBytes(24).toString("hex"),
      address,
      privateKey,
      payTo: address,
      network: runtime.network,
      chainName: runtime.chainName,
      token: runtime.token.symbol,
      instructions:
        `1. Save the private key securely (this is the agent wallet).\n` +
        `2. Fund it with ${runtime.token.symbol} on ${runtime.chainName} — or use "Fund from treasury".\n` +
        `3. Point your agent at the rail; it pays automatically on every 402.`,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "provision failed" });
  }
});

// Fund an address with tokens from the treasury (real on-chain ERC-20 transfer).
router.post("/fund", async (req: Request, res: Response) => {
  try {
    const { address, amount } = req.body as { address?: string; amount?: string };
    if (!address) return res.status(400).json({ error: "address required" });
    if (runtime.settlementMode === "simulate" || !runtime.treasuryKey)
      return res.status(503).json({ error: "Treasury funding is disabled on this deployment." });
    const value = amount || (BigInt(runtime.priceBaseUnits) * 50n).toString();
    const tx = await fundTransfer(runtime.network, runtime.treasuryKey, runtime.token.address, getAddress(address), value);
    res.json({ ok: true, transaction: tx, amount: value, explorerUrl: explorerTx(runtime.network, tx) });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "fund failed" });
  }
});

// On-chain token balance for an address.
router.get("/balance/:address", async (req: Request, res: Response) => {
  try {
    if (runtime.token.address === "0x0000000000000000000000000000000000000000")
      return res.json({ address: req.params.address, balance: "0", unavailable: true });
    const addr = String(req.params.address);
    const bal = await balanceOf(runtime.network, runtime.token.address, getAddress(addr));
    res.json({ address: addr, balance: bal.toString(), symbol: runtime.token.symbol, decimals: runtime.token.decimals });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "balance failed" });
  }
});

router.get("/usage/:address", (req: Request, res: Response) => {
  const addrParam = String(req.params.address);
  const addr = addrParam.toLowerCase();
  const mine = readSettlements().filter(s => s.payer.toLowerCase() === addr);
  const spent = mine.reduce((sum, s) => sum + BigInt(s.amount || "0"), 0n).toString();
  res.json({
    address: addrParam,
    count: mine.length,
    spentBaseUnits: spent,
    settlements: mine.slice(0, 50).map(fmt),
  });
});

router.get("/feed", (_req, res) => {
  const s = readSettlements();
  res.json({ count: s.length, settlements: s.slice(0, 25).map(fmt) });
});

router.get("/health", (_req, res) => res.json({ status: "ok", service: "gnome-dashboard-api" }));

function fmt(s: Settlement) {
  return {
    payer: s.payer,
    transaction: s.transaction,
    amount: s.amount,
    asset: s.asset,
    network: s.network,
    ts: s.ts,
    explorerUrl: explorerTx(s.network, s.transaction),
  };
}

export default router;
