// src/services/bootstrapTrust.js
//
// Service 4: bootstrap-trust
// Input:  { endpoint: string, service_name?: string, caller_wallet?: string }
// Output: { receipt_id, response_hash, latency_ms, schema_valid, signature, badge_url, signed_at }
//
// The idea: a brand-new ASP has no reputation. Their first few buyers take
// a risk. Foundry offers to (a) verify the endpoint is live, (b) measure
// latency, (c) check the response shape, (d) sign a receipt that the seller
// can show in their X post as "Foundry Verified".
//
// Implementation: we actually CALL the seller's endpoint, measure latency,
// check that the response is valid JSON, and sign an EIP-191 message that
// hashes the response body + endpoint + timestamp.

import { ethers } from 'ethers';
import { supabase } from '../db/supabase.js';
import { config } from '../config.js';

const SELLER_ABI = ['function balanceOf(address) view returns (uint256)'];
const MAX_RESPONSE_BYTES = 100_000;

let _wallet = null;
function getWallet() {
  if (_wallet) return _wallet;
  if (!config.xlayer.foundryWalletPk) {
    throw new Error('FOUNDRY_WALLET_PK not set — cannot sign receipts');
  }
  _wallet = new ethers.Wallet(config.xlayer.foundryWalletPk);
  return _wallet;
}

function isValidUrl(s) {
  try { new URL(s); return true; } catch { return false; }
}

function validateShape(body) {
  if (typeof body !== 'object' || body === null) return false;
  // Loose schema check: must have at least one string and one number, OR a known OKX.AI envelope
  if (body.error || body.message || body.data || body.result) return true;
  const hasString = Object.values(body).some((v) => typeof v === 'string' && v.length > 0);
  const hasNumber = Object.values(body).some((v) => typeof v === 'number');
  return hasString && hasNumber;
}

export async function bootstrapTrust({ endpoint, service_name, caller_wallet }) {
  if (!endpoint || !isValidUrl(endpoint)) {
    throw new Error('endpoint must be a valid URL');
  }
  if (!/^https:\/\//.test(endpoint)) {
    throw new Error('endpoint must be https://');
  }

  const t0 = Date.now();
  let responseBody = null;
  let responseText = '';
  let schemaValid = false;
  let httpOk = false;
  let errorMessage = null;

  try {
    const r = await fetch(endpoint, {
      method: 'GET',
      headers: { 'accept': 'application/json', 'user-agent': 'Foundry-ASP/0.1 (bootstrap-trust)' },
      signal: AbortSignal.timeout(8000),
      redirect: 'follow',
    });
    httpOk = r.ok;
    responseText = (await r.text()).slice(0, MAX_RESPONSE_BYTES);
    try {
      responseBody = JSON.parse(responseText);
      schemaValid = validateShape(responseBody);
    } catch {
      schemaValid = false;
    }
  } catch (e) {
    errorMessage = e.message;
  }
  const latencyMs = Date.now() - t0;

  // Hash the response (empty string if no response)
  const responseHash = ethers.keccak256(ethers.toUtf8Bytes(responseText || ''));

  // Build the receipt payload
  const signedAt = new Date().toISOString();
  const receiptPayload = {
    endpoint,
    service_name: service_name || null,
    caller_wallet: caller_wallet || null,
    http_ok: httpOk,
    latency_ms: latencyMs,
    schema_valid: schemaValid,
    response_hash: responseHash,
    signed_at: signedAt,
    error: errorMessage,
    foundry_version: '0.1.0',
    chain_id: config.xlayer.chainId,
  };

  // Sign with the Foundry EOA
  const wallet = getWallet();
  const messageJson = JSON.stringify(receiptPayload, Object.keys(receiptPayload).sort());
  const signature = await wallet.signMessage(messageJson);

  // Persist
  let dbId = null;
  try {
    const { data, error } = await supabase
      .from('trust_receipts')
      .insert({
        endpoint,
        caller_wallet: caller_wallet || null,
        service_name: service_name || null,
        response_hash: responseHash,
        latency_ms: latencyMs,
        schema_valid: schemaValid,
        signature,
        receipt_uri: null, // set after seller claims it
        fee_paid: 0.001,
      })
      .select('id')
      .single();
    if (!error) dbId = data?.id;
  } catch (e) {
    console.warn('[trust] persist failed:', e.message);
  }

  // Build a Foundry Verified badge URL (sellers can include this in their X post)
  const badgeUrl = `${config.publicUrl}/v1/badge/${dbId || 'pending'}.svg`;

  return {
    receipt_id: dbId,
    endpoint,
    service_name: service_name || null,
    http_ok: httpOk,
    latency_ms: latencyMs,
    schema_valid: schemaValid,
    response_hash: responseHash,
    signature,
    signed_at: signedAt,
    verifier: wallet.address,
    badge_url: badgeUrl,
    foundry_verdict: schemaValid && httpOk
      ? 'VERIFIED — endpoint live, returns valid JSON'
      : httpOk
      ? 'REACHABLE — endpoint responds but JSON shape is weak'
      : 'UNREACHABLE — listing will likely be rejected on health check',
  };
}
