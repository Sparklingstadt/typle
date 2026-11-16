import { pool } from '../../../server/database'
import { answerGallery } from '../../../server/gallery'
import { forGallery, methodNotAllowed, withoutBody } from '../../../server/response'

// GET /api/gallery?q=&category=&sort=&page=: one page of the packs listed in the gallery. HEAD answers the same
// without the body.

export async function GET(request: Request) {
  return answerGallery(request, pool)
}

export async function HEAD(request: Request) {
  return withoutBody(await answerGallery(request, pool))
}

const onlyGet = async () => forGallery(methodNotAllowed(['GET', 'HEAD']))

export const POST = onlyGet
export const PUT = onlyGet
export const PATCH = onlyGet
export const DELETE = onlyGet
// Next.js would answer OPTIONS itself with 204 and every method of this file; the Go backend answered 405.
export const OPTIONS = onlyGet
