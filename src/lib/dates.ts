/** Date extraction from free text ("27th March", "March 27, 2026", "27/03/2026"). */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_RE =
  '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
// Groups: 1 day, 2 month, 3 year | 4 month, 5 day, 6 year
const DATE_RE = `(?:(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}(?:,?\\s+(\\d{4}))?|${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?)`;
const NUMERIC_RE = /\b(\d{1,2})[/.](\d{1,2})[/.](20\d{2})\b/; // UK order: dd/mm/yyyy

function build(day: number, month: number, yearStr: string | undefined, now: Date): Date | undefined {
  if (month < 0 || month > 11 || !day || day > 31) return undefined;
  let year = yearStr ? Number(yearStr) : now.getUTCFullYear();
  let d = new Date(Date.UTC(year, month, day, 12));
  // No year given: take the next time that date comes round (allowing two weeks back).
  if (!yearStr && d.getTime() < now.getTime() - 14 * 86_400_000) d = new Date(Date.UTC(++year, month, day, 12));
  return d;
}

function fromMatch(m: RegExpMatchArray, offset: number, now: Date) {
  const day = Number(m[offset + 1] ?? m[offset + 5]);
  const month = MONTHS.indexOf((m[offset + 2] ?? m[offset + 4] ?? '').slice(0, 3).toLowerCase());
  return build(day, month, m[offset + 3] ?? m[offset + 6], now);
}

/**
 * A release date mentioned near a release word ("releases 14th November"),
 * so "posted 3 May" isn't read as a release.
 */
export function extractReleaseDate(text: string, now = new Date()): Date | undefined {
  const m = text.match(
    new RegExp(`(?:releas\\w*|launch\\w*|out on|available|pre-?order\\w*|drops?|arriv\\w*|in stores?)[^.]{0,40}?${DATE_RE}`, 'i'),
  );
  return m ? fromMatch(m, 0, now) : undefined;
}

/** Any date mentioned in the text — for event listings, whose dates aren't near a release word. */
export function findAnyDate(text: string, now = new Date()): Date | undefined {
  const m = text.match(new RegExp(DATE_RE, 'i'));
  if (m) return fromMatch(m, 0, now);
  const n = text.match(NUMERIC_RE);
  return n ? build(Number(n[1]), Number(n[2]) - 1, n[3], now) : undefined;
}

// dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy or dd/mm/yy (UK order)
const NUMERIC_ANY = '(\\d{1,2})[/.-](\\d{1,2})[/.-]((?:20)?\\d{2})';

/** Words that put a date next to a release/availability ("Expected 06/11/2026", "Release date: 6th November"). */
const RELEASE_WORDS =
  '(?:expected|release(?:s|d)?(?: date)?|releasing|available (?:from|on)|availability|launch(?:es|ing)?|out on|due(?: out| in)?|dispatch(?:ed|es)?(?: from| on)?|ships?(?: from| on)?|street date|pre-?order(?:s)? (?:close|end)s?|drop(?:s|ping)? on|on sale(?: from)?|(?:draw|ballot|raffle|entries|entry) (?:closes?|ends?)|closing date)';

/**
 * A date written next to a release/availability word, in words or numbers.
 * Used on product pages, where dates are usually numeric ("Expected 06/11/2026").
 */
export function findDateNear(text: string, now = new Date()): Date | undefined {
  const re = new RegExp(`${RELEASE_WORDS}[^.\\n]{0,30}?(?:${NUMERIC_ANY}|${DATE_RE})`, 'i');
  const m = text.match(re);
  if (!m) return undefined;
  if (m[1]) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return build(Number(m[1]), Number(m[2]) - 1, year, now);
  }
  // Textual date: groups shift by the three numeric groups
  return fromMatch(m, 3, now);
}
