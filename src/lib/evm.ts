// viem-based EVM helpers: read ERC-20 metadata, settle an EIP-3009
// authorization on-chain (facilitator pays gas), and treasury funding.

import {
  createPublicClient,
  createWalletClient,
  http,
  getAddress,
  parseSignature,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { getChain, type ChainInfo } from "./chains.js";
import type { Authorization } from "./x402.js";

// ---- ERC-20 / EIP-3009 ABI (only what we call) ------------------------------
export const ERC20_ABI = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "version", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  {
    type: "function",
    name: "transferWithAuthorization",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

export function publicClientFor(caip2: string): PublicClient {
  const info = getChain(caip2);
  return createPublicClient({ chain: info.chain, transport: http(info.rpcUrl) }) as PublicClient;
}

export function walletClientFor(caip2: string, privateKey: Hex): { client: WalletClient; info: ChainInfo; address: Address } {
  const info = getChain(caip2);
  const account = privateKeyToAccount(privateKey);
  const client = createWalletClient({ account, chain: info.chain, transport: http(info.rpcUrl) });
  return { client, info, address: account.address };
}

export interface TokenMeta {
  address: Address;
  name: string;
  symbol: string;
  decimals: number;
  version: string;
}

export async function readTokenMeta(caip2: string, token: Address): Promise<TokenMeta> {
  const pub = publicClientFor(caip2);
  const address = getAddress(token);
  const [name, symbol, decimals] = await Promise.all([
    pub.readContract({ address, abi: ERC20_ABI, functionName: "name" }) as Promise<string>,
    pub.readContract({ address, abi: ERC20_ABI, functionName: "symbol" }) as Promise<string>,
    pub.readContract({ address, abi: ERC20_ABI, functionName: "decimals" }) as Promise<number>,
  ]);
  let version = "1";
  try {
    version = (await pub.readContract({ address, abi: ERC20_ABI, functionName: "version" })) as string;
  } catch {
    /* many tokens omit version(); EIP-3009 domains conventionally use "1" or "2" */
  }
  return { address, name, symbol, decimals: Number(decimals), version };
}

export async function balanceOf(caip2: string, token: Address, owner: Address): Promise<bigint> {
  const pub = publicClientFor(caip2);
  return (await pub.readContract({
    address: getAddress(token),
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [getAddress(owner)],
  })) as bigint;
}

/** Submit an EIP-3009 authorization on-chain. The facilitator's key pays gas. */
export async function settleTransferWithAuthorization(
  caip2: string,
  facilitatorKey: Hex,
  token: Address,
  auth: Authorization,
  signature: Hex,
): Promise<string> {
  const { client, info } = walletClientFor(caip2, facilitatorKey);
  const pub = publicClientFor(caip2);
  const { r, s, v, yParity } = parseSignature(signature);
  const vNum = v ?? BigInt(27 + (yParity ?? 0));

  const hash = await client.writeContract({
    address: getAddress(token),
    abi: ERC20_ABI,
    functionName: "transferWithAuthorization",
    args: [
      getAddress(auth.from),
      getAddress(auth.to),
      BigInt(auth.value),
      BigInt(auth.validAfter),
      BigInt(auth.validBefore),
      auth.nonce,
      Number(vNum),
      r,
      s,
    ],
    chain: info.chain,
    account: client.account!,
  });
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error(`settlement reverted: ${hash}`);
  return hash;
}

/** Treasury -> recipient plain ERC-20 transfer (dashboard "fund" button). */
export async function fundTransfer(
  caip2: string,
  treasuryKey: Hex,
  token: Address,
  to: Address,
  amount: string,
): Promise<string> {
  const { client, info } = walletClientFor(caip2, treasuryKey);
  const pub = publicClientFor(caip2);
  const hash = await client.writeContract({
    address: getAddress(token),
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [getAddress(to), BigInt(amount)],
    chain: info.chain,
    account: client.account!,
  });
  await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
  return hash;
}

/** Generate a fresh EVM keypair. */
export function newWallet(): { privateKey: Hex; address: Address } {
  const privateKey = generatePrivateKey();
  const address = privateKeyToAccount(privateKey).address;
  return { privateKey, address };
}

export { privateKeyToAccount, generatePrivateKey };
