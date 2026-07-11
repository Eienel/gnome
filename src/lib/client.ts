// Client side of x402: given a private key, a 402 response, and its payment
// requirements, sign an EIP-3009 authorization and replay the request with the
// X-PAYMENT header. `wrapFetchWithPayment` makes this automatic.

import { getAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getChain } from "./chains.js";
import {
  encodePayment,
  randomNonce,
  typedDataForAuth,
  X402_VERSION,
  type Authorization,
  type PaymentPayload,
  type PaymentRequirements,
} from "./x402.js";

export interface Payer {
  address: Hex;
  sign(req: PaymentRequirements): Promise<PaymentPayload>;
}

/** Build a payer from a raw private key. */
export function createPayer(privateKey: Hex): Payer {
  const account = privateKeyToAccount(privateKey);
  return {
    address: account.address,
    async sign(req: PaymentRequirements): Promise<PaymentPayload> {
      const chainId = getChain(req.network).chainId;
      const now = Math.floor(Date.now() / 1000);
      const auth: Authorization = {
        from: account.address,
        to: getAddress(req.payTo),
        value: req.maxAmountRequired,
        validAfter: String(now - 60),
        validBefore: String(now + (req.maxTimeoutSeconds || 300)),
        nonce: randomNonce(),
      };
      const td = typedDataForAuth(req, chainId, auth);
      const signature = await account.signTypedData({
        domain: td.domain,
        types: td.types,
        primaryType: td.primaryType,
        message: td.message,
      });
      return {
        x402Version: X402_VERSION,
        scheme: "exact",
        network: req.network,
        payload: { signature, authorization: auth },
      };
    },
  };
}

export interface Accepts {
  x402Version: number;
  accepts: PaymentRequirements[];
  error?: string;
}

export type NetworkSelector = (opts: PaymentRequirements[]) => PaymentRequirements;

/** Default: prefer Robinhood/eip155, else first option. */
export const preferEvm: NetworkSelector = opts =>
  opts.find(o => o.network.startsWith("eip155:")) || opts[0];

/**
 * Wrap fetch so any 402 is paid automatically and the request replayed once.
 */
export function wrapFetchWithPayment(
  baseFetch: typeof fetch,
  payer: Payer,
  select: NetworkSelector = preferEvm,
): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const first = await baseFetch(input, init);
    if (first.status !== 402) return first;

    const body = (await first.clone().json().catch(() => null)) as Accepts | null;
    if (!body?.accepts?.length) return first;

    const requirements = select(body.accepts);
    const payment = await payer.sign(requirements);
    const headers = new Headers(init?.headers);
    headers.set("X-PAYMENT", encodePayment(payment));

    return baseFetch(input, { ...init, headers });
  }) as typeof fetch;
}
