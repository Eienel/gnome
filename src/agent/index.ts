// Reference agent: holds an EVM private key + a token budget on Robinhood Chain.
// It calls the rail, gets a 402, signs the EIP-3009 authorization, replays, and
// saves the returned audio. Its balance is its hard cap.

import "dotenv/config";
import { writeFileSync } from "node:fs";
import type { Hex } from "viem";
import { createPayer, wrapFetchWithPayment } from "../lib/client.js";
import { decodeSettleReceipt } from "../lib/x402.js";

const privateKey = (process.env.CLIENT_PRIVATE_KEY || "") as Hex;
const baseURL = process.env.SERVER_URL || "http://localhost:4021";
const endpointPath = process.env.ENDPOINT_PATH || "/v1/speak";
const text = process.env.TEXT || "Hello. I am an autonomous agent, and I just paid for this sentence on Robinhood Chain.";
const outFile = process.env.OUT_FILE || "out.mp3";

async function main() {
  if (!privateKey) {
    console.error("❌ CLIENT_PRIVATE_KEY is required (0x-prefixed EVM private key)");
    process.exit(1);
  }
  const payer = createPayer(privateKey);
  const pay = wrapFetchWithPayment(fetch, payer);
  const url = `${baseURL}${endpointPath}`;

  console.log(`🤖 Agent ${payer.address} requesting TTS from ${url}`);
  console.log(`   "${text}"`);

  const res = await pay(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    console.error(`❌ Request failed (${res.status}): ${await res.text()}`);
    process.exit(1);
  }

  const audio = Buffer.from(await res.arrayBuffer());
  writeFileSync(outFile, audio);
  console.log(`✅ Got ${audio.length} bytes of audio -> ${outFile}`);

  const receipt = res.headers.get("X-PAYMENT-RESPONSE");
  if (receipt) {
    const settle = decodeSettleReceipt(receipt);
    console.log("💰 Payment settled:", settle.transaction, `(payer ${settle.payer})`);
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
