import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { isAuthorizedCron } from '@/lib/cron-auth';
import { runDueChecks } from '@/lib/scraper/run';

export const dynamic = 'force-dynamic';
// Work budget below is 40s, leaving headroom for DB writes and cold starts.
export const maxDuration = 60;

/**
 * GET /api/cron/scrape — checks every tracked URL that is due.
 * Called by Vercel Cron (daily safety net) and by an external scheduler
 * (GitHub Actions / cron-job.org) for the frequent runs. Safe to call
 * concurrently or twice in a row: rows are leased before fetching.
 */
export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const summary = await runDueChecks({ budgetMs: 40_000, limit: 40 });
  if (summary.changed > 0) revalidatePath('/');

  // Keep the response small; per-item results are useful when debugging.
  const verbose = new URL(req.url).searchParams.has('verbose');
  return NextResponse.json(verbose ? summary : { ...summary, results: undefined });
}
