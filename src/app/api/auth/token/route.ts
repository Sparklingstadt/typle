import { answerAuth } from '../../../../server/auth'
import { pool } from '../../../../server/database'

// /api/auth/token: an app's login code and verifier for its token (POST). Every method comes here, so that the 405 (and its Allow) and the order of the
// checks are answerAuth's, as the Go backend answered them.

const answer = (request: Request) => answerAuth('token', request, pool)

export const GET = answer
export const HEAD = answer
export const POST = answer
export const PUT = answer
export const PATCH = answer
export const DELETE = answer
export const OPTIONS = answer
