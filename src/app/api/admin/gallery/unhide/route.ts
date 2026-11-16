import { answerAdmin } from '../../../../../server/admin'
import { pool } from '../../../../../server/database'
import { methodNotAllowed } from '../../../../../server/response'

// /api/admin/gallery/unhide: POST {"id"} shows the share in the gallery again, for the administrator, from the app's own pages.

export async function POST(request: Request) {
  return answerAdmin('unhide', request, pool)
}

const notServed = async () => methodNotAllowed(['POST'])

export const GET = notServed
export const HEAD = notServed
export const PUT = notServed
export const PATCH = notServed
export const DELETE = notServed
// Next.js would answer OPTIONS itself with 204 and every method of this file; the Go backend answered 405.
export const OPTIONS = notServed
