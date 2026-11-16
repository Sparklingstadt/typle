import { pool } from '../../../server/database'
import { methodNotAllowed, notForSearch, withoutBody } from '../../../server/response'
import { answerShared } from '../../../server/shared'

// GET /api/shared?id=: the pack a link shares. HEAD answers the same without the body.

export async function GET(request: Request) {
  return answerShared(request, pool)
}

export async function HEAD(request: Request) {
  return withoutBody(await answerShared(request, pool))
}

const onlyGet = async () => notForSearch(methodNotAllowed(['GET', 'HEAD']))

export const POST = onlyGet
export const PUT = onlyGet
export const PATCH = onlyGet
export const DELETE = onlyGet
// Next.js would answer OPTIONS itself with 204 and every method of this file; the Go backend answered 405.
export const OPTIONS = onlyGet
