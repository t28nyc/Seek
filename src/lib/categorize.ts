import type { Language, ProductType } from '@prisma/client';

export type Expansion = {
  key: string;
  label: string;
  /** Name of the Japanese source set, if it differs from the English one. */
  jpLabel?: string;
  patterns: RegExp[];
  /** Sought-after: shown first in filters and polled more often. */
  hot?: boolean;
};

/**
 * First match wins, so specific names go before generic ones
 * ("Mega Evolution—Perfect Order" must hit Perfect Order, not Mega Evolution).
 * This is configuration — add new sets here as they're announced.
 *
 * Note: Nihil Zero is a Japanese set; its cards are released in English as
 * Perfect Order (ME3). UK stores sell both, so both names map here and the
 * language detector separates them.
 */
export const EXPANSIONS: Expansion[] = [
  {
    key: 'perfect-order',
    label: 'Perfect Order',
    jpLabel: 'Nihil Zero',
    patterns: [/perfect order/i, /nihil zero/i, /munikisu/i, /\bme0?3\b/i],
    hot: true,
  },
  // Newer sets seen at UK shops in 2026 — add more as they're announced.
  { key: 'delta-reign', label: 'Delta Reign', patterns: [/delta reign/i] },
  { key: 'chaos-rising', label: 'Chaos Rising', patterns: [/chaos rising/i] },
  { key: '30th-celebration', label: '30th Celebration', patterns: [/30th (anniversary )?celebration/i] },
  { key: 'phantasmal-flames', label: 'Phantasmal Flames', patterns: [/phantasmal flames/i, /\bme0?2\b/i] },
  { key: 'paradox-rift', label: 'Paradox Rift', patterns: [/paradox rift/i, /\bsv0?4\b/i], hot: true },
  { key: 'prismatic-evolutions', label: 'Prismatic Evolutions', patterns: [/prismatic evolutions?/i], hot: true },
  { key: 'destined-rivals', label: 'Destined Rivals', patterns: [/destined rivals/i], hot: true },
  { key: 'journey-together', label: 'Journey Together', patterns: [/journey together/i] },
  { key: 'surging-sparks', label: 'Surging Sparks', patterns: [/surging sparks/i] },
  { key: 'black-bolt', label: 'Black Bolt', patterns: [/black bolt/i] },
  { key: 'white-flare', label: 'White Flare', patterns: [/white flare/i] },
  { key: 'mega-evolution', label: 'Mega Evolution', patterns: [/mega evolution/i, /\bme0?1\b/i] },
];

// Order matters here too: "Elite Trainer Box" contains "box", and
// "Booster Bundle" must not fall through to "Booster Box".
export const PRODUCT_TYPES: { type: ProductType; label: string; pattern: RegExp }[] = [
  { type: 'ETB', label: 'Elite Trainer Box', pattern: /elite trainer box|\betb\b/i },
  { type: 'BOOSTER_BUNDLE', label: 'Booster Bundle', pattern: /booster bundle/i },
  {
    type: 'BOOSTER_BOX',
    label: 'Booster Box',
    pattern: /booster (box|display)|display box|\b(18|20|24|30|36)[- ]?(booster )?packs?\b/i,
  },
  {
    type: 'PREMIUM_COLLECTION',
    label: 'Premium Collection',
    pattern: /premium collection|ultra[- ]premium|super[- ]premium|\bupc\b|\bspc\b/i,
  },
  { type: 'TIN', label: 'Tin', pattern: /\btins?\b/i },
  { type: 'BLISTER', label: 'Blister', pattern: /blister|checklane|\b3[- ]pack\b/i },
  { type: 'BOOSTER_PACK', label: 'Booster Pack', pattern: /booster pack|sleeved booster|\bbooster\b/i },
  { type: 'COLLECTION_BOX', label: 'Collection', pattern: /collection|\bbox\b/i },
];

const JP_PATTERN = /japanese|\bjpn?\b|\bjapan\b|\(jp\)/i;
const OTHER_LANG_PATTERN = /korean|chinese|simplified|traditional chinese|\bkr\b|\bthai\b/i;
const TCG_PATTERN = /pok[eé]mon|\btcg\b|trading card/i;

export type Categorized = {
  expansion?: string;
  expansionLabel?: string;
  type: ProductType;
  typeLabel: string;
  language: Language;
  hot: boolean;
  looksLikeTcg: boolean;
};

export function categorize(title: string): Categorized {
  const exp = EXPANSIONS.find((e) => e.patterns.some((p) => p.test(title)));
  const pt = PRODUCT_TYPES.find((t) => t.pattern.test(title));

  let language: Language = 'EN';
  if (OTHER_LANG_PATTERN.test(title)) language = 'OTHER';
  else if (JP_PATTERN.test(title)) language = 'JP';
  // A Japanese-only set name with no English name alongside it is the JP product.
  else if (exp?.jpLabel && new RegExp(exp.jpLabel, 'i').test(title) && !new RegExp(exp.label, 'i').test(title)) {
    language = 'JP';
  }

  return {
    expansion: exp?.key,
    expansionLabel: exp ? (language === 'JP' && exp.jpLabel ? exp.jpLabel : exp.label) : undefined,
    type: pt?.type ?? 'OTHER',
    typeLabel: pt?.label ?? 'Other',
    language,
    hot: !!exp?.hot,
    looksLikeTcg: TCG_PATTERN.test(title) || !!exp || (pt !== undefined && pt.type !== 'COLLECTION_BOX'),
  };
}

export function typeLabel(type: ProductType): string {
  return PRODUCT_TYPES.find((t) => t.type === type)?.label ?? 'Other';
}

export function expansionLabel(key: string | null | undefined, language: Language = 'EN'): string | undefined {
  const e = EXPANSIONS.find((x) => x.key === key);
  if (!e) return undefined;
  return language === 'JP' && e.jpLabel ? e.jpLabel : e.label;
}
