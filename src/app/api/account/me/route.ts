import { answerMe } from '../../../../server/accountRecovery'
import { pool } from '../../../../server/database'
import { methodNotAllowed, withoutBody } from '../../../../server/response'

// /api/account/me: GET the signed-in account with an ID and a password (its ID, address and whether it is confirmed).

export async function GET(request: Request) {
  return answerMe(request, pool)
}

export async function HEAD(request: Request) {
  return withoutBody(await answerMe(new Request(request, { method: 'GET' }), pool))
}

const onlyGet = async () => methodNotAllowed(['GET', 'HEAD'])

export const POST = onlyGet
export const PUT = onlyGet
export const PATCH = onlyGet
export const DELETE = onlyGet
// Next.js would answer OPTIONS itself with 204 and every method of this file.
export const OPTIONS = onlyGet
