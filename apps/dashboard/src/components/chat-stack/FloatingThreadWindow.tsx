import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { Avatar } from '../ui/avatar'
import { useTranslation } from 'react-i18next'
import { Maximize2, Minus, X } from 'lucide-react'
import ThreadDetail from '../inbox/ThreadDetail'
import { useThreadDetail } from '../../hooks/useThreadDetail'
import { useMailboxConnections } from '../../hooks/useMailboxConnections'
import { usePinnedIds } from '../../hooks/usePinnedIds'
import type { MessageAttachment } from '../../lib/inbox-api'
import type { StackCard } from '../../hooks/useChatStack'
import {
  useAgentCallLive,
  useAgentCallSpeaking,
  useAgentCallUserSpeaking,
} from '../../lib/agent-call-live'
import { playEarcon } from '../../lib/earcons'
import { closeFloatingThread, onFloatingThreadCloseRequest } from '../../lib/chat-stack'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'

const DRAG_MARGIN = 8

/** Keep the window inside the viewport when the user drags it. */
function clampOffset(
  el: HTMLElement,
  next: { x: number; y: number },
  right: number,
  bottom: number,
): { x: number; y: number } {
  const w = el.offsetWidth
  const h = el.offsetHeight
  const baseLeft = window.innerWidth - right - w
  const baseTop = window.innerHeight - bottom - h
  const minX = DRAG_MARGIN - baseLeft
  const maxX = window.innerWidth - DRAG_MARGIN - w - baseLeft
  const minY = DRAG_MARGIN - baseTop
  const maxY = window.innerHeight - DRAG_MARGIN - h - baseTop
  return {
    x: Math.min(maxX, Math.max(minX, next.x)),
    y: Math.min(maxY, Math.max(minY, next.y)),
  }
}

type ReplyExtras = {
  cc?: string
  bcc?: string
  channelAccountId?: string
  to?: string
  mode?: 'reply' | 'reply_all' | 'forward' | 'new'
  sourceMessageId?: string
  subject?: string
  quotedHtml?: string
  handback?: boolean
  keepOpen?: boolean
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

const OPEN_MS = 520
const CLOSE_MS = 420
const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)'
const EASE_IN = 'cubic-bezier(0.4, 0, 0.15, 1)'

/** A fixed rectangle. Both frames use `position: fixed` so the box can leave its anchor. */
function boxFrame(rect: DOMRect, radius: string): Keyframe {
  return {
    position: 'fixed',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    right: 'auto',
    bottom: 'auto',
    transform: 'none',
    borderRadius: radius,
  }
}

/** Where a card would sit when this window was not opened from one. */
function dockFallback(win: DOMRect): DOMRect {
  const width = Math.min(248, win.width)
  const height = 62
  return new DOMRect(win.right - width, win.bottom + 32, width, height)
}

function cardRect(threadId: string): DOMRect | null {
  const el = document.querySelector(`[data-stack-card-id="${CSS.escape(threadId)}"] .chat-stack-card-body`)
  return el ? el.getBoundingClientRect() : null
}

function fadeSurface(el: HTMLElement | null, direction: 'in' | 'out', ms: number) {
  if (!el) return
  el.getAnimations().forEach((anim) => anim.cancel())
  if (direction === 'in') {
    el.style.opacity = '0'
    el.style.pointerEvents = 'none'
    const anim = el.animate(
      [
        { opacity: 0, offset: 0 },
        { opacity: 0, offset: 0.22 },
        { opacity: 1, offset: 0.58 },
      ],
      { duration: ms, easing: 'linear', fill: 'forwards' },
    )
    const clear = () => {
      anim.onfinish = null
      el.style.opacity = ''
      el.style.pointerEvents = ''
      anim.cancel()
    }
    anim.onfinish = clear
    return
  }
  el.animate(
    [
      { opacity: 1, offset: 0 },
      { opacity: 0, offset: 0.32 },
    ],
    { duration: ms, easing: 'linear', fill: 'forwards' },
  )
}

