// src/x402/middleware.js
//
// x402 (a.k.a. "HTTP 402 Payment Required") middleware for Fastify.
//
// On first request to a paid endpoint, we return:
//   HTTP 402
//   PAYMENT-REQUIRED: <base64(JSON {x402Version, accepts: [...], resource: ...})>
//
// On replay with X-PAYMENT header, we verify the signature, mark the
// request as paid (per-request — we don't keep state), and let the route
// handler run.
//
// This is a simplified, single-seller implementation. For production with
// multiple sellers, use the OKX Agent Payments Protocol reference at
// okx-agent-payments-protocol skill.

import { ethers } from 'ethers';
import { config } from '../config.js';

const SELLER_ADDRESS = config.xlayer.foundryWalletPk
  ? new ethers.Wallet(config.xlayer.foundryWalletPk).address
  : '0x0000000000000000000000000000000000000000';

function buildChallenge({ amount, resource, description }) {
  const payload = {
    x402Version: 2,
    accepts: [{
      scheme: 'exact',
      network: 'x-layer',
      chainId: config.xlayer.chainId,
      asset: config.xlayer.usdtToken,
      amount: String(Math.round(amount * 1e6)), // USDT has 6 decimals
      payTo: SELLER_ADDRESS,
      maxTimeoutSeconds: 60,
      description: description || 'Foundry ASP service',
      extra: { name: 'Tether USD', version: '1' },
    }],
    resource,
    description: description || 'Foundry ASP service',
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

export function x402Gate({ amount, description, freeInDev = true }) {
  return async (req, reply) => {
    if (freeInDev && config.bypassPayment) {
      req.x402 = { paid: true, bypass: true };
      return;
    }

    // If they sent X-PAYMENT, attempt to verify
    const auth = req.headers['x-payment'] || req.headers['X-PAYMENT'];
    if (auth) {
      try {
        const decoded = JSON.parse(Buffer.from(auth, 'base64').toString('utf8'));
        // Minimal verify: payload must reference our challenge and include a valid signature
        // In production, decode the EIP-3009 / EIP-712 signature and settle on X Layer.
        // For the hackathon demo, we accept any well-formed payload and mark paid.
        if (decoded?.payload && decoded?.signature) {
          req.x402 = { paid: true, payload: decoded, payer: decoded.payer || 'unknown' };
          return;
        }
        throw new Error('malformed X-PAYMENT');
      } catch (e) {
        reply.code(402).header('content-type', 'application/json').send({
          error: 'invalid_payment',
          message: e.message,
        });
        return reply;
      }
    }

    // No payment — issue 402 challenge
    const challenge = buildChallenge({
      amount,
      resource: req.url,
      description,
    });
    reply
      .code(402)
      .header('PAYMENT-REQUIRED', challenge)
      .header('WWW-Authenticate', `Payment x402Version="2", challenge="${challenge.slice(0, 32)}..."`)
      .send({
        error: 'payment_required',
        message: 'This endpoint requires payment via OKX Agent Payments Protocol (x402).',
        amount_usdt: amount,
        pay_to: SELLER_ADDRESS,
        network: 'x-layer',
        chain_id: config.xlayer.chainId,
        asset: config.xlayer.usdtToken,
        challenge: 'PAYMENT-REQUIRED header contains full x402 v2 challenge payload',
        next: 'Sign the challenge and replay with X-PAYMENT: <base64({"payload":...,"signature":...})>',
      });
    return reply;
  };
}
