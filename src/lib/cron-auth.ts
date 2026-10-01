/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when that env var is set. */
export function isAuthorizedCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}
