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
 * Map a retailer's product title to a canonical Product so the same item
 * at five stores shows up as one product with five listings.
 *
 * Known expansion + known type → grouped ("en-perfect-order-etb").
 * Anything else stays its own product, keyed by its title.
 * Variants such as Pokémon Center exclusive ETBs get their own key.
 */
export async function findOrCreateProduct(title: string) {
  const c = categorize(title);
  const pcExclusive = /pok[eé]mon cent(er|re)/i.test(title) && c.type === 'ETB';
  const grouped = c.expansion && c.type !== 'OTHER';

  const slug = grouped
    ? [c.language, c.expansion, c.type, pcExclusive ? 'pc' : ''].filter(Boolean).join('-').toLowerCase()
    : `${c.language.toLowerCase()}-${slugify(title)}`;

  const name = grouped
    ? `${c.expansionLabel} ${pcExclusive ? 'Pokémon Center ' : ''}${typeLabel(c.type)}${c.language === 'JP' ? ' (Japanese)' : ''}`
    : title;

  return prisma.product.upsert({
    where: { slug },
    update: {},
    create: {
      slug,
      name,
      expansion: c.expansion,
      type: c.type,
      language: c.language,
      hot: c.hot,
    },
  });
}
