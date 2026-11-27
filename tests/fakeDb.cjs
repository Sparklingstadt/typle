// Made-up databases for the tests of what the API answers when the database fails, so that no database is needed.

const down = () => Promise.reject(new Error('the database is down'))

/** A callable stand-in: calling it, or any method of it, answers by key (`model.method` or `$method`). */
function call(key, answers) {
  return new Proxy(() => {}, {
    apply: () => key in answers ? Promise.resolve(answers[key]) : down(),
    get: (_, method) => call(`${key}.${String(method)}`, answers),
  })
}

/**
 * A Prisma Client whose every call fails, except the calls named in answers (`'workspace.findUnique': null`),
 * which answer with their value.
 */
function failingDb(answers = {}) {
  return new Proxy({}, { get: (_, name) => call(String(name), answers) })
}

/** db, except that its transactions fail: it answers the login's questions but cannot write. */
function withoutTransactions(db) {
  return new Proxy(db, { get: (target, name) => name === '$transaction' ? down : target[name] })
}

module.exports = { failingDb, withoutTransactions }
