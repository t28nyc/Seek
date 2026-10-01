import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { isAuthorizedCron } from '@/lib/cron-auth';
import { claimJob } from '@/lib/jobs';
import { refreshDrops } from '@/lib/drops/feeds';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const EVERY = 30 * 60_000;

/** GET /api/cron/drops — reads the drop/deal feeds at most every 30 minutes (?force=1 to run now). */
export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const force = new URL(req.url).searchParams.has('force');
  if (!force && !(await claimJob('drops', EVERY))) return NextResponse.json({ skipped: 'not due yet' });
  const feeds = await refreshDrops();
  revalidatePath('/');
  return NextResponse.json({ feeds });
}
