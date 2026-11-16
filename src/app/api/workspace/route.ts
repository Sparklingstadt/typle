import { pool } from '../../../server/database'
import { methodNotAllowed, withoutBody } from '../../../server/response'
import { answerWorkspace } from '../../../server/workspace'

// /api/workspace: GET reads the account's workspace (HEAD answers the same without the body), PUT saves a change of it
// by revision.

export async function GET(request: Request) {
  return answerWorkspace(request, pool)
}

export async function HEAD(request: Request) {
  return withoutBody(await answerWorkspace(new Request(request, { method: 'GET' }), pool))
}

export async function PUT(request: Request) {
  return answerWorkspace(request, pool)
}

const notServed = async () => methodNotAllowed(['GET', 'HEAD', 'PUT'])

export const POST = notServed
export const PATCH = notServed
export const DELETE = notServed
// Next.js would answer OPTIONS itself with 204 and every method of this file; the Go backend answered 405.
export const OPTIONS = notServed
