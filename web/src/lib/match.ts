// Client mirror of the server's whole-word forbidden matcher (validation.ts),
// used only for instant local highlighting. The server remains authoritative.

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildForbiddenRegex(forbidden: string[]): RegExp | null {
  const terms = forbidden.map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (terms.length === 0) return null;
  const alts = terms
    .sort((a, b) => b.length - a.length) // prefer longest phrase match
    .map((t) => t.split(/\s+/).map(escapeRe).join('\\s+'));
  return new RegExp(`(?<![\\p{L}\\p{N}])(${alts.join('|')})(?![\\p{L}\\p{N}])`, 'giu');
}

export interface Segment {
  text: string;
  forbidden: boolean;
}

/** Split text into plain/forbidden segments for highlight rendering. */
export function segmentForbidden(text: string, forbidden: string[]): Segment[] {
  const re = buildForbiddenRegex(forbidden);
  if (!re) return [{ text, forbidden: false }];
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    if (start > last) out.push({ text: text.slice(last, start), forbidden: false });
    out.push({ text: m[0], forbidden: true });
    last = start + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), forbidden: false });
  return out;
}
