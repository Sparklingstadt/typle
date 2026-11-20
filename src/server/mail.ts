import { defaultLocale, isLocale, type Locale } from '../i18n/config'
import en from '../messages/en/mail.json'
import fr from '../messages/fr/mail.json'
import ja from '../messages/ja/mail.json'
import ru from '../messages/ru/mail.json'
import zhCN from '../messages/zh-CN/mail.json'
import zhTW from '../messages/zh-TW/mail.json'

// The mails the app sends through Resend: the confirmation of an address, the link that resets a password, and the
// list of an address's IDs. Their texts are in src/messages/<locale>/mail.json, read here directly rather than through
// next-intl, because a mail may be written for an account's stored language, outside any page's request.

type MailTexts = typeof ja

const texts: Record<Locale, MailTexts> = { ja, en, 'zh-CN': zhCN, 'zh-TW': zhTW, ru, fr }

export type Mail = { subject: string, text: string }

/** The texts of locale, Japanese for a value that is no language of the app (an old or broken stored locale). */
const textsOf = (locale: string): MailTexts => texts[isLocale(locale) ? locale : defaultLocale]

/** The message with each {name} replaced by its value. Only plain placeholders are used, so no ICU formatting. */
const fill = (message: string, values: Record<string, string>) =>
  message.replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole)

/** The mail that asks to confirm the address; link is `${origin}/verify-email?token=…`. */
export function verifyMail(locale: string, link: string): Mail {
  const { subject, body } = textsOf(locale).verify
  return { subject, text: fill(body, { link }) }
}

/** The mail with the link that sets a new password; link is `${origin}/reset-password?token=…`. */
export function resetMail(locale: string, link: string): Mail {
  const { subject, body } = textsOf(locale).reset
  return { subject, text: fill(body, { link }) }
}

/** The mail that lists the IDs whose verified address it is sent to, one per line. */
export function loginIdsMail(locale: string, ids: string[]): Mail {
  const { subject, body } = textsOf(locale).loginIds
  return { subject, text: fill(body, { ids: ids.join('\n') }) }
}

const RESEND_URL = 'https://api.resend.com/emails'

/**
 * Sends a plain-text mail with Resend (RESEND_API_KEY, from TYPLE_MAIL_FROM; TYPLE_RESEND_URL replaces the endpoint in
 * tests). Throws when either is not set or Resend does not answer 2xx. The error tells only the status, never the
 * mail, so that a report of it cannot carry a link's token.
 */
export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  const key = process.env.RESEND_API_KEY
  const from = process.env.TYPLE_MAIL_FROM
  if (!key || !from) throw new Error('mail is not configured')
  const response = await fetch(process.env.TYPLE_RESEND_URL || RESEND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, text }),
    signal: AbortSignal.timeout(10_000),
  })
  // Drain the body so that the connection can be reused.
  await response.arrayBuffer().catch(() => undefined)
  if (!response.ok) throw new Error(`mail was not sent: Resend answered ${response.status}`)
}
