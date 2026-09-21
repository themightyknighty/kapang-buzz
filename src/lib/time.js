export function ago(iso, now = Date.now()) {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60000))
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.round(h / 24)
  return `${d} day${d === 1 ? '' : 's'} ago`
}
export const clock = (d = new Date()) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
export const longDate = (d = new Date()) => d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
