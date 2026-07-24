// src/parser/markdownToListing.js
//
// Parse free-form markdown draft into structured { name, description, category, services }
//
// Heuristic extraction (no LLM):
//   - Extract product name from "called X", "named X", or "An AI agent that..."
//   - Clean description into submit-ready text
//   - Derive concrete service from draft, no placeholders

export function markdownToListing(markdown) {
  if (!markdown || typeof markdown !== 'string') {
    throw new Error('draft must be a non-empty string');
  }
  const text = markdown.trim();
  if (text.length === 0) throw new Error('draft must be a non-empty string');

  const lines = text.split(/\r?\n/);

  // 1. Extract name using smart heuristics
  let name = extractName(text, lines);

  // 2. Clean description
  let description = extractDescription(text, lines, name);

  // 3. Derive services
  let services = extractServices(text, lines, name, description);

  // 4. Auto-fix the listing before returning
  const finalName = name || 'Untitled Agent';
  const finalDesc = description || `${finalName} is an AI-powered agent service that helps users automate their workflows on X Layer.`;

  return {
    listing: {
      name: finalName.slice(0, 25),
      description: finalDesc.slice(0, 500),
      category: inferCategory(text),
      services: services.length > 0 ? services : [deriveDefaultService(finalName, finalDesc)],
    },
    markdown: text,
  };
}

function extractName(text, lines) {
  // Priority 1: H1 heading
  for (const l of lines) {
    const t = l.trim();
    if (t.startsWith('# ') && t.length > 3) return t.slice(2).trim();
  }

  // Priority 2: "called X" or "named X" pattern
  const calledMatch = text.match(/(?:called|named)\s+["""]?([A-Z][A-Za-z0-9]+)["""]?/);
  if (calledMatch) return calledMatch[1];

  // Priority 3: "An AI agent that..." → extract key subject
  const agentMatch = text.match(/(?:An?|The)\s+(?:AI\s+)?(?:(?:agent|service|tool|bot|app)\s+)?(?:that\s+)?(is\s+)?(?:called\s+)?["""]?([A-Z][A-Za-z0-9]+)["""]?/i);
  if (agentMatch) return agentMatch[1];

  // Priority 4: "My agent is called..." or "My service is..."
  const myMatch = text.match(/My\s+(?:agent|service|bot|app|tool)\s+(?:is\s+)?(?:called\s+)?["""]?([A-Z][A-Za-z0-9]+)["""]?/i);
  if (myMatch) return myMatch[1];

  // Priority 5: First meaningful capitalized word (not stop words)
  const words = text.split(/\s+/);
  const stops = new Set(['The', 'This', 'It', 'An', 'My', 'Our', 'I', 'A', 'Is', 'Are', 'Was', 'We']);
  for (const w of words) {
    const clean = w.replace(/^["""'(*[]|["""').,!?;:*\]]$/g, '');
    if (/^[A-Z][a-z]/.test(clean) && clean.length > 2 && !stops.has(clean)) return clean;
  }

  // Fallback: first line truncated to 25 chars
  const fl = lines[0]?.trim() || '';
  return fl.replace(/^#\s*/, '').slice(0, 25).trim() || 'MyAgent';
}

function extractDescription(text, lines, name) {
  // Skip H1, find first substantial paragraph
  let paraStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith('# ')) continue;
    if (t.length > 10) { paraStart = i; break; }
  }

  const para = [];
  for (let i = paraStart; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) break;
    if (t.startsWith('#')) break;
    para.push(t);
  }

  let raw = para.join(' ').trim();
  
  // Clean up the description
  // Remove self-references like "My agent is called Name. It..."
  let clean = raw;
  if (name) {
    // Replace "My agent is called X. It does Y" → "X does Y"
    clean = clean.replace(new RegExp(`My\\s+(?:agent|service|bot|app|tool)\\s+is\\s+(?:called\\s+)?${escapeRegex(name)}[\\.,]?\\s*`, 'i'), '');
    clean = clean.replace(new RegExp(`^(?:An?|The)\\s+(?:AI\\s+)?agent\\s+(?:that|which)\\s+`, 'i'), '');
    clean = clean.replace(new RegExp(`^It\\s+(?:is\\s+)?`, 'i'), '');
  }

  clean = clean.replace(/^is\s+a\s+/i, `${name} is a `);
  
  // Capitalize first letter
  clean = clean.charAt(0).toUpperCase() + clean.slice(1);
  
  if (!clean || clean.length < 20) {
    clean = `${name} is an AI-powered agent that provides automated services for users.`;
  }

  return clean;
}

function extractServices(text, lines, name, description) {
  const services = [];

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    const hMatch = l.match(/^#{2,6}\s+(.+)/);
    if (hMatch) {
      const svcName = hMatch[1].replace(/[:\-].*$/, '').trim().slice(0, 30);
      const svcBody = [];
      i++;
      for (; i < lines.length; i++) {
        const sl = lines[i].trim();
        if (/^#{1,6}\s/.test(sl)) { i--; break; }
        if (sl) svcBody.push(sl);
      }
      const svcText = svcBody.join(' ').slice(0, 400);
      if (svcName && svcText) {
        services.push({
          name: svcName,
          description: `① ${svcText}\n② User must provide: 1. input`,
          type: 'A2MCP',
          fee: '0.01',
          endpoint: 'https://your-domain.com/api/v1/service',
        });
      }
    }
  }
  return services;
}

function inferCategory(text) {
  const lower = text.toLowerCase();
  // Check for specific contexts before single keywords
  if (/crypto|defi|yield|swap|lend|borrow|invest|portfolio|trading|cex|dex/.test(lower)) return 'FINANCE';
  if (/nft\s+(?:market|collect|art|mint|trade)|digital\s+art|collectible/.test(lower)) return 'NFT';
  if (/game|gaming|play-to|metaverse/.test(lower)) return 'GAMING';
  if (/social|messaging|chat|telegram|discord|community/.test(lower)) return 'SOCIAL';
  if (/data|analytics|monitoring|dashboard/.test(lower)) return 'DATA_ANALYTICS';
  if (/security|audit|monitor|alerts/.test(lower)) return 'SECURITY';
  if (/dev(?:eloper)?\s+tools?|api|deploy|infrastructure|sdk/.test(lower)) return 'DEVELOPER_TOOLS';
  return 'SOFTWARE_SERVICES';
}

function deriveDefaultService(name, description) {
  // Derive a concrete service from the name/description instead of placeholder
  const actionVerbs = ['analyze', 'monitor', 'track', 'optimize', 'generate', 'validate', 'check', 'report'];
  let verb = 'provide';
  for (const v of actionVerbs) {
    if (description.toLowerCase().includes(v)) { verb = v; break; }
  }
  
  const svcDesc = `① ${description || `${name} provides automated services.`}\n② User must provide: 1. input`;

  return {
    name: name.slice(0, 30),
    description: svcDesc,
    type: 'A2MCP',
    fee: '0.01',
    endpoint: null,
  };
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
