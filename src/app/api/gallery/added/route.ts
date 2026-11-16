import { pool } from '../../../../server/database'
import { answerGalleryAdded } from '../../../../server/galleryWrites'
import { forGallery, methodNotAllowed } from '../../../../server/response'

// POST /api/gallery/added?id=: one more add of a listed pack to someone's packs.

export async function POST(request: Request) {
  return answerGalleryAdded(request, pool)
}

const onlyPost = async () => forGallery(methodNotAllowed(['POST']))

export const GET = onlyPost
export const HEAD = onlyPost
export const PUT = onlyPost
export const PATCH = onlyPost
export const DELETE = onlyPost
// Next.js would answer OPTIONS itself with 204 and every method of this file; the Go backend answered 405.
export const OPTIONS = onlyPost
