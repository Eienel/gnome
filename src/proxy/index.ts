// The rail: an Express resource server that gates Deepgram text-to-speech
// behind an x402 paywall settled on Robinhood Chain. On payment it forwards to
// Deepgram with the operator's key and returns the audio. Also serves the
// dashboard, demo, landing page, and the developer API.

import "dotenv/config";
import cors from "cors";
import express from "express";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getAddress, type Address, type Hex } from "viem";
import { primaryNetwork, getChain } from "../lib/chains.js";
import { readTokenMeta, type TokenMeta } from "../lib/evm.js";
import { createPayer, wrapFetchWithPayment } from "../lib/client.js";
import { priceToBaseUnits } from "../lib/x402.js";
import dashboardApi, { setRuntime } from "../dashboard/api.js";
import { paywall, requirement } from "./paywall.js";


interface Env {
  port: number;
  network: string;
  payTo: Address;
  asset: Address;
  facilitatorURL: string;
  price: string; // "$0.001" or base units
  deepgramApiKey: string;
  deepgramModel: string;
  demoKey: Hex | null;
  settlementMode: string;
  assetName: string;
  assetSymbol: string;
  assetDecimals: number;
  assetVersion: string;
}

function req(key: string, fallback?: string): string {
  const v = process.env[key] ?? fallback;
  if (v === undefined) {
    console.error(`❌ ${key} is required`);
    process.exit(1);
  }
  return v;
}

const cfg: Env = {
  // Public port. Hosts like Render/Heroku inject PORT; fall back to PROXY_PORT
  // (local/Fly) then 4021.
  port: parseInt(process.env.PORT || process.env.PROXY_PORT || "4021", 10),
  network: primaryNetwork(),
  payTo: getAddress(req("PAYEE_ADDRESS", "0x0000000000000000000000000000000000000000")),
  asset: getAddress(req("ASSET_ADDRESS", "0x0000000000000000000000000000000000000000")),
  facilitatorURL: process.env.FACILITATOR_URL || "http://localhost:4022",
  price: process.env.PRICE || "$0.001",
  deepgramApiKey: process.env.DEEPGRAM_API_KEY || "",
  deepgramModel: process.env.DEEPGRAM_TTS_MODEL || "aura-2-thalia-en",
  demoKey: (process.env.DEMO_AGENT_PRIVATE_KEY || process.env.TREASURY_PRIVATE_KEY || null) as Hex | null,
  settlementMode: process.env.SETTLEMENT_MODE || "onchain",
  assetName: process.env.ASSET_NAME || "USD Coin",
  assetSymbol: process.env.ASSET_SYMBOL || "USDC",
  assetDecimals: parseInt(process.env.ASSET_DECIMALS || "6", 10),
  assetVersion: process.env.ASSET_VERSION || "2",
};

// Resolve token metadata: read on-chain when possible, else trust env config.
let tokenMeta: TokenMeta = {
  address: cfg.asset,
  name: cfg.assetName,
  symbol: cfg.assetSymbol,
  decimals: cfg.assetDecimals,
  version: cfg.assetVersion,
};

async function resolveToken() {
  if (cfg.settlementMode === "simulate") return;
  if (cfg.asset === "0x0000000000000000000000000000000000000000") return;
  try {
    tokenMeta = await readTokenMeta(cfg.network, cfg.asset);
    console.log(`🏷️  token ${tokenMeta.symbol} (${tokenMeta.name} v${tokenMeta.version}, ${tokenMeta.decimals}d)`);
  } catch (e) {
    console.warn("Could not read token metadata on-chain, using env values:", e instanceof Error ? e.message : e);
  }
}

function priceBaseUnits(): string {
  return priceToBaseUnits(cfg.price, tokenMeta.decimals);
}

function buildRequirements(request: express.Request) {
  return requirement({
    network: cfg.network,
    asset: tokenMeta.address,
    payTo: cfg.payTo,
    amount: priceBaseUnits(),
    resource: `${request.protocol}://${request.get("host")}${request.originalUrl}`,
    description: "Text-to-speech via Deepgram, paid per call over x402",
    mimeType: "audio/mpeg",
    extra: {
      name: tokenMeta.name,
      version: tokenMeta.version,
      symbol: tokenMeta.symbol,
      decimals: tokenMeta.decimals,
    },
  });
}

const app = express();
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Accept", "Authorization", "Content-Type", "Origin", "X-PAYMENT"],
    exposedHeaders: ["X-PAYMENT-RESPONSE"],
    maxAge: 24 * 60 * 60,
  }),
);
app.use(express.json());

// Developer + dashboard API (public, no paywall).
app.use("/api", dashboardApi);

