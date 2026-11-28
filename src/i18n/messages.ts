import type { Locale } from './config'
import type { Messages } from './messageTypes'

export type { Messages }

// Every area's file under src/messages/<locale>/; `satisfies` keeps this list in step with the message type.
const namespaces = Object.keys({
  errors: 0, format: 0, common: 0, metadata: 0, nav: 0, account: 0, settings: 0, input: 0, devices: 0, interests: 0, guide: 0, about: 0, landing: 0, sharedResult: 0, officialPack: 0, home: 0,
  practice: 0, wordLists: 0, records: 0, rankings: 0, dashboard: 0, globalError: 0, notFound: 0,
} satisfies Record<keyof Messages, 0>) as (keyof Messages)[]

export async function loadMessages(locale: Locale): Promise<Messages> {
  return Object.fromEntries(await Promise.all(namespaces.map(async namespace =>
    [namespace, (await import(`@/messages/${locale}/${namespace}.json`)).default]))) as Messages
}

// Messages only server components read never go to the browser: the 404 page (notFound), the guide, a shared result
// and the page titles (metadata) are server components. So is the landing page (/), except its word to try
// (landing.try), which is typed in the browser.
type ServerNamespace = 'guide' | 'sharedResult' | 'metadata' | 'globalError' | 'notFound'
export type ClientNamespace = Exclude<keyof Messages, ServerNamespace>

/** What the frame of every page reads in the browser: the navigation, the account menu, and the workspace's notices and errors. */
export const SHELL_NAMESPACES = ['account', 'common', 'errors', 'format', 'nav'] as const satisfies readonly ClientNamespace[]

/**
 * The messages a part of the app reads in the browser: the frame's, and the areas named. They travel in the HTML of
 * every page that part is on, so each route names only what its client components read (see ClientMessages.tsx).
 */
export function clientMessages(messages: Messages, namespaces: readonly ClientNamespace[] = []) {
  return Object.fromEntries([...SHELL_NAMESPACES, ...namespaces].map(namespace =>
    [namespace, namespace === 'landing' ? { try: messages.landing.try } : messages[namespace]]))
}
