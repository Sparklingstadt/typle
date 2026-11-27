"use client"
import { ErrorAlert } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { PageMain } from "@/components/ui/page-layout"
import { useWordLists } from "@/hooks/useWordLists"
import { useWelcomeRedirect } from "@/hooks/useWelcomeRedirect"
import Dashboard from "@/components/Dashboard/Dashboard"
import { useId, useState } from "react"
import { startOfWeek } from "@/lib/dates"
import { sampleLists } from "@/lib/sampleLists"

// Before the first record, the home screen as it reads with a week of practice, from sample lists. It is inert: its
// links and charts are only to look at.
function Preview() {
  const t = useTranslations("home.preview")
  const id = useId()
  const [lists] = useState(() => { const now = new Date(); return sampleLists(now, startOfWeek(now).getTime()) })
  return <section aria-labelledby={id} className="mt-12 flex flex-col gap-4">
    <div className="space-y-1">
      <h2 id={id} className="flex flex-wrap items-center gap-2 text-xl">{t("title")}<Badge variant="outline">{t("badge")}</Badge></h2>
      <p className="text-sm text-muted-foreground">{t("text")}</p>
    </div>
    {/* Screen readers already skip what is inert; aria-hidden says so to tools that do not. */}
    <div inert aria-hidden="true" className="select-none rounded-2xl border border-dashed p-4 sm:p-6">
      <Dashboard lists={lists} preview />
    </div>
  </section>
}

export default function Home() {
  const t = useTranslations("home")
  const common = useTranslations("common")
  const { lists, storage, ready, error } = useWordLists()
  const redirecting = useWelcomeRedirect()
  const count = lists.reduce((total, list) => total + list.records.length, 0)
  return <PageMain width="wide">
    {error && <ErrorAlert className="mb-6">{error}</ErrorAlert>}
    {!ready || redirecting ? <p>{common("loading")}</p> : count ? <Dashboard lists={lists} storage={storage} /> : <>
      <h1 className="text-3xl mb-4">{t("welcome.title")}</h1>
      <p className="mb-6">{t("welcome.text")}</p>
      <div className="flex flex-wrap gap-3 mb-6"><Badge variant="secondary">{t("welcome.lists", { count: lists.length })}</Badge><Badge variant="secondary">{t("welcome.practices", { count })}</Badge></div>
      <nav aria-label={t("welcome.navLabel")} className="flex gap-4 flex-wrap">
        <Button asChild><Link href="/play">{t("welcome.play")}</Link></Button>
        <Button asChild variant="outline"><Link href="/create">{t("welcome.create")}</Link></Button>
        <Button asChild variant="link"><Link href="/records">{t("welcome.records")}</Link></Button>
      </nav>
      <Preview />
    </>}
    <p className="mt-8">{t(storage === "account" ? "storageAccount" : "storage")}</p>
    <p className="mt-4">{t.rich("links", {
      guide: chunks => <Link className="underline" href="/guide">{chunks}</Link>,
      about: chunks => <Link className="underline" href="/about">{chunks}</Link>,
    })}</p>
  </PageMain>
}
