import { answerAuth } from '../../../../server/auth'
import { pool } from '../../../../server/database'

// /api/auth/local: the made-up login for development on this machine (POST). Every method comes here, so that the 405 (and its Allow) and the order of the
// checks are answerAuth's, as the Go backend answered them.

const answer = (request: Request) => answerAuth('local', request, pool)

export const GET = answer
export const HEAD = answer
export const POST = answer
export const PUT = answer
export const PATCH = answer
export const DELETE = answer
export const OPTIONS = answer
