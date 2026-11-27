import { useId } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { BookOpen, ChevronRight, Info, type LucideIcon } from "lucide-react"
import { IconTile } from "@/components/ui/icon-tile"

// Each card is one link, styled like a Card (which cannot wrap a link) so the whole card is the target.
const cards: { key: "guide" | "about"; href: string; icon: LucideIcon }[] = [
  { key: "guide", href: "/guide", icon: BookOpen },
  { key: "about", href: "/about", icon: Info },
]

/** The guide and about pages as cards, for the home of someone who has not practised yet. */
export default function HelpCards() {
  const t = useTranslations("home.welcome.help")
  const id = useId()
  return <nav aria-labelledby={id} className="mt-8">
    <h2 id={id} className="text-lg mb-3">{t("title")}</h2>
    <div className="grid gap-3 sm:grid-cols-2">
      {cards.map(({ key, href, icon }) => <Link key={key} href={href} className="flex items-center gap-4 rounded-xl border bg-card p-4 text-card-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <IconTile icon={icon} className="shrink-0" />
        <span className="flex min-w-0 flex-col gap-1">
          <span className="font-medium">{t(`${key}.title`)}</span>
          <span className="text-sm text-muted-foreground">{t(`${key}.text`)}</span>
        </span>
        <ChevronRight className="ms-auto size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>)}
    </div>
  </nav>
}
