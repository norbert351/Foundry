// src/parser/markdownToListing.js
//
// Convert the frontend's free-form markdown draft into the structured
// { name, description, category, services: [...] } shape that Foundry's
// 4 services expect.
//
// Heuristic (no LLM — must be fast + free since the linter is the preview):
//   - H1 line → name
//   - First paragraph (until blank line) → description
//   - Sections under "## Service", "## API", "## Endpoint" → one service each
//   - If no services found, synthesize one: name="Service", description=draft body
//   - Default category → SOFTWARE_SERVICES
//
// Output: { listing: {...}, markdown: originalDraft } — pass listing to the
// 4 services; pass markdown along for any service that wants the raw text.

export function markdownToListing(markdown) {
  if (!markdown || typeof markdown !== 'string') {
    throw new Error('draft must be a non-empty string');
  }
  const text = markdown.trim();
  if (text.length === 0) throw new Error('draft must be a non-empty string');

  const lines = text.split(/\r?\n/);

  // 1. Find H1 (name)
  let name = '';
  let i = 0;
  for (; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l.startsWith('# ')) { name = l.slice(2).trim(); i++; break; }
    if (l.length > 0) { name = l.slice(0, 60); break; }  // first non-empty line is the name
  }

  // 2. Find first paragraph (description)
  let description = '';
  let para = [];
  for (; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l === '') { if (para.length) break; else continue; }
    if (l.startsWith('## ')) { i--; break; }  // back up; section starts
    para.push(l);
  }
  description = para.join(' ').slice(0, 500);

  // 3. Find service sections
  // A "service section" is any `## Header` block. We treat each H2 (or deeper)
  // as a separate service. The H1 + first paragraph is the agent identity; the
  // remaining H2+ sections are the services.
  const services = [];
  while (i < lines.length) {
    const l = lines[i].trim();
    if (/^#{2,6}\s+/.test(l)) {
      // Strip leading #'s and trailing colon/dash
      const svcName = l.replace(/^#{2,6}\s+/, '').replace(/[:\-].*$/, '').trim().slice(0, 30);
      const svcBody = [];
      i++;
      for (; i < lines.length; i++) {
        const sl = lines[i].trim();
        if (/^#{2,6}\s+/.test(sl)) break;
        if (sl === '' && svcBody.length > 6) break;
        svcBody.push(sl);
      }
      const svcText = svcBody.filter(Boolean).join(' ').slice(0, 400);
      if (svcText.length > 0 && svcName) {
        services.push({
          name: svcName,
          description: `① ${svcText}\n② User must provide: 1. input`,
          type: 'A2MCP',
          fee: '0.01',
          endpoint: 'https://api.example.com/v1',
        });
      }
    } else {
      i++;
    }
  }

  // 4. If no services found, synthesize one from the whole draft body
  if (services.length === 0) {
    const body = lines.slice(i).filter(Boolean).join(' ').slice(0, 400);
    if (body.length > 0) {
      services.push({
        name: name || 'Service',
        description: `① ${body}\n② User must provide: 1. input`,
        type: 'A2MCP',
        fee: '0.01',
        endpoint: 'https://api.example.com/v1',
      });
    }
  }

  // 5. Default fallback
  if (services.length === 0) {
    services.push({
      name: 'Default Service',
      description: '① A service.\n② User must provide: 1. input',
      type: 'A2MCP',
      fee: '0.01',
      endpoint: 'https://api.example.com/v1',
    });
  }

  return {
    listing: {
      name: name || 'Untitled Agent',
      description: description || text.slice(0, 200),
      category: 'SOFTWARE_SERVICES',
      services,
    },
    markdown: text,
  };
}
