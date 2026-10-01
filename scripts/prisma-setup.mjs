/**
 * Build step: generate the Prisma client and create/update the database tables.
 *
 * Neon's Vercel integration names its variables differently depending on how
 * it was connected, so rather than require one exact name this works out the
 * pooled and direct connection strings from whatever is present:
 *   pooled: DATABASE_URL → POSTGRES_PRISMA_URL → POSTGRES_URL
 *   direct: DATABASE_URL_UNPOOLED → POSTGRES_URL_NON_POOLING → pooled URL with
 *           "-pooler" removed from the host (Neon's naming convention)
 */
import { execSync } from 'node:child_process';
import { resolveDatabaseEnv } from './database-env.mjs';

const resolved = resolveDatabaseEnv(process.env);
if (!resolved) {
  console.error(
    '\n✖ No database connection string found.\n' +
      '  In Vercel: Storage → your Neon database → Connect Project, and tick\n' +
      '  Production and Preview. Then redeploy.\n',
  );
  process.exit(1);
}

const env = { ...process.env, ...resolved };
console.log(`Using database host ${new URL(resolved.DATABASE_URL_UNPOOLED).hostname} for schema push`);

execSync('prisma generate', { stdio: 'inherit', env });
execSync('prisma db push --skip-generate', { stdio: 'inherit', env });
