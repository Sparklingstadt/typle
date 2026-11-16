import { answerAdmin } from '../../../../../server/admin'
import { pool } from '../../../../../server/database'
import { methodNotAllowed } from '../../../../../server/response'

// /api/admin/gallery/hide: POST {"id"} hides the share from the gallery, for the administrator, from the app's own pages.

export async function POST(request: Request) {
  return answerAdmin('hide', request, pool)
}

const notServed = async () => methodNotAllowed(['POST'])

export const GET = notServed
export const HEAD = notServed
export const PUT = notServed
export const PATCH = notServed
export const DELETE = notServed
// Next.js would answer OPTIONS itself with 204 and every method of this file; the Go backend answered 405.
export const OPTIONS = notServed
