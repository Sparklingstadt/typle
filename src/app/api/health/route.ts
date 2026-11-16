import { pool } from '../../../server/database'
import { checkHealth } from '../../../server/health'
import { methodNotAllowed, withoutBody } from '../../../server/response'

// GET /api/health: whether the database answers. HEAD answers the same without the body.

export async function GET() {
  return checkHealth(pool)
}

export async function HEAD() {
  return withoutBody(await checkHealth(pool))
}

const onlyGet = async () => methodNotAllowed(['GET', 'HEAD'])

export const POST = onlyGet
export const PUT = onlyGet
export const PATCH = onlyGet
export const DELETE = onlyGet
// Next.js would answer OPTIONS itself with 204 and every method of this file; the Go backend answered 405.
export const OPTIONS = onlyGet
