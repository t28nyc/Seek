import { prisma } from './db';

/**
 * Atomically claim a job that should run at most once per `everyMs`.
 * The scheduler fires every ~5 minutes; slower jobs (feeds, shop scans)
 * use this so overlapping or frequent calls don't repeat work.
 */
export async function claimJob(name: string, everyMs: number): Promise<boolean> {
  const now = new Date();
  await prisma.jobRun.createMany({ data: [{ name, lastRunAt: new Date(0) }], skipDuplicates: true });
  const { count } = await prisma.jobRun.updateMany({
    where: { name, lastRunAt: { lte: new Date(now.getTime() - everyMs) } },
    data: { lastRunAt: now },
  });
  return count === 1;
}
