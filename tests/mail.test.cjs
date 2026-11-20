require('./register.cjs')
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { fakeResend } = require('./fakeResendServer.cjs')
const { sendMail, verifyMail, resetMail, loginIdsMail } = require('../src/server/mail.ts')

// sendMail against a fake Resend on 127.0.0.1, and the mails' texts.
const resend = fakeResend()
after(() => resend.close())

test('sendMail posts the mail to Resend with the key and the sender', async () => {
  await resend.ready
  await resend.withEnv(async () => {
    await sendMail('to@example.com', 'Subject', 'Body text')
  })
  assert.equal(resend.received.length, 1)
  const [mail] = resend.received
  assert.equal(mail.method, 'POST')
  assert.equal(mail.path, '/emails')
  assert.equal(mail.headers.authorization, 'Bearer test-key')
  assert.match(mail.headers['content-type'], /^application\/json/)
  assert.deepEqual(mail.body, { from: 'Typle <test@example.test>', to: ['to@example.com'], subject: 'Subject', text: 'Body text' })
})

test('sendMail throws when Resend does not answer 2xx', async () => {
  await resend.ready
  resend.status = 500
  try {
    await resend.withEnv(() => assert.rejects(sendMail('to@example.com', 'S', 'T')))
  } finally {
    resend.status = 200
  }
})

test('sendMail throws without a key or a sender, and sends nothing', async () => {
  await resend.ready
  const before = resend.received.length
  await resend.withEnv(() => assert.rejects(sendMail('to@example.com', 'S', 'T'), /mail is not configured/), { RESEND_API_KEY: undefined })
  await resend.withEnv(() => assert.rejects(sendMail('to@example.com', 'S', 'T'), /mail is not configured/), { TYPLE_MAIL_FROM: undefined })
  assert.equal(resend.received.length, before)
})

test('the mails carry the link or the IDs in the reader\'s language', () => {
  const link = 'https://typle.example/verify-email?token=abc'
  const ja = verifyMail('ja', link)
  const en = verifyMail('en', link)
  assert.ok(ja.subject && en.subject && ja.subject !== en.subject)
  assert.ok(ja.text.includes(link) && en.text.includes(link))
  for (const locale of ['ja', 'en', 'zh-CN', 'zh-TW', 'ru', 'fr']) {
    const reset = resetMail(locale, 'https://typle.example/reset-password?token=x')
    assert.ok(reset.subject && reset.text.includes('/reset-password?token=x'), locale)
    const ids = loginIdsMail(locale, ['alice', 'bob_2'])
    assert.ok(ids.subject && ids.text.includes('alice') && ids.text.includes('bob_2'), locale)
    assert.doesNotMatch(reset.text + ids.text, /\{\w+\}/, locale)
  }
})
