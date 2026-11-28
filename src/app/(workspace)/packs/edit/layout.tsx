import type { Metadata } from "next"
import { pageMetadata } from "@/lib/pageMetadata"
import ClientMessages from "@/i18n/ClientMessages"

// The page is a client component, so its title and description are set here.
export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata("editPack", { personal: true })
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <ClientMessages namespaces={["wordLists"]}>{children}</ClientMessages>
}
