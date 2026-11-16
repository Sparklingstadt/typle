import { pool } from '../../../server/database'
import { methodNotAllowed, withoutBody } from '../../../server/response'
import { answerShares } from '../../../server/shares'

// /api/shares: the owner's links to packs. GET lists them (HEAD answers the same without the body), PUT shares a pack or
// copies it again, DELETE ?pack= stops sharing it.

export async function GET(request: Request) {
  return answerShares(request, pool)
}

export async function HEAD(request: Request) {
  return withoutBody(await answerShares(new Request(request, { method: 'GET' }), pool))
}

export async function PUT(request: Request) {
  return answerShares(request, pool)
}

export async function DELETE(request: Request) {
  return answerShares(request, pool)
}

const notServed = async () => methodNotAllowed(['GET', 'HEAD', 'PUT', 'DELETE'])

export const POST = notServed
export const PATCH = notServed
// Next.js would answer OPTIONS itself with 204 and every method of this file; the Go backend answered 405.
export const OPTIONS = notServed
