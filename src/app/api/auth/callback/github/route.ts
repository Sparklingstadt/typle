import { pool } from '../../../../../server/database'
import { answerLogin } from '../../../../../server/signin'

// GET /api/auth/callback/github: where GitHub sends the browser back to. Every method comes here, so that the 405 (and its Allow) and the order of the checks are
// answerLogin's, as the Go backend answered them.

const answer = (request: Request) => answerLogin('github', request, pool)

export const GET = answer
export const HEAD = answer
export const POST = answer
export const PUT = answer
export const PATCH = answer
export const DELETE = answer
export const OPTIONS = answer
