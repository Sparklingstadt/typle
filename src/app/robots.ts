import type { MetadataRoute } from "next"
import { robotsRules } from "@/lib/searchIndex"
import { siteUrl } from "@/lib/siteUrl"

export default function robots(): MetadataRoute.Robots {
  return robotsRules(siteUrl)
}
