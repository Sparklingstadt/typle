import Link from "next/link"
import { getTranslations } from "next-intl/server"
import { Button } from "@/components/ui/button"
import { PageMain } from "@/components/ui/page-layout"

// Sharing a pack was removed in v2.49.0 (packs are handed over as CSV or .typle-pack.json files now). A link that was
// handed out still opens, and says the share has ended, without asking the server for anything.
export default async function SharedPack() {
  const errors = await getTranslations("errors")
  const t = await getTranslations("wordLists.sharedPage")
  return <PageMain width="narrow">
    <div className="space-y-4">
      <p role="status" className="text-lg font-bold">{errors("sharedPackNotFound")}</p>
      <Button asChild variant="outline"><Link href="/edit">{t("toPacks")}</Link></Button>
    </div>
  </PageMain>
}
