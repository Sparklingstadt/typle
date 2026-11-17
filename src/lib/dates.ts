// Records store UTC timestamps; every day and week boundary here follows the viewer's local calendar.
export const DAY_MS = 24 * 60 * 60 * 1000

export function startOfDay(date: Date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()) }
export function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}
export function startOfWeek(date: Date) {
  const day = startOfDay(date)
  return addDays(day, -((day.getDay() + 6) % 7))
}
export function daysBetween(from: Date, to: Date) { return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY_MS) }
