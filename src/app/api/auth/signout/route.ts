import { answerAuth } from '../../../../server/auth'
import { pool } from '../../../../server/database'

// /api/auth/signout: signs out of this browser, or of every device with ?everywhere=1 (POST). Every method comes here, so that the 405 (and its Allow) and the order of the
// checks are answerAuth's, as the Go backend answered them.

const answer = (request: Request) => answerAuth('signout', request, pool)

export const GET = answer
export const HEAD = answer
export const POST = answer
export const PUT = answer
export const PATCH = answer
export const DELETE = answer
export const OPTIONS = answer
