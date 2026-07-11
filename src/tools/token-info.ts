// Inspect the payment token: read its ERC-20 + EIP-712 (EIP-3009) domain so you
// can confirm it's usable as the x402 asset on the configured network.
//   npm run token-info -- <tokenAddress>

import "dotenv/config";
import { getAddress } from "viem";
import { primaryNetwork, getChain } from "../lib/chains.js";
import { readTokenMeta } from "../lib/evm.js";

async function main() {
  const token = process.argv[2] || process.env.ASSET_ADDRESS;
  if (!token) {
    console.error("Usage: npm run token-info -- <tokenAddress>  (or set ASSET_ADDRESS)");
    process.exit(1);
  }
  const network = primaryNetwork();
  const chain = getChain(network);
  console.log(`Network: ${chain.name} (${network})  RPC ${chain.rpcUrl}`);
  const meta = await readTokenMeta(network, getAddress(token));
  console.log("\n🏷️  Token");
  console.log("──────────────────────────────────────────────");
  console.log(`address  : ${meta.address}`);
  console.log(`name     : ${meta.name}`);
  console.log(`symbol   : ${meta.symbol}`);
  console.log(`decimals : ${meta.decimals}`);
  console.log(`version  : ${meta.version}   (EIP-712 domain version)`);
  console.log("\nEIP-712 domain used for x402 authorizations:");
  console.log(JSON.stringify({ name: meta.name, version: meta.version, chainId: chain.chainId, verifyingContract: meta.address }, null, 2));
  console.log("\nSet in .env:  ASSET_ADDRESS=" + meta.address);
}

main().catch(e => {
  console.error("token-info failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
