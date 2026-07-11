// The x402 "exact" scheme for EVM chains, built on EIP-3009
// `transferWithAuthorization`. This is the same wire shape the x402 standard
// uses on EVM: the client signs an EIP-712 TransferWithAuthorization off-chain,
// and the facilitator submits it on-chain (paying gas). The payment is a real
// ERC-20 transfer that either lands on Robinhood Chain or the request is refused.

import {
  getAddress,
  hexToNumber,
  keccak256,
  toHex,
  verifyTypedData,
  type Address,
  type Hex,
} from "viem";

export const X402_VERSION = 1;

/** EIP-3009 authorization signed by the payer. */
export interface Authorization {
  from: Address;
  to: Address;
  value: string; // uint256, base units of the token
  validAfter: string; // unix seconds
  validBefore: string; // unix seconds
  nonce: Hex; // bytes32
}

export interface ExactEvmPayload {
  signature: Hex;
  authorization: Authorization;
}

export interface PaymentPayload {
  x402Version: number;
  scheme: "exact";
  network: string; // CAIP-2, e.g. "eip155:42161"
  payload: ExactEvmPayload;
}

export interface PaymentRequirements {
  scheme: "exact";
  network: string;
  /** Max token amount (base units) the resource will charge. */
  maxAmountRequired: string;
  /** ERC-20 token contract address. */
  asset: Address;
  /** Recipient of the payment. */
  payTo: Address;
  resource: string;
  description: string;
  mimeType: string;
  maxTimeoutSeconds: number;
  /** EIP-712 domain fields for the token + display metadata. */
  extra: {
    name: string; // EIP-712 domain name of the token
    version: string; // EIP-712 domain version
    symbol: string;
    decimals: number;
  };
}

export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  payer?: Address;
}

export interface SettleResponse {
  success: boolean;
  errorReason?: string;
  transaction?: string;
  network?: string;
  payer?: Address;
}

// ---- EIP-712 typed data -----------------------------------------------------

export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export function eip712Domain(req: PaymentRequirements, chainId: number) {
  return {
    name: req.extra.name,
    version: req.extra.version,
    chainId,
    verifyingContract: getAddress(req.asset),
  } as const;
}

export function typedDataForAuth(req: PaymentRequirements, chainId: number, auth: Authorization) {
  return {
    domain: eip712Domain(req, chainId),
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization" as const,
    message: {
      from: getAddress(auth.from),
      to: getAddress(auth.to),
      value: BigInt(auth.value),
      validAfter: BigInt(auth.validAfter),
      validBefore: BigInt(auth.validBefore),
      nonce: auth.nonce,
    },
  };
}

/** Random 32-byte nonce for an authorization. */
export function randomNonce(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return keccak256(toHex(bytes));
}

// ---- HTTP header codec ------------------------------------------------------
// The x402 payload rides in the `X-PAYMENT` request header (base64 JSON) and
// the settlement receipt rides back in `X-PAYMENT-RESPONSE`.

export function encodePayment(payload: PaymentPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

export function decodePayment(header: string): PaymentPayload {
  const json = Buffer.from(header, "base64").toString("utf8");
  return JSON.parse(json) as PaymentPayload;
}

export function encodeSettleReceipt(r: SettleResponse): string {
  return Buffer.from(JSON.stringify(r), "utf8").toString("base64");
}

export function decodeSettleReceipt(header: string): SettleResponse {
  return JSON.parse(Buffer.from(header, "base64").toString("utf8")) as SettleResponse;
}

// ---- Offline verification ---------------------------------------------------
// Checks the signature, the recipient, the amount, and the time window before
// any on-chain submission. Balance/allowance is proven by the settlement tx.

export async function verifyAuthorization(
  payload: PaymentPayload,
  req: PaymentRequirements,
  chainId: number,
): Promise<VerifyResponse> {
  const { authorization: auth, signature } = payload.payload;

  if (payload.scheme !== "exact") return { isValid: false, invalidReason: "unsupported_scheme" };
  if (payload.network !== req.network)
    return { isValid: false, invalidReason: "network_mismatch" };

  try {
    if (getAddress(auth.to) !== getAddress(req.payTo))
      return { isValid: false, invalidReason: "wrong_payee" };
  } catch {
    return { isValid: false, invalidReason: "bad_address" };
  }

  let value: bigint;
  try {
    value = BigInt(auth.value);
  } catch {
    return { isValid: false, invalidReason: "bad_value" };
  }
  if (value <= 0n) return { isValid: false, invalidReason: "non_positive_value" };
  if (value > BigInt(req.maxAmountRequired))
    return { isValid: false, invalidReason: "amount_exceeds_required" };

  const now = Math.floor(Date.now() / 1000);
  if (Number(auth.validAfter) > now) return { isValid: false, invalidReason: "not_yet_valid" };
  if (Number(auth.validBefore) < now + 5)
    return { isValid: false, invalidReason: "authorization_expired" };

  const td = typedDataForAuth(req, chainId, auth);
  let ok = false;
  try {
    ok = await verifyTypedData({
      address: getAddress(auth.from),
      domain: td.domain,
      types: td.types,
      primaryType: td.primaryType,
      message: td.message,
      signature,
    });
  } catch {
    return { isValid: false, invalidReason: "signature_verify_error" };
  }
  if (!ok) return { isValid: false, invalidReason: "invalid_signature" };

  return { isValid: true, payer: getAddress(auth.from) };
}

/** Parse a "$0.001"-style price or a raw base-unit integer into base units. */
export function priceToBaseUnits(price: string, decimals: number): string {
  const trimmed = price.trim();
  if (/^\d+$/.test(trimmed)) return trimmed; // already base units
  const dollars = trimmed.replace(/^\$/, "");
  if (!/^\d+(\.\d+)?$/.test(dollars)) throw new Error(`Bad price: ${price}`);
  const [whole, frac = ""] = dollars.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fracPadded || "0")).toString();
}

export { hexToNumber };
