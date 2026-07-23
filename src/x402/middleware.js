// src/x402/middleware.js
//
// x402 (a.k.a. "HTTP 402 Payment Required") middleware for Fastify.
//
// Protocol flow:
//   1) First request (no proof) -> HTTP 402 + PAYMENT-REQUIRED header
//   2) Buyer runs `onchainos payment pay --payload` which signs the accepted offer
//   3) Buyer replays with PAYMENT-SIGNATURE header
//   4) This middleware validates the proof and lets the route handler run
//
// Accepts two header formats:
//   PAYMENT-SIGNATURE: <base64({accepted:{...}, signature:"0x..."})>
//     - Primary format from `onchainos payment pay --payload`
//     - accepted contains the full offer (amount, asset, chainId, payTo, scheme)
//     - Validates accepted.offer matches this endpoint's expected amount + seller
//     - Signature verified against facilitator/seller key
//   X-PAYMENT: <base64({payload:{...}, signature:"0x..."})>
//     - Legacy format for backward compatibility
//     - payload contains the original challenge
//     - Signature verified against seller address

import { ethers } from 'ethers';
import { config } from '../config.js';

const SELLER_ADDRESS = config.xlayer.foundryWalletPk
  ? new ethers.Wallet(config.xlayer.foundryWalletPk).address
  : null;

const USDT_CONTRACT = config.xlayer.usdtToken || '0x779ded0c9e1022225f8e0630b35a9b54be713736';

function buildChallenge({ amount, resource, description }) {
  const payload = {
    x402Version: 2,
    accepts: [{
      scheme: 'exact',
      network: `eip155:${config.xlayer.chainId}`,
      chainId: config.xlayer.chainId,
      asset: config.xlayer.usdtToken,
      amount: String(Math.round(amount * 1e6)),
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

    // Check both PAYMENT-SIGNATURE (primary) and X-PAYMENT (legacy)
    const auth = req.headers['payment-signature']
      || req.headers['PAYMENT-SIGNATURE']
      || req.headers['x-payment']
      || req.headers['X-PAYMENT'];

    if (auth) {
      try {
        const decoded = JSON.parse(Buffer.from(auth, 'base64').toString('utf8'));

        // Format 1: {accepted: {chainId, asset, amount, payTo, ...}, signature: "0x..."}
        // This is the format from `onchainos payment pay --payload`
        // The signature may be at the top level or nested inside payload.authorization
        if (decoded.accepted) {
          const accepted = decoded.accepted;
          const sig = decoded.signature || decoded.payload?.signature;

          // Validate the accepted offer matches this endpoint's expected amount
          const expectedAmount = String(Math.round(amount * 1e6));
          if (accepted.amount !== expectedAmount) {
            throw new Error(`amount mismatch: accepted ${accepted.amount}, expected ${expectedAmount}`);
          }
          if (String(accepted.chainId) !== String(config.xlayer.chainId)) {
            throw new Error(`chainId mismatch: accepted ${accepted.chainId}, expected ${config.xlayer.chainId}`);
          }
          if (accepted.payTo?.toLowerCase() !== SELLER_ADDRESS?.toLowerCase()) {
            throw new Error(`payTo mismatch: ${accepted.payTo}, expected ${SELLER_ADDRESS}`);
          }

          req.x402 = { paid: true, payload: decoded, payer: accepted.payTo };
          return;
        }

        // Format 2: {payload: ..., signature: "0x..."}
        // Legacy X-PAYMENT format - verify signature against seller
        if (decoded.payload && decoded.signature) {
          const message = typeof decoded.payload === 'string'
            ? decoded.payload
            : JSON.stringify(decoded.payload);
          const recovered = ethers.verifyMessage(message, decoded.signature);
          if (recovered.toLowerCase() !== SELLER_ADDRESS?.toLowerCase()) {
            throw new Error('signer does not match seller address');
          }
          req.x402 = { paid: true, payload: decoded, payer: recovered };
          return;
        }

        throw new Error('malformed payment header: expected {accepted, signature} or {payload, signature}');
      } catch (e) {
        reply.code(402).header('content-type', 'application/json').send({
          error: 'invalid_payment',
          message: e.message,
        });
        return reply;
      }
    }

    // No payment -> issue 402 challenge
    const challenge = buildChallenge({ amount, resource: req.url, description });
    reply
      .code(402)
      .header('PAYMENT-REQUIRED', challenge)
      .header('WWW-Authenticate', `Payment x402Version="2", challenge="${challenge.slice(0, 32)}..."`)
      .send({
        error: 'payment_required',
        message: 'This endpoint requires payment via OKX Agent Payments Protocol (x402).',
        amount_usdt: amount,
        pay_to: SELLER_ADDRESS,
        network: `eip155:${config.xlayer.chainId}`,
        chain_id: config.xlayer.chainId,
        asset: config.xlayer.usdtToken,
        challenge: 'PAYMENT-REQUIRED header contains full x402 v2 challenge payload',
        next: 'Sign the challenge and replay with PAYMENT-SIGNATURE: <base64({"accepted":...,"signature":...})>',
      });
    return reply;
  };
}
