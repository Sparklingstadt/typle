import { answerResetPassword } from '../../../../server/accountRecovery'
import { pool } from '../../../../server/database'
import { methodNotAllowed } from '../../../../server/response'

// /api/account/reset-password: POST sets a new password with the token of the mailed link and revokes the earlier logins.

export async function POST(request: Request) {
  return answerResetPassword(request, pool)
}

const onlyPost = async () => methodNotAllowed(['POST'])

export const GET = onlyPost
export const HEAD = onlyPost
export const PUT = onlyPost
export const PATCH = onlyPost
export const DELETE = onlyPost
// Next.js would answer OPTIONS itself with 204 and every method of this file.
export const OPTIONS = onlyPost
