"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { useWordLists } from "@/hooks/useWordLists"
import { randomId } from "@/lib/randomId"
import { practicePath } from "@/lib/routes"

/**
 * Starts practice on an official pack: follows the pack when it is not followed yet, then opens the first list of the
 * visitor's copy on /play. A visitor who follows the pack already goes straight to it. `starting` is the catalog id
 * being started, so only its button says it is preparing.
 */
export function useOfficialPackStart() {
  const { packs, lists, updateLibrary } = useWordLists()
  const router = useRouter()
  const [starting, setStarting] = useState<string | null>(null)

  async function start(catalogId: string) {
    setStarting(catalogId)
    const owned = packs.find(pack => pack.origin?.catalogId === catalogId)
    if (owned) {
      const first = lists.find(list => list.packId === owned.id)
      router.push(first ? practicePath(first.id) : "/play")
      return
    }
    // The catalog is loaded when a pack is first followed, not with the page; then the words of this pack.
    const { followOfficialPack, loadOfficialPacks, packSummaries } = await import("@/lib/packs/officialCatalog")
    const entry = packSummaries().find(item => item.catalogId === catalogId)
    const ids = { pack: randomId(), lists: entry ? entry.lists.map(() => randomId()) : [] }
    const saved = entry && await updateLibrary(library => followOfficialPack(library, catalogId, ids), undefined, () => loadOfficialPacks([catalogId]))
    if (!saved) { setStarting(null); return }
    router.push(practicePath(ids.lists[0]))
  }

  return { start, starting }
}
