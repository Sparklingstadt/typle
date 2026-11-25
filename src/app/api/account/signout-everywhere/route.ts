import { answerSignOutEverywhere } from '../../../../server/accountApi'
import { prisma } from '../../../../server/database'
import { methodNotAllowed } from '../../../../server/response'
import { readLoginSettings } from '../../../../server/settings'
import { withSidRelogin } from '../../../../server/sidLogin'

// /api/account/signout-everywhere: POST revokes every login of the account until now and removes this browser's cookie.
// As after a sign-out, the next Sparklingstadt ID login then asks for the password (src/server/sidLogin.ts).

export async function POST(request: Request) {
  return withSidRelogin(request, await answerSignOutEverywhere(request, prisma), readLoginSettings()?.secure ?? false)
}

const onlyPost = async () => methodNotAllowed(['POST'])

export const GET = onlyPost
export const HEAD = onlyPost
export const PUT = onlyPost
export const PATCH = onlyPost
export const DELETE = onlyPost
// Next.js would answer OPTIONS itself with 204 and every method of this file.
export const OPTIONS = onlyPost
