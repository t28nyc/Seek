/**
 * robots.txt support: Peek doesn't fetch pages a site asks bots not to.
 * Rules are fetched once per site per server instance and cached for 6 hours.
 */

type Rules = { allow: string[]; disallow: string[]; at: number };
const cache = new Map<string, Rules>();
const TTL = 6 * 3_600_000;

function parse(txt: string, agent = 'peek'): Pick<Rules, 'allow' | 'disallow'> {
  // Collect rules from groups for our agent, falling back to "*".
  const groups: { agents: string[]; allow: string[]; disallow: string[] }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], allow: [], disallow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === 'disallow' && value) current.disallow.push(value);
    if (key === 'allow' && value) current.allow.push(value);
  }
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && agent.includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  return { allow: chosen.flatMap((g) => g.allow), disallow: chosen.flatMap((g) => g.disallow) };
}

function toRegex(rule: string) {
  const anchored = rule.endsWith('$');
  const body = (anchored ? rule.slice(0, -1) : rule).replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

/** Longest matching rule wins; Allow wins a tie (Google's interpretation). */
export function isAllowed(rules: Pick<Rules, 'allow' | 'disallow'>, pathAndQuery: string): boolean {
  let best = -1;
  let allowed = true;
  for (const r of rules.disallow) if (toRegex(r).test(pathAndQuery) && r.length > best) [best, allowed] = [r.length, false];
  for (const r of rules.allow) if (toRegex(r).test(pathAndQuery) && r.length >= best) [best, allowed] = [r.length, true];
  return allowed;
}

export { parse as parseRobots };

/** May Peek fetch this URL? Unreachable or missing robots.txt means yes. */
export async function robotsAllows(url: string, userAgent: string): Promise<boolean> {
  const u = new URL(url);
  if (u.pathname === '/robots.txt') return true;
  let rules = cache.get(u.origin);
  if (!rules || Date.now() - rules.at > TTL) {
    let txt = '';
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5_000);
      const res = await fetch(`${u.origin}/robots.txt`, { headers: { 'User-Agent': userAgent }, signal: ctrl.signal, cache: 'no-store' });
      clearTimeout(t);
      if (res.ok) txt = (await res.text()).slice(0, 200_000);
    } catch {
      /* no robots.txt reachable */
    }
    rules = { ...parse(txt, userAgent.toLowerCase().split('/')[0]), at: Date.now() };
    cache.set(u.origin, rules);
  }
  return isAllowed(rules, u.pathname + u.search);
}
