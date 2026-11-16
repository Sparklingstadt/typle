import { pool } from '../../../../server/database'
import { answerGalleryReport } from '../../../../server/galleryWrites'
import { forGallery, methodNotAllowed } from '../../../../server/response'

// POST /api/gallery/reports: a report of a pack in the gallery.

export async function POST(request: Request) {
  return answerGalleryReport(request, pool)
}

const onlyPost = async () => forGallery(methodNotAllowed(['POST']))

export const GET = onlyPost
export const HEAD = onlyPost
export const PUT = onlyPost
export const PATCH = onlyPost
export const DELETE = onlyPost
// Next.js would answer OPTIONS itself with 204 and every method of this file; the Go backend answered 405.
export const OPTIONS = onlyPost
