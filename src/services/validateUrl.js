// src/services/validateUrl.js — Prevent SSRF by blocking private/internal URLs

import { URL } from 'node:url';

// Common private/reserved IP patterns
const PRIVATE_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^198\.1[89]\./,
  /^169\.254\./,
];

export function validatePublicUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') {
    throw new Error('URL must be a non-empty string');
  }
  if (!/^https:\/\//i.test(urlString)) {
    throw new Error('URL must start with https://');
  }

  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error('Invalid URL');
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block localhost, common internal names
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '[::1]' ||
    hostname === '::1' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.lan') ||
    hostname.endsWith('.' + 'localdomain')
  ) {
    throw new Error('URL must not point to a private or local address');
  }

  // Block private IP ranges
  for (const pattern of PRIVATE_PATTERNS) {
    if (pattern.test(hostname)) {
      throw new Error('URL must not point to a private IP range');
    }
  }

  return urlString;
}