export type FloatingThreadWindowProps = {
  threadId: string
  origin: DOMRect | null
  card: StackCard | null
  right: number
  bottom: number
  onMinimize: () => void
  onClose: () => void
  onExpand: () => void
}

/**
 * A conversation from the chat stack, opened over the current page. Grows
 * out of its card and shrinks back into it; the full conversation is one
 * click away. Pin and unpin live on the corner card.
 */
export function FloatingThreadWindow({
  threadId,
  origin,
  card,
  right,
  bottom,
  onMinimize,
  onClose,
  onExpand,
}: FloatingThreadWindowProps) {
  const { t } = useTranslation('communication')
  const call = useAgentCallLive()
  const speaking = useAgentCallSpeaking()
  const userSpeaking = useAgentCallUserSpeaking()
  const onCall =
    call?.signalId === threadId && (call.status === 'live' || call.status === 'connecting')
  const { pinnedIds } = usePinnedIds()
  const { activeConnections, setupNeededConnections, loading: mailboxesLoading } = useMailboxConnections()
  // While mailboxes load, don't claim the thread has no mailbox.
  const canSendEmail = mailboxesLoading || activeConnections.length > 0
  const mailboxNeedsSetup =
    !mailboxesLoading && activeConnections.length === 0 && setupNeededConnections.length > 0
  const [mailOpen, setMailOpen] = useState(false)
  const {
    detail,
    loading,
    loadingOlder,
    hasOlder,
    loadOlder,
    error,
    saving,
    unreadHighlightIds,
    refresh,
    patch,
    reply,
    retryFailedSend,
    addNote,
    updateNote,
    deleteNote,
    changeAiHandling,
  } = useThreadDetail(threadId, pinnedIds)
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const closingRef = useRef(false)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const onMailSurfaceChange = useCallback((open: boolean) => {
    setMailOpen(open)
    if (open) setOffset({ x: 0, y: 0 })
  }, [])
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; origX: number; origY: number } | null>(
    null,
  )

  useLayoutEffect(() => {
    const el = panelRef.current
    const anchor = rootRef.current
    if (!el || !anchor || prefersReducedMotion()) return
    const win = anchor.getBoundingClientRect()
    const from = origin ?? cardRect(threadId) ?? dockFallback(win)
    if (from.width < 2 || win.width < 2) return
    const anim = el.animate([boxFrame(from, '8px'), boxFrame(win, '12px')], {
      duration: OPEN_MS,
      easing: EASE_OUT,
      fill: 'both',
    })
    fadeSurface(surfaceRef.current, 'in', OPEN_MS)
    const release = () => {
      anim.onfinish = null
      anim.cancel()
    }
    anim.onfinish = release
    return () => anim.cancel()
    // Only on open; a new thread id remounts this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onDragPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      const target = event.target as HTMLElement | null
      if (target?.closest('button, a, input, textarea, [role="button"]')) return
      const el = rootRef.current
      if (!el) return
      // Drop the open morph so the panel sits in the anchor and drag can move it.
      panelRef.current?.getAnimations().forEach((anim) => anim.cancel())
      if (surfaceRef.current) {
        surfaceRef.current.getAnimations().forEach((anim) => anim.cancel())
        surfaceRef.current.style.opacity = ''
        surfaceRef.current.style.pointerEvents = ''
      }
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        origX: offset.x,
        origY: offset.y,
      }
      setDragging(true)
      event.currentTarget.setPointerCapture(event.pointerId)
      event.preventDefault()
    },
    [offset.x, offset.y],
  )

  const onDragPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      const el = rootRef.current
      if (!drag || drag.pointerId !== event.pointerId || !el) return
      setOffset(
        clampOffset(
          el,
          {
            x: drag.origX + (event.clientX - drag.startX),
            y: drag.origY + (event.clientY - drag.startY),
          },
          right,
          bottom,
        ),
      )
    },
    [right, bottom],
  )

  const endDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    setDragging(false)
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // already released
    }
  }, [])

  // Keep a dragged window on-screen when the viewport or stack anchor changes.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    setOffset((prev) => {
      if (prev.x === 0 && prev.y === 0) return prev
      const next = clampOffset(el, prev, right, bottom)
      return next.x === prev.x && next.y === prev.y ? prev : next
    })
  }, [right, bottom])

  /** Shrink the real window onto its card, then unmount. */
  const leaveThen = useCallback(
    (done: () => void) => {
      const el = panelRef.current
      if (closingRef.current) return
      closingRef.current = true
      playEarcon('panelClose')
      if (!el || prefersReducedMotion()) {
        done()
        return
      }
      const seen = el.getBoundingClientRect()
      el.style.pointerEvents = 'none'
      el.getAnimations().forEach((anim) => anim.cancel())
      const root = rootRef.current
      if (root) {
        root.style.transition = 'none'
        root.style.transform = 'none'
      }
      setOffset({ x: 0, y: 0 })
      const to = cardRect(threadId) ?? dockFallback(seen)
      fadeSurface(surfaceRef.current, 'out', CLOSE_MS)
      const anim = el.animate([boxFrame(seen, '12px'), boxFrame(to, '8px')], {
        duration: CLOSE_MS,
        easing: EASE_IN,
        fill: 'forwards',
      })
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        done()
      }
      anim.onfinish = finish
      anim.oncancel = finish
      window.setTimeout(finish, CLOSE_MS + 80)
    },
    [threadId],
  )

  const minimize = useCallback(() => leaveThen(onMinimize), [leaveThen, onMinimize])
  const close = useCallback(() => leaveThen(onClose), [leaveThen, onClose])

  useEffect(
    () =>
      onFloatingThreadCloseRequest((kind) => {
        if (kind === 'minimize') minimize()
        else leaveThen(() => closeFloatingThread({ sound: false }))
      }),
    [minimize, leaveThen],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const active = document.activeElement
      const inside = active && rootRef.current?.contains(active)
      if (!inside && active && active !== document.body) return
      // Let an open menu or dialog inside the window close first.
      if (document.querySelector('[role="dialog"][data-state="open"], [role="menu"]')) return
      minimize()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [minimize])

  const handleReply = useCallback(
    async (
      bodyText: string,
      action: 'send' | 'send_and_close' | 'send_and_pending',
      format?: 'email' | 'plain',
      attachments?: MessageAttachment[],
      snoozeMinutes?: number,
      extras?: ReplyExtras,
    ) => {
      await reply({
        bodyText,
        action,
        format,
        attachments,
        snoozeMinutes,
        cc: extras?.cc,
        bcc: extras?.bcc,
        channelAccountId: extras?.channelAccountId,
        to: extras?.to,
        mode: extras?.mode === 'new' ? undefined : extras?.mode,
        sourceMessageId: extras?.sourceMessageId,
        subject: extras?.subject,
        quotedHtml: extras?.quotedHtml,
        handback: extras?.handback,
        keepOpen: extras?.keepOpen,
      })
      void refresh(true)
    },
    [reply, refresh],
  )

  const title = card?.title || detail?.thread.emailSubject || detail?.thread.contactName || t('chatStack.untitled')
  const pinned = card?.pinned ?? pinnedIds.includes(threadId)
  const front = card?.faces.find((f) => f.working) ?? card?.faces[0] ?? null

  const style: CSSProperties = mailOpen
    ? {
        right: 16,
        bottom: 16,
        width: 'min(720px, calc(100vw - 32px))',
        height: 'min(860px, calc(100vh - 32px))',
        transformOrigin: 'bottom right',
        transition: dragging
          ? 'none'
          : 'width 380ms cubic-bezier(0.22, 1, 0.36, 1), height 380ms cubic-bezier(0.22, 1, 0.36, 1), right 380ms cubic-bezier(0.22, 1, 0.36, 1), bottom 380ms cubic-bezier(0.22, 1, 0.36, 1)',
      }
    : {
        right,
        bottom,
        width: 'min(420px, calc(100vw - 24px))',
        height: `min(720px, calc(100vh - ${bottom + 56}px))`,
        transformOrigin: 'bottom right',
        transform: offset.x || offset.y ? `translate(${offset.x}px, ${offset.y}px)` : undefined,
        transition: dragging
          ? 'none'
          : 'width 380ms cubic-bezier(0.22, 1, 0.36, 1), height 380ms cubic-bezier(0.22, 1, 0.36, 1), right 380ms cubic-bezier(0.22, 1, 0.36, 1), bottom 380ms cubic-bezier(0.22, 1, 0.36, 1), transform 380ms cubic-bezier(0.22, 1, 0.36, 1)',
      }

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={title}
      data-floating-thread={threadId}
      className="pointer-events-none fixed z-[60]"
      style={style}
    >
      <div
        ref={panelRef}
        className={cn(
          'pointer-events-auto absolute inset-0 flex flex-col overflow-hidden rounded-xl border bg-bg-elevated shadow-overlay',
          onCall ? 'border-ai shadow-[0_0_32px_rgb(var(--color-ai)/0.35)]' : 'border-border',
        )}
      >
      <div ref={surfaceRef} className="flex min-h-0 flex-1 flex-col">
      <div
        className={cn(
          'flex shrink-0 touch-none items-center gap-2 border-b border-border px-3 py-2 select-none',
          dragging ? 'cursor-grabbing' : 'cursor-grab',
        )}
        title={t('chatStack.move')}
        onPointerDown={onDragPointerDown}
        onPointerMove={onDragPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {front ? (
          <Avatar
            kind="agent"
            agent={{
              name: front.name,
              avatar_kind: front.avatarKind ?? front.kind,
              avatar_icon: front.avatarIcon,
              avatar_color: front.avatarColor,
              avatar_shape: front.avatarShape,
              avatar_image_url: front.avatarImageUrl,
            }}
            size={onCall ? 36 : 24}
            mode="live"
            motion={
              onCall ? (speaking ? 'talking' : userSpeaking ? 'listening' : 'idle') : front.working ? 'working' : 'idle'
            }
            decorative
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-text-heading">{title}</p>
          {card?.live ? (
            <p className="chat-stack-shimmer truncate text-2xs">
              {card.liveAgentName
                ? t('chatStack.working', { name: card.liveAgentName })
                : t('chatStack.workingFallback')}
            </p>
          ) : (
            <p className="truncate text-2xs text-text-muted">
              {pinned ? t('chatStack.pinned') : t('chatStack.following')}
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="iconSm"
          aria-label={t('chatStack.expand')}
          title={t('chatStack.expand')}
          onClick={onExpand}
        >
          <Maximize2 size={14} aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="iconSm"
          aria-label={t('chatStack.minimize')}
          title={`${t('chatStack.minimize')} (Esc)`}
          onClick={minimize}
        >
          <Minus size={14} aria-hidden />
        </Button>
        {!pinned ? (
          <Button
            type="button"
            variant="ghost"
            size="iconSm"
            aria-label={t('chatStack.dismiss')}
            title={t('chatStack.dismiss')}
            onClick={close}
          >
            <X size={14} aria-hidden />
          </Button>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <ThreadDetail
          chrome="floating"
          detail={detail && String(detail.thread.id) === threadId ? detail : null}
          loading={loading}
          error={error}
          threadId={threadId}
          saving={saving}
          unreadHighlightIds={unreadHighlightIds}
          onPatch={async (input) => {
            await patch(input)
          }}
          onReply={handleReply}
          onRetrySend={retryFailedSend}
          onNote={addNote}
          onUpdateNote={updateNote}
          onDeleteNote={deleteNote}
          onRefresh={refresh}
          hasOlder={hasOlder}
          loadingOlder={loadingOlder}
          onLoadOlder={hasOlder ? loadOlder : undefined}
          onChangeAiHandling={
            detail
              ? async (mode, opts) => {
                  await changeAiHandling(mode, opts)
                }
              : undefined
          }
          onDecisionResolved={() => void refresh(true)}
          mode="customer"
          canSendEmail={canSendEmail}
          mailboxNeedsSetup={mailboxNeedsSetup}
          onMailSurfaceChange={onMailSurfaceChange}
        />
      </div>
      </div>
      </div>
    </div>
  )
}
