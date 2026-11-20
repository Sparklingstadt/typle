import { after } from 'next/server'
import { answerForgotPassword } from '../../../../server/accountRecovery'
import { pool } from '../../../../server/database'
import { methodNotAllowed } from '../../../../server/response'
import { readLoginSettings } from '../../../../server/settings'

// /api/account/forgot-password: POST mails the link that sets a new password, when the ID has a confirmed address.

export async function POST(request: Request) {
  // The mail is sent after the answer, so the time to answer does not tell whether the account exists.
  return answerForgotPassword(request, pool, readLoginSettings, after)
}

const onlyPost = async () => methodNotAllowed(['POST'])

export const GET = onlyPost
export const HEAD = onlyPost
export const PUT = onlyPost
export const PATCH = onlyPost
export const DELETE = onlyPost
// Next.js would answer OPTIONS itself with 204 and every method of this file.
export const OPTIONS = onlyPost
