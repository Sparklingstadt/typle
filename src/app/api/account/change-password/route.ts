import { answerChangePassword } from '../../../../server/accountRecovery'
import { pool } from '../../../../server/database'
import { methodNotAllowed } from '../../../../server/response'

// /api/account/change-password: POST sets a new password for the signed-in account and revokes the earlier logins.

export async function POST(request: Request) {
  return answerChangePassword(request, pool)
}

const onlyPost = async () => methodNotAllowed(['POST'])

export const GET = onlyPost
export const HEAD = onlyPost
export const PUT = onlyPost
export const PATCH = onlyPost
export const DELETE = onlyPost
// Next.js would answer OPTIONS itself with 204 and every method of this file.
export const OPTIONS = onlyPost
