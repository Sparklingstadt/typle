import { redirect } from "next/navigation"

// The gallery of shared packs was removed in v2.49.0 (packs are handed over as CSV or .typle-pack.json files now). Its
// links go to the catalog of the official packs.
export default function GalleryPage(): never {
  redirect("/packs/catalog")
}
