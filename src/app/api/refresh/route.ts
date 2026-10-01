import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { claimJob } from '@/lib/jobs';
import { runDueChecks } from '@/lib/scraper/run';
import { runDueScans } from '@/lib/scraper/catalog';
import { refreshDrops } from '@/lib/drops/feeds';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PARTS = ['products', 'shops', 'feeds'] as const;
type Part = (typeof PARTS)[number];

/**
 * POST /api/refresh?part=products|shops|feeds — the Refresh button.
 * The button calls all three parts at once so each gets its own 60-second
 * function. Each part can run at most every 30 seconds, so repeated taps
 * (or anyone else hitting this URL) can't hammer the shops.
 */
export async function POST(req: Request) {
  const part = new URL(req.url).searchParams.get('part') as Part | null;
  if (!part || !PARTS.includes(part)) return NextResponse.json({ error: 'Unknown part.' }, { status: 400 });
  if (!(await claimJob(`refresh-${part}`, 30_000))) {
    return NextResponse.json({ part, skipped: 'Refreshed moments ago' });
  }

  let summary: Record<string, unknown>;
  if (part === 'products') {
    // Make every link you added due now; scanned catalogues are refreshed by the "shops" part.
    await prisma.trackedUrl.updateMany({
      where: { active: true, source: { in: ['USER', 'SEED'] } },
      data: { nextCheckAt: new Date() },
    });
    const r = await runDueChecks({ budgetMs: 45_000, limit: 80 });
    summary = { checked: r.checked, changed: r.changed, remaining: Math.max(0, r.due - r.checked) };
  } else if (part === 'shops') {
    await prisma.shop.updateMany({ where: { enabled: true }, data: { nextScanAt: new Date() } });
    const shops = await runDueScans(45_000);
    summary = {
      shops: shops.length,
      found: shops.reduce((n, s) => n + s.found, 0),
      changed: shops.reduce((n, s) => n + s.added + s.changed, 0),
    };
  } else {
    const feeds = await refreshDrops();
    summary = { added: feeds.reduce((n, f) => n + ('added' in f ? (f.added ?? 0) : 0), 0) };
  }

  revalidatePath('/', 'layout');
  return NextResponse.json({ part, ...summary });
}
