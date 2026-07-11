// Generate an EVM keypair for the agent / treasury / facilitator.
//   npm run keygen

import { newWallet } from "../lib/evm.js";

const { privateKey, address } = newWallet();

console.log("\n🔑 Generated EVM keypair");
console.log("──────────────────────────────────────────────────────────");
console.log(`address      : ${address}`);
console.log(`private key  : ${privateKey}`);
console.log("──────────────────────────────────────────────────────────");
console.log("Wire it into .env:");
console.log(`  • Agent:        CLIENT_PRIVATE_KEY=${privateKey}`);
console.log(`  • Payee:        PAYEE_ADDRESS=${address}`);
console.log(`  • Facilitator:  FACILITATOR_PRIVATE_KEY=${privateKey}`);
console.log(`  • Treasury:     TREASURY_PRIVATE_KEY=${privateKey}`);
console.log("\nFund this address with the payment token (and native gas for the facilitator).\n");
