// The official packs that have a page of their own (/packs/<slug>) for people who find them through a search.
// The description is written by hand for each, in the language the packs' words are explained in.
// Apart from pages.ts, which reads the whole catalog with it: the catalog's screen in the browser reads this file only.
import pages from './pages.json'

// A pack whose words are the same as another's (the same words split by level) names that page as `canonical`:
// search engines are pointed to that page, and the sitemap leaves this one out.
export type OfficialPackPage = { slug: string; catalogId: string; description: string; canonical?: string }

export const OFFICIAL_PACK_PAGES: readonly OfficialPackPage[] = pages
