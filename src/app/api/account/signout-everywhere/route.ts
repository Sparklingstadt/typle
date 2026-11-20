import { answerSignOutEverywhere } from '../../../../server/accountApi'
import { pool } from '../../../../server/database'
import { methodNotAllowed } from '../../../../server/response'

// /api/account/signout-everywhere: POST revokes every login of the account until now and removes this browser's cookie.

export async function POST(request: Request) {
  return answerSignOutEverywhere(request, pool)
}

const onlyPost = async () => methodNotAllowed(['POST'])

export const GET = onlyPost
export const HEAD = onlyPost
export const PUT = onlyPost
export const PATCH = onlyPost
export const DELETE = onlyPost
// Next.js would answer OPTIONS itself with 204 and every method of this file.
export const OPTIONS = onlyPost
