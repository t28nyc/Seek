import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { isAuthorizedCron } from '@/lib/cron-auth';
import { runDueScans } from '@/lib/scraper/catalog';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cron/scan — scans shop catalogues that are due (each shop roughly
 * every 30 minutes; big catalogues continue across runs). Called every
 * 5 minutes by the GitHub workflow; does nothing when no shop is due.
 */
export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const shops = await runDueScans(45_000);
  if (shops.some((s) => s.added || s.changed)) revalidatePath('/');
  return NextResponse.json({ shops });
}
