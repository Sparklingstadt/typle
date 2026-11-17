import type { MetadataRoute } from "next"
import { sitemapEntries } from "@/lib/searchIndex"
import { siteUrl } from "@/lib/siteUrl"
import { officialPackPagePaths } from "@/lib/packs/pages"

export default function sitemap(): MetadataRoute.Sitemap {
  return sitemapEntries(siteUrl, officialPackPagePaths())
}
