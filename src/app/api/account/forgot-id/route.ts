import { after } from 'next/server'
import { answerForgotId } from '../../../../server/accountRecovery'
import { pool } from '../../../../server/database'
import { methodNotAllowed } from '../../../../server/response'
import { readLoginSettings } from '../../../../server/settings'

// /api/account/forgot-id: POST mails the IDs whose confirmed address is the one given.

export async function POST(request: Request) {
  // The mail is sent after the answer, so the time to answer does not tell whether the account exists.
  return answerForgotId(request, pool, readLoginSettings, after)
}

const onlyPost = async () => methodNotAllowed(['POST'])

export const GET = onlyPost
export const HEAD = onlyPost
export const PUT = onlyPost
export const PATCH = onlyPost
export const DELETE = onlyPost
// Next.js would answer OPTIONS itself with 204 and every method of this file.
export const OPTIONS = onlyPost
