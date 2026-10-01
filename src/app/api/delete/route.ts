import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { listWhere, readFilters } from '@/lib/online-filters';

export const dynamic = 'force-dynamic';

type Body =
  | { target: 'listing'; id: string }
  | { target: 'listings'; filters: Record<string, string> } // "Delete all" on the Online page
  | { target: 'drop'; id: string }
  | { target: 'drops'; kind: 'online' | 'in-store' } // "Delete all" on Drops / In store
  | { target: 'shop'; id: string }; // stop scanning a website and remove what it found

/**
 * Deleting hides rather than erases: scans and feeds would otherwise add the
 * same items straight back. Pasting a hidden product link again brings it back.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body || typeof body !== 'object' || !('target' in body)) {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  }

  let count = 0;
  switch (body.target) {
    case 'listing': {
      count = (await prisma.trackedUrl.updateMany({ where: { id: body.id }, data: { active: false } })).count;
      break;
    }
    case 'listings': {
      const f = readFilters(body.filters ?? {});
      count = (await prisma.trackedUrl.updateMany({ where: listWhere(f), data: { active: false } })).count;
      // Deleting everything from one website (no other filters) also stops scanning it.
      if (f.site && f.status === 'all' && !f.q && !f.mine) {
        await prisma.shop.updateMany({ where: { host: f.site }, data: { enabled: false } });
      }
      break;
    }
    case 'drop': {
      count = (await prisma.dropItem.updateMany({ where: { id: body.id }, data: { hidden: true } })).count;
      break;
    }
    case 'drops': {
      if (body.kind !== 'online' && body.kind !== 'in-store') return NextResponse.json({ error: 'Bad kind.' }, { status: 400 });
      count = (await prisma.dropItem.updateMany({ where: { kind: body.kind, hidden: false }, data: { hidden: true } })).count;
      if (body.kind === 'in-store') await prisma.drop.deleteMany({});
      break;
    }
    case 'shop': {
      const shop = await prisma.shop.update({ where: { id: body.id }, data: { enabled: false } }).catch(() => null);
      if (!shop) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
      count = (
        await prisma.trackedUrl.updateMany({
          where: { source: 'CATALOG', url: { startsWith: `https://${shop.host}/` } },
          data: { active: false },
        })
      ).count;
      break;
    }
    default:
      return NextResponse.json({ error: 'Unknown target.' }, { status: 400 });
  }

  revalidatePath('/', 'layout');
  return NextResponse.json({ ok: true, count });
}
