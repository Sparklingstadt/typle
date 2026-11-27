import { prisma } from '../../../../server/database'
import { answerDemoReset, resetDemoWorkspace } from '../../../../server/demoReset'
import { methodNotAllowed } from '../../../../server/response'

// /api/demo/reset: GET, called by Vercel Cron every day (vercel.json), puts the shared demo account back to its sample.

export async function GET(request: Request) {
  return answerDemoReset(request, () => resetDemoWorkspace(prisma()))
}

const onlyGet = async () => methodNotAllowed(['GET'])

export const HEAD = onlyGet
export const POST = onlyGet
export const PUT = onlyGet
export const PATCH = onlyGet
export const DELETE = onlyGet
// Next.js would answer OPTIONS itself with 204 and every method of this file.
export const OPTIONS = onlyGet
