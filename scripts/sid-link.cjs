const path = require('node:path')
const { randomUUID } = require('node:crypto')
// The database code is TypeScript (src/server/database.ts, and Prisma Client generated into src/generated); the tests'
// loader compiles it as it is required.
require('../tests/register.cjs')
const { createPrisma } = require('../src/server/database.ts')

// npm run sid:link -- <sub> <account_id>: links a Sparklingstadt ID (its sub, with or without sid:) to the account of
// another login, so that signing in with that ID opens the account: it adds a row ('sid', sub) to Better Auth's
// typle_auth_accounts for the target user (typle_auth_users). It runs against DATABASE_URL (.env.local, or the
// environment, for production). Refused: an ID or an account that is linked already, a target that is not a user of
// another login or has nothing saved (a mistyped one), and an ID whose own account sid:<sub> has saved data, which the
// link would leave behind. A sid:<sub> user that signed in before but has nothing saved is replaced by the link.

/** The provider ID of Sparklingstadt ID in Better Auth's account table (src/server/sidLogin.ts). */
const SID_PROVIDER = 'sid'

/** The form of a Sparklingstadt ID sub, as src/server/authUser.ts accepts sid:<sub>. */
const SUB = /^[a-z0-9]{1,64}$/
/** The accounts of the other logins that a link may point at: GitHub, and the ID-and-password and FFPF accounts imported in v2.62.0. */
const OTHER_ACCOUNT = /^(github:\d+|password:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|ffpf:[a-z0-9]{1,64})$/

/** The sub of text, with or without sid:, or null when it is not one. */
function parseSub(text) {
  const sub = text.startsWith('sid:') ? text.slice(4) : text
  return SUB.test(sub) ? sub : null
}

/**
 * The database url names, as host[:port]/name without the user or password, so that the result says which database
 * was written to (a forgotten DATABASE_URL=<production> falls back to .env.local's).
 */
function databaseLabel(url) {
  try {
    const parsed = new URL(url)
    return `${parsed.host}${parsed.pathname}`
  } catch {
    return '?'
  }
}

/** Whether owner has a saved workspace or a practice record. */
async function hasData(db, owner) {
  const workspace = await db.workspace.findUnique({ where: { ownerId: owner } })
  const record = await db.record.findFirst({ where: { ownerId: owner } })
  return workspace !== null || record !== null
}

/**
 * Links sub to accountId in one transaction (db is Prisma Client). Answers 'linked', or why not: 'subLinked',
 * 'accountLinked', 'accountInvalid', 'accountMissing', 'accountEmpty' or 'sidHasData'.
 */
async function linkSid(db, sub, accountId) {
  if (!OTHER_ACCOUNT.test(accountId)) return 'accountInvalid'
  try {
    return await db.$transaction(async tx => {
      if (!(await tx.authUser.findUnique({ where: { id: accountId } }))) return 'accountMissing'
      const sidOwn = `sid:${sub}`
      const existing = await tx.authAccount.findUnique({ where: { providerId_accountId: { providerId: SID_PROVIDER, accountId: sub } } })
      if (existing && existing.userId !== sidOwn) return 'subLinked'
      if (await tx.authAccount.findFirst({ where: { userId: accountId, providerId: SID_PROVIDER } })) return 'accountLinked'
      if (!(await hasData(tx, accountId))) return 'accountEmpty'
      if (await hasData(tx, sidOwn)) return 'sidHasData'
      // The user sid:<sub> that signed in before, with nothing saved, goes (its sessions with it).
      if (existing) await tx.authUser.delete({ where: { id: sidOwn } })
      await tx.authAccount.create({ data: { id: randomUUID(), providerId: SID_PROVIDER, accountId: sub, userId: accountId } })
      return 'linked'
    })
  } catch (error) {
    // Another run linked one of them between the check and the insert (a unique key, P2002): say which.
    if (error?.code !== 'P2002') throw error
    return (await db.authAccount.findUnique({ where: { providerId_accountId: { providerId: SID_PROVIDER, accountId: sub } } })) ? 'subLinked' : 'accountLinked'
  }
}

const MESSAGES = {
  linked: 'ひも付けました。',
  subLinked: 'この Sparklingstadt ID は、もうほかのアカウントにひも付いています。',
  accountLinked: 'このアカウントには、もうほかの Sparklingstadt ID がひも付いています。',
  accountMissing: 'ひも付け先のアカウントが見つかりません。アカウント ID を確かめてください。',
  accountInvalid: 'ひも付け先は github:<数字> か password:<UUID> のアカウントにしてください。',
  accountEmpty: 'ひも付け先のアカウントに保存したデータがありません。アカウント ID を確かめてください。',
  sidHasData: 'この Sparklingstadt ID のアカウント（sid:<sub>）に、もう保存したデータがあります。ひも付けると読めなくなるため断りました。',
}

async function main(args) {
  const [subText, accountId] = args
  const sub = subText === undefined ? null : parseSub(subText)
  if (!sub || !accountId) throw new Error('使い方: npm run sid:link -- <sub> <account_id>（sub は sid: 付きでもよい）')
  require('@next/env').loadEnvConfig(path.join(__dirname, '..'))
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL を設定してください。')
  const db = createPrisma(url)
  try {
    const answer = await linkSid(db, sub, accountId)
    console.log(`${MESSAGES[answer]}（sid:${sub} → ${accountId}、DB: ${databaseLabel(url)}）`)
    return answer === 'linked'
  } finally {
    await db.$disconnect()
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then(linked => { if (!linked) process.exitCode = 1 }, error => {
    console.error(error.message)
    process.exit(1)
  })
}

module.exports = { databaseLabel, linkSid, parseSub }
