const path = require('node:path')

// npm run sid:link -- <sub> <account_id>: links a Sparklingstadt ID (its sub, with or without sid:) to the account of
// another login, so that signing in with that ID opens the account (typle_sid_links, read by src/server/sidLinks.ts).
// It runs against DATABASE_URL (.env.local, or the environment, for production). Refused: an ID or an account that is
// linked already, an account that is not one of another login or has nothing saved (a mistyped one), and an ID whose
// own account sid:<sub> has saved data, which the link would leave behind.

/** The form of a Sparklingstadt ID sub, as src/server/session.ts accepts sid:<sub>. */
const SUB = /^[a-z0-9]{1,64}$/
/** The accounts of the other logins, as src/server/session.ts accepts them. */
const OTHER_ACCOUNT = /^(github:\d+|password:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|ffpf:[a-z0-9]{1,64})$/

/** The sub of text, with or without sid:, or null when it is not one. */
function parseSub(text) {
  const sub = text.startsWith('sid:') ? text.slice(4) : text
  return SUB.test(sub) ? sub : null
}

/** Whether owner has a saved workspace or a practice record. */
async function hasData(client, owner) {
  const { rows } = await client.query(`SELECT EXISTS (SELECT 1 FROM typle_workspaces WHERE owner_id = $1)
    OR EXISTS (SELECT 1 FROM typle_records WHERE owner_id = $1) AS found`, [owner])
  return rows[0].found
}

/**
 * Links sub to accountId in one transaction. Answers 'linked', or why not: 'subLinked', 'accountLinked',
 * 'accountInvalid', 'accountEmpty' or 'sidHasData'.
 */
async function linkSid(db, sub, accountId) {
  if (!OTHER_ACCOUNT.test(accountId)) return 'accountInvalid'
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const linked = await client.query('SELECT sub, account_id FROM typle_sid_links WHERE sub = $1 OR account_id = $2',
      [sub, accountId])
    let answer = null
    if (linked.rows.some(row => row.sub === sub)) answer = 'subLinked'
    else if (linked.rows.length > 0) answer = 'accountLinked'
    else if (!(await hasData(client, accountId))) answer = 'accountEmpty'
    else if (await hasData(client, `sid:${sub}`)) answer = 'sidHasData'
    if (answer) {
      await client.query('ROLLBACK')
      return answer
    }
    try {
      await client.query('INSERT INTO typle_sid_links (sub, account_id) VALUES ($1, $2)', [sub, accountId])
    } catch (error) {
      await client.query('ROLLBACK')
      // Another run linked one of them between the check and the insert.
      if (error.code === '23505') return error.constraint === 'typle_sid_links_pkey' ? 'subLinked' : 'accountLinked'
      throw error
    }
    await client.query('COMMIT')
    return 'linked'
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

const MESSAGES = {
  linked: 'ひも付けました。',
  subLinked: 'この Sparklingstadt ID は、もうほかのアカウントにひも付いています。',
  accountLinked: 'このアカウントには、もうほかの Sparklingstadt ID がひも付いています。',
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
  const { Pool } = require('pg')
  const db = new Pool({ connectionString: url, max: 1 })
  try {
    const answer = await linkSid(db, sub, accountId)
    console.log(`${MESSAGES[answer]}（sid:${sub} → ${accountId}）`)
    return answer === 'linked'
  } finally {
    await db.end()
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then(linked => { if (!linked) process.exitCode = 1 }, error => {
    console.error(error.message)
    process.exit(1)
  })
}

module.exports = { linkSid, parseSub }
