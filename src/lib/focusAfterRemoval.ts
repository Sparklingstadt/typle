// What takes the focus after a list is deleted: read-only rows have no edit button and cannot be deleted, so they are not counted.
export const LIST_FOCUS_TARGETS = '[data-list-id] [data-edit]'

// After a removal, focus the item that took the removed item's place so the next one can be handled too, or, when none
// is left, the first of the fallback elements that is there (by default the lists' heading, or the empty state's when
// the list went with the last item).
export function focusAfterRemoval(event: Event, selector: string, position: number, removed: boolean, fallback = ['list-heading', 'empty-heading']) {
  event.preventDefault()
  const buttons = document.querySelectorAll<HTMLElement>(selector)
  const target = removed ? buttons[Math.min(position, buttons.length - 1)] : buttons[position]
  if (target) target.focus()
  else fallback.map(id => document.getElementById(id)).find(element => element)?.focus()
}
