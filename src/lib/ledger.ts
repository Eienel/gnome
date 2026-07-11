// Append-only settlement ledger. The facilitator records every on-chain x402
// settlement here; the dashboard reads it for usage + payment history.

import { appendFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Read lazily so a dotenv-loaded LEDGER_PATH is honored (dotenv runs after
// this module is imported).
const ledgerPath = () => process.env.LEDGER_PATH || "data/ledger.jsonl";

export interface Settlement {
  payer: string; // 0x address
  transaction: string; // tx hash
  amount: string; // token base units
  asset: string; // token contract address
  network: string; // CAIP-2
  ts: string; // ISO
}

export function recordSettlement(s: Settlement): void {
  mkdirSync(dirname(ledgerPath()), { recursive: true });
  appendFileSync(ledgerPath(), JSON.stringify(s) + "\n");
}

export function readSettlements(): Settlement[] {
  if (!existsSync(ledgerPath())) return [];
  return readFileSync(ledgerPath(), "utf8")
    .split("\n")
    .filter(Boolean)
    .map(l => JSON.parse(l) as Settlement)
    .reverse(); // newest first
}
