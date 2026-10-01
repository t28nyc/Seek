export function resolveDatabaseEnv(
  env: Record<string, string | undefined>,
): { DATABASE_URL: string; DATABASE_URL_UNPOOLED: string } | null;
export function directFromPooled(url: string): string;
