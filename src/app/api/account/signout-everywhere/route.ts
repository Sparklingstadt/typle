import { answerSignOutEverywhere } from '../../../../server/accountApi'
import { methodNotAllowed } from '../../../../server/response'
import { readLoginSettings } from '../../../../server/settings'
import { withSidRelogin } from '../../../../server/sidLogin'

// /api/account/signout-everywhere: POST deletes every session of the account and removes this browser's cookies.
// As after a sign-out, the next Sparklingstadt ID login then asks for the password (src/server/sidLogin.ts).

export async function POST(request: Request) {
  return withSidRelogin(request, await answerSignOutEverywhere(request), readLoginSettings()?.secure ?? false)
}

const onlyPost = async () => methodNotAllowed(['POST'])

export const GET = onlyPost
export const HEAD = onlyPost
export const PUT = onlyPost
export const PATCH = onlyPost
export const DELETE = onlyPost
// Next.js would answer OPTIONS itself with 204 and every method of this file.
export const OPTIONS = onlyPost
