import { pool } from '../../../../server/database'
import { answerGalleryCategories } from '../../../../server/gallery'
import { forGallery, methodNotAllowed, withoutBody } from '../../../../server/response'

// GET /api/gallery/categories: the categories of the listed packs, the most packs first. HEAD answers the same without
// the body.

export async function GET(request: Request) {
  return answerGalleryCategories(request, pool)
}

export async function HEAD(request: Request) {
  return withoutBody(await answerGalleryCategories(request, pool))
}

const onlyGet = async () => forGallery(methodNotAllowed(['GET', 'HEAD']))

export const POST = onlyGet
export const PUT = onlyGet
export const PATCH = onlyGet
export const DELETE = onlyGet
// Next.js would answer OPTIONS itself with 204 and every method of this file; the Go backend answered 405.
export const OPTIONS = onlyGet
