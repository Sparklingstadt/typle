import nextEnv from '@next/env'
import { defineConfig } from 'prisma/config'

// The Prisma CLI (generate, migrate deploy, migrate diff, db pull) reads this. npm run db:migrate applies db/migrations
// with `prisma migrate deploy` after scripts/check-migrations.cjs, and verify checks that prisma/schema.prisma matches
// the database they make. `prisma migrate dev` is not used: production records migrations (0001 to 0026) that
// 0027_schema replaced, which it takes for a mismatch (docs/development.md).

/**
 * The connection string in the form the Prisma CLI reads. The app connects with pg, which reads libpq's
 * sslmode=verify-full and sslrootcert (DATABASE_URL on AWS); the CLI ignores both and would connect without checking
 * the server's certificate, so they become its own sslcert (the CA) and sslaccept=strict.
 */
export function prismaUrl(url: string): string {
  const parsed = new URL(url)
  const ca = parsed.searchParams.get('sslrootcert')
  if (parsed.searchParams.get('sslmode') !== 'verify-full' || !ca) return url
  parsed.searchParams.set('sslmode', 'require')
  parsed.searchParams.delete('sslrootcert')
  parsed.searchParams.set('sslcert', ca)
  parsed.searchParams.set('sslaccept', 'strict')
  return parsed.toString()
}

nextEnv.loadEnvConfig(process.cwd())
// A direct connection first: Prisma Migrate takes an advisory lock, which a pooled connection may not keep.
const url = process.env.DIRECT_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'db/migrations' },
  ...(url ? { datasource: { url: prismaUrl(url) } } : {}),
})
