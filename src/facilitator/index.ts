// x402 facilitator (EVM). Verifies EIP-3009 authorizations off-chain and
// settles them on-chain via transferWithAuthorization, paying gas. Records
// every settlement to the ledger. Settles on Robinhood Chain by default.

import "dotenv/config";
import express from "express";
import { keccak256, toHex, type Hex } from "viem";
import { getChain } from "../lib/chains.js";
import { settleTransferWithAuthorization } from "../lib/evm.js";
import { recordSettlement } from "../lib/ledger.js";
import {
  verifyAuthorization,
  type PaymentPayload,
  type PaymentRequirements,
  type SettleResponse,
} from "../lib/x402.js";
import { parseEnv } from "./config.js";

const cfg = parseEnv();

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use((req, _res, next) => {
  console.log(`→ ${req.method} ${req.url}`);
  next();
});

function ensureSupported(network: string) {
  if (!cfg.networks.includes(network)) throw new Error(`network ${network} not supported`);
  return getChain(network);
}

app.post("/verify", async (req, res) => {
  try {
    const { paymentPayload, paymentRequirements } = req.body as {
      paymentPayload: PaymentPayload;
      paymentRequirements: PaymentRequirements;
    };
    if (!paymentPayload || !paymentRequirements)
      return res.status(400).json({ isValid: false, invalidReason: "missing_fields" });
    const chain = ensureSupported(paymentPayload.network);
    const result = await verifyAuthorization(paymentPayload, paymentRequirements, chain.chainId);
    if (result.isValid) console.log("✅ payment verified", result.payer);
    else console.log("❌ verify failure:", result.invalidReason);
    res.json(result);
  } catch (error) {
    res.status(500).json({ isValid: false, invalidReason: error instanceof Error ? error.message : "error" });
  }
});

app.post("/settle", async (req, res) => {
  try {
    const { paymentPayload, paymentRequirements } = req.body as {
      paymentPayload: PaymentPayload;
      paymentRequirements: PaymentRequirements;
    };
    if (!paymentPayload || !paymentRequirements)
      return res.status(400).json({ success: false, errorReason: "missing_fields" });

    const chain = ensureSupported(paymentPayload.network);
    const verify = await verifyAuthorization(paymentPayload, paymentRequirements, chain.chainId);
    if (!verify.isValid) {
      return res.json({ success: false, errorReason: verify.invalidReason, network: paymentPayload.network });
    }

    const { authorization, signature } = paymentPayload.payload;
    let txHash: string;
    if (cfg.settlementMode === "simulate") {
      // Deterministic pseudo-hash so the demo shows a full round-trip without a
      // funded chain. Clearly flagged; the on-chain path uses the same shape.
      txHash = keccak256(toHex(`${authorization.from}:${authorization.nonce}:${Date.now()}`));
      console.log(`🧪 simulated settlement ${txHash}`);
    } else {
      txHash = await settleTransferWithAuthorization(
        paymentPayload.network,
        cfg.privateKey,
        paymentRequirements.asset,
        authorization,
        signature as Hex,
      );
      console.log(`💸 settled on-chain ${txHash}`);
    }

    recordSettlement({
      payer: verify.payer!,
      transaction: txHash,
      amount: authorization.value,
      asset: paymentRequirements.asset,
      network: paymentPayload.network,
      ts: new Date().toISOString(),
    });

    const response: SettleResponse = {
      success: true,
      transaction: txHash,
      network: paymentPayload.network,
      payer: verify.payer,
    };
    res.json(response);
  } catch (error) {
    console.error("Settle error:", error);
    res.json({
      success: false,
      errorReason: error instanceof Error ? error.message : "settle_failed",
      network: req.body?.paymentPayload?.network || "unknown",
    });
  }
});

app.get("/supported", (_req, res) => {
  res.json({
    kinds: cfg.networks.map(network => ({ scheme: "exact", network })),
    settlementMode: cfg.settlementMode,
  });
});

app.get("/health", (_req, res) => res.json({ status: "ok", mode: cfg.settlementMode }));

// Bind loopback only: the facilitator is internal (the proxy calls it over
// localhost). This keeps it off the container's external interface so hosts
// like Render route public traffic to the proxy, not here.
app.listen(cfg.port, "127.0.0.1", () => {
  console.log(`🚀 Facilitator on http://127.0.0.1:${cfg.port} (mode=${cfg.settlementMode})`);
  console.log(`   networks: ${cfg.networks.join(", ")}`);
});
