// Resource-server x402 middleware. Gates a route: returns 402 + payment
// requirements when unpaid, and on an X-PAYMENT header verifies + settles the
// authorization through the facilitator before letting the request through.

import type { NextFunction, Request, Response } from "express";
import type { Address } from "viem";
import {
  decodePayment,
  encodeSettleReceipt,
  X402_VERSION,
  type PaymentRequirements,
  type SettleResponse,
  type VerifyResponse,
} from "../lib/x402.js";

export interface PaywallOptions {
  facilitatorURL: string;
  buildRequirements: (req: Request) => PaymentRequirements;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await r.json()) as T;
}

export function paywall(opts: PaywallOptions) {
  return async function (req: Request, res: Response, next: NextFunction) {
    const requirements = opts.buildRequirements(req);
    const header = req.header("X-PAYMENT");

    if (!header) {
      res.status(402).json({
        x402Version: X402_VERSION,
        accepts: [requirements],
        error: "payment_required",
      });
      return;
    }

    let payload;
    try {
      payload = decodePayment(header);
    } catch {
      res.status(402).json({ x402Version: X402_VERSION, accepts: [requirements], error: "bad_payment_header" });
      return;
    }

    try {
      const verify = await post<VerifyResponse>(`${opts.facilitatorURL}/verify`, {
        paymentPayload: payload,
        paymentRequirements: requirements,
      });
      if (!verify.isValid) {
        res.status(402).json({ x402Version: X402_VERSION, accepts: [requirements], error: verify.invalidReason });
        return;
      }

      const settle = await post<SettleResponse>(`${opts.facilitatorURL}/settle`, {
        paymentPayload: payload,
        paymentRequirements: requirements,
      });
      if (!settle.success) {
        res.status(402).json({ x402Version: X402_VERSION, accepts: [requirements], error: settle.errorReason });
        return;
      }

      res.set("X-PAYMENT-RESPONSE", encodeSettleReceipt(settle));
      res.set("Access-Control-Expose-Headers", "X-PAYMENT-RESPONSE");
      (req as Request & { settlement?: SettleResponse }).settlement = settle;
      next();
    } catch (err) {
      res.status(502).json({
        x402Version: X402_VERSION,
        accepts: [requirements],
        error: err instanceof Error ? err.message : "facilitator_unreachable",
      });
    }
  };
}

export function requirement(fields: {
  network: string;
  asset: Address;
  payTo: Address;
  amount: string;
  resource: string;
  description: string;
  mimeType: string;
  extra: PaymentRequirements["extra"];
  maxTimeoutSeconds?: number;
}): PaymentRequirements {
  return {
    scheme: "exact",
    network: fields.network,
    maxAmountRequired: fields.amount,
    asset: fields.asset,
    payTo: fields.payTo,
    resource: fields.resource,
    description: fields.description,
    mimeType: fields.mimeType,
    maxTimeoutSeconds: fields.maxTimeoutSeconds ?? 300,
    extra: fields.extra,
  };
}
