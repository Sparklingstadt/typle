import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

// A link to a share of the past: keep it out of search indexes.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata")
  const title = t("sharedTitle")
  return { title, robots: { index: false, follow: false }, openGraph: { title }, twitter: { title } }
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
