import { loadEnvConfig } from '@next/env'
import { defineConfig } from 'prisma/config'

// The Prisma CLI (generate, db pull, migrate diff) reads this. The migrations are not Prisma's: db/migrations is
// applied by scripts/migrate.cjs, and verify checks that prisma/schema.prisma matches the database they make.
loadEnvConfig(process.cwd())
const url = process.env.DIRECT_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL
export default defineConfig({
  schema: 'prisma/schema.prisma',
  ...(url ? { datasource: { url } } : {}),
})
