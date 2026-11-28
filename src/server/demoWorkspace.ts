import { withoutFollowedWords } from '../lib/followedPacks'
import { followOfficialPack, officialPacks } from '../lib/packs/catalog'
import { SAMPLE_DEVICE, sampleLists } from '../lib/sampleLists'
import { convertLibrary, type Library } from '../lib/wordPacks'
import type { WorkspaceChange } from '../lib/workspaceDocument'

// The sample the shared demo account starts from and is put back to every day (src/server/demoReset.ts): the two sample
// lists with a week of practice (src/lib/sampleLists.ts), placed in this week and the one before in Japan, two followed
// official packs and interests already chosen (so the welcome tour is done).

/** The official packs the demo follows: one of programming, one of languages. */
export const DEMO_FOLLOWED = ['pack-0b27f311-38aa-40aa-9c29-ea17e374e1fe', 'pack-english-basic-words']

const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE

/** Japan's offset from UTC: the cron resets at 4:00 there, and the dashboard's week starts on Monday at 0:00. */
const JAPAN = 9 * 60 * MINUTE

/** Monday 0:00 in Japan of the week of now. */
function weekStart(now: Date): number {
  const japan = new Date(now.getTime() + JAPAN)
  const midnight = Date.UTC(japan.getUTCFullYear(), japan.getUTCMonth(), japan.getUTCDate())
  return midnight - ((japan.getUTCDay() + 6) % 7) * DAY - JAPAN
}

/** The demo account's workspace at now, following those of catalogIds that the catalog still has. */
export function demoWorkspace(now: Date, catalogIds: string[] = DEMO_FOLLOWED): Required<WorkspaceChange> {
  const known = new Set(officialPacks().map(entry => entry.catalogId))
  let library: Library = convertLibrary(sampleLists(now, weekStart(now)))
  for (const catalogId of catalogIds.filter(id => known.has(id))) {
    const entry = officialPacks().find(item => item.catalogId === catalogId)!
    library = followOfficialPack(library, catalogId, {
      pack: `demo-${catalogId}`, lists: entry.lists.map((_, n) => `demo-${catalogId}-${n + 1}`),
    }, now)
  }
  const saved = withoutFollowedWords(library)
  return { lists: saved.lists, packs: saved.packs, devices: [SAMPLE_DEVICE], interests: ['programming/linux', 'language/en'] }
}
