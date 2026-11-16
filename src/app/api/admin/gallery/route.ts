import { answerAdmin } from '../../../../server/admin'
import { pool } from '../../../../server/database'
import { methodNotAllowed, withoutBody } from '../../../../server/response'

// /api/admin/gallery: GET answers it to the administrator (HEAD the same without the body).

export async function GET(request: Request) {
  return answerAdmin('gallery', request, pool)
}

export async function HEAD(request: Request) {
  return withoutBody(await answerAdmin('gallery', new Request(request, { method: 'GET' }), pool))
}

const notServed = async () => methodNotAllowed(['GET', 'HEAD'])

export const POST = notServed
export const PUT = notServed
export const PATCH = notServed
export const DELETE = notServed
// Next.js would answer OPTIONS itself with 204 and every method of this file; the Go backend answered 405.
export const OPTIONS = notServed
