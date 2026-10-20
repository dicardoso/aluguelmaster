import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { appEnv, isProduction } from './env.js';

// Neon's HTTP/WebSocket driver connects over port 443 instead of the raw Postgres
// wire protocol (5432), which some networks block for outbound traffic. Using it
// unconditionally (not just as a dev workaround) also matches how Neon recommends
// connecting from serverless/edge-style runtimes in production.
// Safety net against pointing a non-production environment at the production database:
// PRODUCTION_DATABASE_HOST (an endpoint id like "ep-xxxx-yyyy", no credentials) is set in
// local/develop env files, and the process refuses to start if DATABASE_URL matches it.
const protectedHost = process.env.PRODUCTION_DATABASE_HOST;
if (!isProduction && protectedHost && process.env.DATABASE_URL?.includes(protectedHost)) {
  throw new Error(
    `Refusing to start: APP_ENV=${appEnv} but DATABASE_URL points at the production database (${protectedHost}).`
  );
}

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });

// Avoid creating a new PrismaClient (and a new connection pool) on every Vite HMR
// reload in dev by caching the instance on the global object.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
