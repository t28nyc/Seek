/** Keyword matching used by the RRP table and keyword settings. No database access — safe in the browser. */

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export const tokens = (s: string) => norm(s).split(/[^a-z0-9]+/).filter(Boolean);

/**
 * A phrase matches when every word in it appears in the text, in any order.
 * Words match the start of a word ("pack" matches "packs"); numbers must match exactly ("3" ≠ "36").
 */
export function phraseMatches(textTokens: string[], phrase: string): boolean {
  const words = tokens(phrase);
  return words.length > 0 && words.every((w) => textTokens.some((t) => (/^\d+$/.test(w) ? t === w : t.startsWith(w))));
}

/** Does the text match any of a comma-separated list of phrases? */
export function matchesAny(text: string, phrases: string | string[]): boolean {
  const list = Array.isArray(phrases) ? phrases : phrases.split(',');
  const tt = tokens(text);
  return list.some((p) => p.trim() && phraseMatches(tt, p));
}

export const splitList = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

export type RrpRuleLike = { name: string; keywords: string; rrpPence: number; enabled: boolean };

export function matchRrpRule<T extends RrpRuleLike>(title: string, rules: T[]): T | undefined {
  const tt = tokens(title);
  return rules.find((r) => r.enabled && splitList(r.keywords).some((p) => phraseMatches(tt, p)));
}

