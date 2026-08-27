import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  activeMentionQuery,
  filterMentionItems,
  type MentionItem,
  type MentionQuery,
} from '../lib/mentions'
import { applyDisplayEdit, applyMentionAtDisplay, displayFromRaw } from '../lib/mention-editor'

type Options = {
  initialRaw?: string
  items?: MentionItem[]
}

/**
 * Shared mention draft for chat composers: raw API markup in state, @Name in
 * the textarea, Slack-style pills in the highlighter layer.
 */
export function useMentionDraft(options: Options = {}) {
  const { initialRaw = '', items = [] } = options
  const [raw, setRaw] = useState(initialRaw)
  const display = useMemo(() => displayFromRaw(raw), [raw])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const pendingCaretRef = useRef<number | null>(null)
  const [mentionQuery, setMentionQuery] = useState<MentionQuery | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)

  const mentionMatches = useMemo(
    () => (mentionQuery ? filterMentionItems(items, mentionQuery.query) : []),
    [items, mentionQuery],
  )
  const mentionOpen = mentionQuery !== null && mentionMatches.length > 0

  const refreshMentionState = (value: string, caret: number) => {
    const next = activeMentionQuery(value, caret)
    setMentionQuery(next)
    if (next?.query !== mentionQuery?.query) setMentionIndex(0)
  }

  const applyDisplay = (nextDisplay: string, caret?: number) => {
    const edit = applyDisplayEdit(raw, nextDisplay)
    setRaw(edit.raw)
    if (edit.display !== nextDisplay) {
      pendingCaretRef.current = edit.displayCaret
      refreshMentionState(edit.display, edit.displayCaret)
    } else {
      refreshMentionState(edit.display, caret ?? edit.display.length)
    }
  }

  const selectMention = (item: MentionItem) => {
    if (!mentionQuery) return
    const caret = textareaRef.current?.selectionStart ?? display.length
    const applied = applyMentionAtDisplay(raw, caret, mentionQuery, item)
    setRaw(applied.raw)
    pendingCaretRef.current = applied.displayCaret
    setMentionQuery(null)
    setMentionIndex(0)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  useLayoutEffect(() => {
    const caret = pendingCaretRef.current
    if (caret == null) return
    pendingCaretRef.current = null
    textareaRef.current?.setSelectionRange(caret, caret)
  }, [display])

  const onChange = (nextDisplay: string, caret: number) => {
    applyDisplay(nextDisplay, caret)
  }

  const onKeyDown = (
    e: KeyboardEvent<HTMLTextAreaElement>,
    onSubmit?: () => void,
  ): boolean => {
    if (mentionOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIndex((i) => (i + 1) % mentionMatches.length)
        return true
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIndex((i) => (i - 1 + mentionMatches.length) % mentionMatches.length)
        return true
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        selectMention(mentionMatches[mentionIndex] ?? mentionMatches[0])
        return true
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMentionQuery(null)
        return true
      }
    }
    if (onSubmit && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSubmit()
      return true
    }
    return false
  }

  return {
    raw,
    setRaw,
    display,
    textareaRef,
    mentionOpen,
    mentionMatches,
    mentionIndex,
    setMentionIndex,
    selectMention,
    refreshMentionState,
    onChange,
    onKeyDown,
  }
}
