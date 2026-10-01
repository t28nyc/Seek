import { after, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { claimJob } from '@/lib/jobs';
import { runDueChecks } from '@/lib/scraper/run';
import { runDueScans } from '@/lib/scraper/catalog';
import { refreshDrops } from '@/lib/drops/feeds';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/refresh — the Refresh button.
 * Replies immediately and does the work in the background (`after`), so the
 * button never sits on "Checking…". The page reloads its data a few times
 * over the next minute to pick up results. At most one refresh per minute.
 */
export async function POST() {
  if (!(await claimJob('refresh', 60_000))) {
    return NextResponse.json({ started: false, message: 'Already refreshing — results appear within a minute.' });
  }

  // Everything you added is due now; every website is due for a rescan.
  const [{ count: links }, { count: sites }] = await Promise.all([
    prisma.trackedUrl.updateMany({
      where: { active: true, source: { in: ['USER', 'SEED'] } },
      data: { nextCheckAt: new Date() },
    }),
    prisma.shop.updateMany({ where: { enabled: true }, data: { nextScanAt: new Date() } }),
  ]);

  after(async () => {
    await Promise.allSettled([runDueChecks({ budgetMs: 45_000, limit: 80 }), runDueScans(45_000), refreshDrops()]);
    revalidatePath('/', 'layout');
  });

  return NextResponse.json({ started: true, links, sites });
}
