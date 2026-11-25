import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { Prisma, PrismaClient } from '../generated/prisma/client'

// The database of the Route Handlers: Prisma Client (prisma/schema.prisma) over a pg pool. Each server instance keeps one
// small pool: on Vercel many instances can run at once (DATABASE_URL is Neon's pooled connection), and on AWS each ECS
// task is one instance. On Amazon RDS, DATABASE_URL
// carries sslmode=verify-full and sslrootcert (the CA bundle in the image, see Dockerfile), so the server is verified.

/**
 * A pool of connections to the database at url. Connecting and each query give up after timeoutMs, so a database that
 * stops answering cannot keep the pool's connections lent out: pg drops a connection whose query timed out.
 */
export function createPool(url: string, timeoutMs = 5_000): Pool {
  const db = new Pool({
    connectionString: url,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: timeoutMs,
    query_timeout: timeoutMs,
    // An instance can sleep (Vercel) or lose a connection silently (a restart, a network path timing out); keep-alive
    // finds the dead ones.
    keepAlive: true,
  })
  // The database closing an idle connection (a restart, an idle timeout) is emitted here. Unheard, the event would
  // throw; the pool has already dropped that connection, so it is only logged.
  db.on('error', error => console.error('database pool:', error))
  return db
}

/**
 * Prisma Client over pool: the app's queries go through it, with the pool's timeouts. $disconnect() ends the pool.
 * Tests pass a pool of their own to look into it.
 */
export function prismaOn(pool: Pool): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg(pool, { disposeExternalPool: true }) })
}

/** Prisma Client for the database at url, over a pool of createPool. */
export function createPrisma(url: string, timeoutMs = 5_000): PrismaClient {
  return prismaOn(createPool(url, timeoutMs))
}

/** The database the server code is given: Prisma Client. */
export type Db = PrismaClient
/** The client of a transaction (db.$transaction(tx => ...)), or Prisma Client itself: anything that runs queries. */
export type Tx = Prisma.TransactionClient

/** How long an interactive transaction may take before Prisma gives it up (its default is 5 seconds). */
export const TRANSACTION_TIMEOUT_MS = 15_000

let shared: PrismaClient | undefined

/** The Prisma Client of this server instance, opened on first use from DATABASE_URL (or POSTGRES_URL). */
export function prisma(): PrismaClient {
  if (!shared) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL
    if (!url) throw new Error('DATABASE_URL is not set')
    shared = createPrisma(url)
  }
  return shared
}

/**
 * Resolves once the database answers `SELECT 1`, and rejects when it fails or takes longer than timeoutMs. The pool's
 * own timeouts drop a connection that never answers, so a dead database cannot keep the pool's connections lent out.
 */
export async function ping(db: Db, timeoutMs = 5_000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`the database did not answer within ${timeoutMs} ms`)), timeoutMs)
  })
  // Prisma has no call that only checks the connection, so this one query is SQL.
  const query = db.$queryRaw`SELECT 1`
  query.catch(() => {}) // Its failure after the deadline has no one left to tell.
  try {
    await Promise.race([query, deadline])
  } finally {
    clearTimeout(timer)
  }
}
