import { prisma } from './db';
import { categorize, typeLabel } from './categorize';

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
}

/**
 * Map a shop's product title to a canonical Product, so the same item at
 * several shops shares one product — and one RRP.
 *
 * Known expansion + known type → grouped ("en-perfect-order-etb").
 * Anything else stays its own product, keyed by its title.
 * Pokémon Center exclusive ETBs get their own key.
 */
const LANG_SUFFIX: Record<string, string> = { JP: ' (Japanese)', ZH: ' (Chinese)', OTHER: ' (other language)' };

export function productSpec(title: string) {
  const c = categorize(title);
  const pcExclusive = /pok[eé]mon cent(er|re)/i.test(title) && c.type === 'ETB';
  const grouped = !!c.expansion && c.type !== 'OTHER';

  const slug = grouped
    ? [c.language, c.expansion, c.type, pcExclusive ? 'pc' : ''].filter(Boolean).join('-').toLowerCase()
    : `${c.language.toLowerCase()}-${slugify(title)}`;

  const name = grouped
    ? `${c.expansionLabel} ${pcExclusive ? 'Pokémon Center ' : ''}${typeLabel(c.type)}${LANG_SUFFIX[c.language] ?? ''}`
    : title;

  return { slug, name, expansion: c.expansion, type: c.type, language: c.language, hot: c.hot };
}

export async function findOrCreateProduct(title: string) {
  const spec = productSpec(title);
  return prisma.product.upsert({ where: { slug: spec.slug }, update: {}, create: spec });
}

/** Batch version for catalogue scans: one createMany + one findMany for any number of titles. */
export async function linkProducts(titles: string[]): Promise<Map<string, { id: string; hot: boolean } | undefined>> {
  const specs = new Map(titles.map((t) => [t, productSpec(t)]));
  const unique = new Map([...specs.values()].map((s) => [s.slug, s]));
  if (unique.size) {
    await prisma.product.createMany({ data: [...unique.values()], skipDuplicates: true });
  }
  const rows = await prisma.product.findMany({
    where: { slug: { in: [...unique.keys()] } },
    select: { id: true, slug: true, hot: true },
  });
  const bySlug = new Map<string, { id: string; hot: boolean }>(rows.map((r) => [r.slug, { id: r.id, hot: r.hot }]));
  return new Map(titles.map((t) => [t, bySlug.get(specs.get(t)!.slug)] as const));
}
