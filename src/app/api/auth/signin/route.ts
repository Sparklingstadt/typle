import { answerLogin } from '../../../../server/signin'

// GET /api/auth/signin: starts a login. Every method comes here, so that the 405 (and its Allow) and the order of the checks are
// answerLogin's, as the Go backend answered them.

const answer = (request: Request) => answerLogin('signin', request)

export const GET = answer
export const HEAD = answer
export const POST = answer
export const PUT = answer
export const PATCH = answer
export const DELETE = answer
export const OPTIONS = answer
