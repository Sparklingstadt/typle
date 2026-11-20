import { answerForgotId } from '../../../../server/accountRecovery'
import { pool } from '../../../../server/database'
import { methodNotAllowed } from '../../../../server/response'

// /api/account/forgot-id: POST mails the IDs whose confirmed address is the one given.

export async function POST(request: Request) {
  return answerForgotId(request, pool)
}

const onlyPost = async () => methodNotAllowed(['POST'])

export const GET = onlyPost
export const HEAD = onlyPost
export const PUT = onlyPost
export const PATCH = onlyPost
export const DELETE = onlyPost
// Next.js would answer OPTIONS itself with 204 and every method of this file.
export const OPTIONS = onlyPost
