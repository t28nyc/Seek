import { PrismaClient } from '@prisma/client';
import { resolveDatabaseEnv } from '../../scripts/database-env.mjs';

// Fill in DATABASE_URL / DATABASE_URL_UNPOOLED from whichever names Vercel's
// Neon integration used, so the schema's env() lookups always resolve.
const resolved = resolveDatabaseEnv(process.env);
if (resolved) {
  process.env.DATABASE_URL ??= resolved.DATABASE_URL;
  process.env.DATABASE_URL_UNPOOLED ??= resolved.DATABASE_URL_UNPOOLED;
}

// Reuse one client across hot reloads in dev and warm serverless invocations.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
