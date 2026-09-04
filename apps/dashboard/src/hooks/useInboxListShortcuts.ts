import { useEffect, useRef } from 'react'
import type { ThreadId } from '../lib/inbox-api'

const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable="true"]'

/**
 * Walk into open shadow roots (e.g. in-app `bokito-chat`). Keydown listeners
 * on window see a retargeted host as `event.target`, so we must use the
 * deepest `activeElement` to detect typing in the widget composer.
 */
export function deepestActiveElement(): Element | null {
  let el: Element | null = document.activeElement
  while (el instanceof HTMLElement && el.shadowRoot?.activeElement) {
    el = el.shadowRoot.activeElement
  }
  return el
}

function elementIsEditable(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  if (el.matches(EDITABLE_SELECTOR)) return true
  return Boolean(el.closest(EDITABLE_SELECTOR))
}

export function isTypingTarget(target: EventTarget | null): boolean {
  // Prefer deepest activeElement so open shadow roots (bokito-chat) count as typing.
  if (elementIsEditable(deepestActiveElement())) return true
  if (target instanceof Element && elementIsEditable(target)) return true
  return false
}

export function isInsideDialog(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('[role="dialog"]'))
}

/** Radix menus/listboxes stay in a portal; Esc should close them, not the thread. */
export function isInsideOpenMenu(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return Boolean(document.querySelector('[role="menu"], [data-radix-menu-content]'))
  }
  return Boolean(
    target.closest('[role="menu"], [role="listbox"], [data-radix-menu-content], [data-radix-popper-content-wrapper]'),
  )
}

export function scrollActiveThreadIntoView(): void {
  requestAnimationFrame(() => {
    document.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  })
}

export function focusInboxReply(): boolean {
  const el = document.getElementById('inbox-reply-composer')
  if (!(el instanceof HTMLElement)) return false
  el.focus()
  return true
}

type Options = {
  enabled?: boolean
  /** Compose or another modal — navigation keys still work unless focus is inside it. */
  dialogOpen?: boolean
  helpOpen?: boolean
  onCloseHelp?: () => void
  onOpenHelp?: () => void
  selectedThreadId: ThreadId | null
  threadIds: ThreadId[]
  onSelect: (id: ThreadId) => void
  onEscapeList?: () => void
  onClose?: () => void
  onUnread?: () => void
  onMarkRead?: () => void
  onJumpUnread?: (direction: 1 | -1) => void
  onSelectAll?: () => void
  onAssign?: () => void
  onAssignPicker?: () => void
  onPin?: () => void
  onReply?: () => void
  onCompose?: () => void
  onNewChat?: () => void
  onSnooze?: () => void
  onSnoozeCustom?: () => void
  onToggleSelect?: () => void
  onCopyLink?: () => void
  onCopyId?: () => void
  onDigitFilter?: (digit: 1 | 2 | 3 | 4 | 5) => void
}

export function useInboxListShortcuts(options: Options): void {
  const optionsRef = useRef(options)
  optionsRef.current = options

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const o = optionsRef.current
      if (o.enabled === false) return
      if ((event.metaKey || event.ctrlKey) && (event.key === 'a' || event.key === 'A') && o.onSelectAll) {
        if (!isTypingTarget(event.target) && !isInsideDialog(event.target)) {
          event.preventDefault()
          o.onSelectAll()
        }
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (o.dialogOpen && isInsideDialog(event.target)) return

      if (o.helpOpen) {
        if (event.key === '?' || event.key === 'Escape') {
          event.preventDefault()
          o.onCloseHelp?.()
        }
        return
      }

      if (event.key === '/' && !isTypingTarget(event.target)) {
        event.preventDefault()
        document.getElementById('inbox-search')?.focus()
        return
      }
      if (event.key === '?' && !isTypingTarget(event.target)) {
        event.preventDefault()
        o.onOpenHelp?.()
        return
      }
      if (isTypingTarget(event.target)) return

      if (event.key === 'Escape') {
        if (isInsideOpenMenu(event.target) || isInsideDialog(event.target)) return
        event.preventDefault()
        o.onEscapeList?.()
        return
      }

      const ids = o.threadIds
      const index =
        o.selectedThreadId == null
          ? -1
          : ids.findIndex((id) => String(id) === String(o.selectedThreadId))

      if ((event.key === ']' || (event.key === 'j' || event.key === 'J') && event.shiftKey) && o.onJumpUnread) {
        event.preventDefault()
        o.onJumpUnread(1)
        return
      }
      if ((event.key === '[' || (event.key === 'k' || event.key === 'K') && event.shiftKey) && o.onJumpUnread) {
        event.preventDefault()
        o.onJumpUnread(-1)
        return
      }
      if (event.key === 'j' || event.key === 'J') {
        const next = ids[index + 1] ?? ids[0]
        if (next != null) o.onSelect(next)
        event.preventDefault()
        return
      }
      if (event.key === 'k' || event.key === 'K') {
        const prev = ids[index - 1] ?? ids[ids.length - 1]
        if (prev != null) o.onSelect(prev)
        event.preventDefault()
        return
      }
      if (o.selectedThreadId == null) return

      if ((event.key === 'e' || event.key === 'E') && o.onClose) {
        event.preventDefault()
        o.onClose()
        return
      }
      if ((event.key === 'u' || event.key === 'U') && event.shiftKey && o.onMarkRead) {
        event.preventDefault()
        o.onMarkRead()
        return
      }
      if ((event.key === 'u' || event.key === 'U') && o.onUnread) {
        event.preventDefault()
        o.onUnread()
        return
      }
      if ((event.key === 'a' || event.key === 'A') && event.shiftKey && o.onAssignPicker) {
        event.preventDefault()
        o.onAssignPicker()
        return
      }
      if ((event.key === 'a' || event.key === 'A') && o.onAssign) {
        event.preventDefault()
        o.onAssign()
        return
      }
      if ((event.key === 'p' || event.key === 'P') && o.onPin) {
        event.preventDefault()
        o.onPin()
        return
      }
      if ((event.key === 'r' || event.key === 'R') && o.onReply) {
        event.preventDefault()
        o.onReply()
        return
      }
      if ((event.key === 'c' || event.key === 'C') && o.onCompose) {
        event.preventDefault()
        o.onCompose()
        return
      }
      if ((event.key === 'n' || event.key === 'N') && o.onNewChat) {
        event.preventDefault()
        o.onNewChat()
        return
      }
      if ((event.key === 'h' || event.key === 'H') && event.shiftKey && o.onSnoozeCustom) {
        event.preventDefault()
        o.onSnoozeCustom()
        return
      }
      if ((event.key === 'h' || event.key === 'H') && o.onSnooze) {
        event.preventDefault()
        o.onSnooze()
        return
      }
      if ((event.key === 'x' || event.key === 'X') && o.onToggleSelect) {
        event.preventDefault()
        o.onToggleSelect()
        return
      }
      if ((event.key === 'l' || event.key === 'L') && o.onCopyLink) {
        event.preventDefault()
        o.onCopyLink()
        return
      }
      if (event.key === '#' && o.onCopyId) {
        event.preventDefault()
        o.onCopyId()
        return
      }
      if ((event.key === '1' || event.key === '2' || event.key === '3' || event.key === '4' || event.key === '5') && o.onDigitFilter) {
        event.preventDefault()
        o.onDigitFilter(Number(event.key) as 1 | 2 | 3 | 4 | 5)
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