// Static frontend from web/.
const WEB_DIR = resolve(process.cwd(), "web");
const page = (file: string) => (_req: express.Request, res: express.Response) => {
  try {
    res.type("html").send(readFileSync(resolve(WEB_DIR, file), "utf8"));
  } catch {
    res.status(500).send("Page unavailable");
  }
};
app.get("/", page("index.html"));
app.get("/dashboard", page("dashboard.html"));
app.get("/demo", page("demo.html"));
app.use(express.static(WEB_DIR));

// ---- Deepgram with retries (flaky network / hard connect timeout) -----------
async function deepgramSpeak(text: string, attempts = 5): Promise<Response> {
  if (!cfg.deepgramApiKey) {
    // No key configured: return a tiny valid MP3-ish placeholder so the demo
    // still returns audio bytes. Real deployments set DEEPGRAM_API_KEY.
    const silent = Buffer.from("SUQzAwAAAAAAF1RTU0UAAAANAAADTGF2ZjU4Ljc2LjEwMAAA", "base64");
    return new Response(silent, { status: 200, headers: { "content-type": "audio/mpeg" } });
  }
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(`https://api.deepgram.com/v1/speak?model=${cfg.deepgramModel}`, {
        method: "POST",
        headers: { Authorization: `Token ${cfg.deepgramApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 1500));
    }
  }
  throw lastErr;
}

// ---- Paywalled endpoint -----------------------------------------------------
app.post("/v1/speak", paywall({ facilitatorURL: cfg.facilitatorURL, buildRequirements }), async (req, res) => {
  const text = (req.body?.text as string) || "";
  if (!text.trim()) return res.status(400).json({ error: "Body must include non-empty 'text'." });
  try {
    const dg = await deepgramSpeak(text);
    if (!dg.ok) {
      const detail = await dg.text();
      return res.status(502).json({ error: "deepgram_failed", status: dg.status, detail });
    }
    const audio = Buffer.from(await dg.arrayBuffer());
    res.set("Content-Type", dg.headers.get("content-type") || "audio/mpeg");
    res.send(audio);
    console.log(`🔊 fulfilled TTS (${audio.length} bytes): "${text.slice(0, 60)}"`);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ---- House-paid demo: treasury key pays the invoice, visitor needs no wallet.
const DEMO_MAX_CHARS = parseInt(process.env.DEMO_MAX_CHARS || "300", 10);
let demoInFlight = 0;

app.post("/api/demo/speak", async (req, res) => {
  const text = ((req.body?.text as string) || "").trim();
  if (!text) return res.status(400).json({ error: "Body must include non-empty 'text'." });
  if (text.length > DEMO_MAX_CHARS)
    return res.status(400).json({ error: `Demo text is capped at ${DEMO_MAX_CHARS} characters.` });
  if (!cfg.demoKey) return res.status(503).json({ error: "Demo wallet not configured on this deployment." });
  if (demoInFlight >= 3) return res.status(429).json({ error: "Demo is busy - try again shortly." });

  demoInFlight++;
  try {
    const payer = createPayer(cfg.demoKey);
    const pay = wrapFetchWithPayment(fetch, payer);
    const r = await pay(`http://127.0.0.1:${cfg.port}/v1/speak`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!r.ok) {
      const detail = await r.text();
      return res.status(502).json({ error: "demo_speak_failed", status: r.status, detail });
    }
    const settle = r.headers.get("X-PAYMENT-RESPONSE");
    if (settle) res.set("X-PAYMENT-RESPONSE", settle);
    const audio = Buffer.from(await r.arrayBuffer());
    res.set("Content-Type", r.headers.get("content-type") || "audio/mpeg");
    res.set("Content-Disposition", 'attachment; filename="gnome.mp3"');
    res.send(audio);
    console.log(`🎁 demo TTS fulfilled (${audio.length} bytes)`);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  } finally {
    demoInFlight--;
  }
});

app.get("/health", (_req, res) => res.json({ status: "ok", service: "gnome/proxy", network: cfg.network }));

await resolveToken();
setRuntime({
  network: cfg.network,
  explorer: getChain(cfg.network).explorer,
  token: tokenMeta,
  priceBaseUnits: priceBaseUnits(),
  payTo: cfg.payTo,
  settlementMode: cfg.settlementMode,
  chainName: getChain(cfg.network).name,
  treasuryKey: (process.env.TREASURY_PRIVATE_KEY || null) as Hex | null,
});

app.listen(cfg.port, "0.0.0.0", () => {
  console.log(`🛤️  Proxy (rail) on http://0.0.0.0:${cfg.port}`);
  console.log(`    Pay-gated: POST /v1/speak @ ${priceBaseUnits()} ${tokenMeta.symbol} base units on ${cfg.network}`);
});
