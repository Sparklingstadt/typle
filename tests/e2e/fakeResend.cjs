const http = require('node:http')

// A fake Resend for the end-to-end tests, started by playwright.config.ts as a webServer: the app sends its mails here
// (TYPLE_RESEND_URL). POST /emails keeps the mail ({ from, to, subject, text }) and answers as Resend does; GET
// /emails?to=<address> answers the mails kept for that address as JSON, oldest first. Mails are kept in memory for
// the run only.
const port = Number(process.env.FAKE_RESEND_PORT || 3198)
const mails = []

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)
  const answer = (status, value) => {
    response.writeHead(status, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(value))
  }
  if (url.pathname !== '/emails') return answer(404, { message: 'not found' })
  if (request.method === 'GET') {
    const to = url.searchParams.get('to')
    return answer(200, to === null ? [] : mails.filter(mail => Array.isArray(mail.to) && mail.to.includes(to)))
  }
  if (request.method !== 'POST') return answer(405, { message: 'method not allowed' })
  let data = ''
  request.on('data', chunk => { data += chunk })
  request.on('end', () => {
    let mail
    try {
      mail = JSON.parse(data)
    } catch {
      return answer(422, { message: 'invalid JSON' })
    }
    mails.push(mail)
    answer(200, { id: `fake-${mails.length}` })
  })
})

server.listen(port, '127.0.0.1')
