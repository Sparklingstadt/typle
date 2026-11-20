const http = require('node:http')

// A fake Resend for the unit tests: an HTTP server on 127.0.0.1 that keeps every request it receives and answers
// with `status`. withEnv runs a function with RESEND_API_KEY, TYPLE_MAIL_FROM and TYPLE_RESEND_URL pointing at it
// (overrides of undefined remove a variable) and puts the environment back afterwards.
function fakeResend() {
  const received = []
  const fake = { received, status: 200 }
  const server = http.createServer((request, response) => {
    let data = ''
    request.on('data', chunk => { data += chunk })
    request.on('end', () => {
      received.push({ method: request.method, path: request.url, headers: request.headers, body: JSON.parse(data || 'null') })
      response.writeHead(fake.status, { 'Content-Type': 'application/json' })
      response.end(fake.status < 300 ? '{"id":"fake"}' : '{"message":"failed"}')
    })
  })
  fake.ready = new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  fake.close = () => new Promise(resolve => server.close(resolve))
  fake.withEnv = async (run, overrides = {}) => {
    const values = {
      RESEND_API_KEY: 'test-key',
      TYPLE_MAIL_FROM: 'Typle <test@example.test>',
      TYPLE_RESEND_URL: `http://127.0.0.1:${server.address().port}/emails`,
      ...overrides,
    }
    const saved = Object.fromEntries(Object.keys(values).map(name => [name, process.env[name]]))
    const apply = env => { for (const [name, value] of Object.entries(env)) value === undefined ? delete process.env[name] : process.env[name] = value }
    apply(values)
    try {
      return await run()
    } finally {
      apply(saved)
    }
  }
  return fake
}

module.exports = { fakeResend }
