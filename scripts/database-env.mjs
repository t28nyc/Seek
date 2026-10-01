/** Shared by the build script and the app (src/lib/db.ts). */
export function resolveDatabaseEnv(env) {
  const pooled = env.DATABASE_URL || env.POSTGRES_PRISMA_URL || env.POSTGRES_URL;
  if (!pooled) return null;
  const direct = env.DATABASE_URL_UNPOOLED || env.POSTGRES_URL_NON_POOLING || directFromPooled(pooled);
  return { DATABASE_URL: pooled, DATABASE_URL_UNPOOLED: direct };
}

export function directFromPooled(url) {
  try {
    const u = new URL(url);
    u.hostname = u.hostname.replace('-pooler.', '.');
    return u.toString();
  } catch {
    return url;
  }
}
