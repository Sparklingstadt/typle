// The app's own links with a query, built in one place so an id is always encoded the same way.
function withId(path: string, name: string, id: string) { return `${path}?${name}=${encodeURIComponent(id)}` }

/** Practises a list; with `review: 'weak'`, only its weak words. */
export function practicePath(listId: string, { review }: { review?: 'weak' } = {}) {
  return withId('/play', 'list', listId) + (review ? `&review=${review}` : '')
}

/** Opens the lists screen at a pack and points at its row. */
export function editPackPath(packId: string) { return withId('/edit', 'pack', packId) }

/** Opens a list in the editor. */
export function editListPath(listId: string) { return withId('/edit', 'list', listId) }

/** Opens a pack's own settings (name, description, sharing). */
export function packSettingsPath(packId: string) { return withId('/packs/edit', 'pack', packId) }
