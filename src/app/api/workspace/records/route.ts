import { pool } from '../../../../server/database'
import { methodNotAllowed } from '../../../../server/response'
import { answerRecords } from '../../../../server/workspace'

// /api/workspace/records: POST adds a practice record to a list of the account's workspace, DELETE deletes one.

export async function POST(request: Request) {
  return answerRecords(request, pool)
}

export async function DELETE(request: Request) {
  return answerRecords(request, pool)
}

const notServed = async () => methodNotAllowed(['POST', 'DELETE'])

export const GET = notServed
export const HEAD = notServed
export const PUT = notServed
export const PATCH = notServed
// Next.js would answer OPTIONS itself with 204 and every method of this file; the Go backend answered 405.
export const OPTIONS = notServed
