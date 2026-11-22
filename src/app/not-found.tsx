import type { Metadata } from "next"
import Link from "next/link"
import { getTranslations } from "next-intl/server"
import { House, Keyboard } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageMain } from "@/components/ui/page-layout"

// Shown for unmatched URLs and for notFound(). Next.js sends this file with every page, so it stays a server component.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("notFound")
  return { title: `${t("title")} | Typle` }
}

export default async function NotFound() {
  const t = await getTranslations("notFound")
  return <PageMain width="narrow" className="flex flex-col items-center pt-24 text-center">
    <p aria-hidden="true" className="text-6xl font-bold tabular-nums text-muted-foreground/60">404</p>
    <h1 className="mt-4 text-2xl font-bold">{t("title")}</h1>
    <p className="mt-2 max-w-md text-sm text-muted-foreground">{t("description")}</p>
    <div className="mt-8 flex flex-wrap justify-center gap-3">
      <Button asChild><Link href="/"><House aria-hidden="true" />{t("home")}</Link></Button>
      <Button asChild variant="outline"><Link href="/play"><Keyboard aria-hidden="true" />{t("play")}</Link></Button>
    </div>
  </PageMain>
}
