import type { ReactNode } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages } from 'next-intl/server'
import { clientMessages, type ClientNamespace, type Messages } from './messages'

/**
 * Gives the client components inside it the messages of the frame and of the areas named, and no others. The root
 * layout names none; a route's layout names what its page reads. An inner one replaces the outer one, so the areas of
 * one route do not travel with the pages of another. tests/clientMessages.test.cjs checks that every route names each
 * area its client components read: one left out would show as a missing message in the browser.
 */
export default async function ClientMessages({ namespaces = [], children }: { namespaces?: readonly ClientNamespace[]; children: ReactNode }) {
  return <NextIntlClientProvider messages={clientMessages(await getMessages() as Messages, namespaces)}>{children}</NextIntlClientProvider>
}
