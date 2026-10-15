/** HTML5 drag payload for filing conversations onto folder / flow rail rows. */

export const THREAD_DRAG_MIME = 'application/x-bokito-thread-ids'

export function setThreadDragData(dataTransfer: DataTransfer, threadIds: string[]): void {
  const ids = [...new Set(threadIds.map((id) => String(id).trim()).filter(Boolean))]
  if (!ids.length) return
  dataTransfer.setData(THREAD_DRAG_MIME, JSON.stringify(ids))
  dataTransfer.setData('text/plain', ids.join(','))
  dataTransfer.effectAllowed = 'copyMove'
}

export function readThreadDragIds(dataTransfer: DataTransfer | null): string[] {
  if (!dataTransfer) return []
  const raw = dataTransfer.getData(THREAD_DRAG_MIME) || dataTransfer.getData('text/plain')
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) {
      return [...new Set(parsed.map((id) => String(id).trim()).filter(Boolean))]
    }
  } catch {
    // plain comma-separated fallback
  }
  return [...new Set(raw.split(/[\s,]+/).map((id) => id.trim()).filter(Boolean))]
}

export function dataTransferHasThreads(types: readonly string[] | DOMStringList): boolean {
  const list = Array.from(types as ArrayLike<string>)
  return list.includes(THREAD_DRAG_MIME) || list.includes('text/plain')
}
