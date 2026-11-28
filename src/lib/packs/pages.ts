// The pages of the official packs (pageList.ts) with their packs, for the server: this file reads the whole catalog.
import { officialPacks, type OfficialPack } from './catalog'
import { OFFICIAL_PACK_PAGES, type OfficialPackPage } from './pageList'

export { OFFICIAL_PACK_PAGES, type OfficialPackPage }

export type OfficialPackPageEntry = OfficialPackPage & { entry: OfficialPack }

export function officialPackPage(slug: string): OfficialPackPageEntry | null {
  const page = OFFICIAL_PACK_PAGES.find(item => item.slug === slug)
  const entry = page && officialPacks().find(item => item.catalogId === page.catalogId)
  return page && entry ? { ...page, entry } : null
}

export function officialPackPagePaths(): string[] {
  return OFFICIAL_PACK_PAGES.filter(page => !page.canonical).map(page => `/packs/${page.slug}`)
}
