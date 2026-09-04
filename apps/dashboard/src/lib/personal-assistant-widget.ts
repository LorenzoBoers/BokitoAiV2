/**
 * Host bridge to the mounted `bokito-chat` element.
 *
 * The dashboard never renders its own chat surface for the personal helper:
 * anything that wants to open Bokito (the Messages rail, a Workspaces card)
 * hands the request to the one widget instance mounted by
 * `PersonalAssistantWidget`.
 */

type BokitoChatElement = HTMLElement & {
  open?: () => void
  openThread?: (conversationId: string) => Promise<void> | void
  startThread?: () => Promise<void> | void
}

let mounted: BokitoChatElement | null = null

export function registerAssistantWidget(element: HTMLElement | null): void {
  mounted = element as BokitoChatElement | null
}

/** Whether a widget is mounted and can take an open request right now. */
export function assistantWidgetReady(): boolean {
  return mounted != null
}

export function openAssistant(): void {
  mounted?.open?.()
}

export function openAssistantThread(conversationId: string): void {
  if (!mounted) return
  if (mounted.openThread) void mounted.openThread(conversationId)
  else mounted.open?.()
}

export function startAssistantThread(): void {
  if (!mounted) return
  if (mounted.startThread) void mounted.startThread()
  else mounted.open?.()
}

const PENDING_KEY = 'bokito-assistant-pending-thread'

/**
 * Ask for a thread that lives in another workspace.
 *
 * Switching workspaces reloads the app, so the request is parked until the
 * widget remounts inside the target workspace. It is scoped by workspace id
 * because a thread id only resolves in the workspace that owns it.
 */
export function requestAssistantThread(workspaceId: string, threadId: string): void {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ workspaceId, threadId }))
  } catch {
    // Private mode / storage disabled: the workspace switch still happens.
  }
}

/** Take the parked request if it belongs to this workspace. */
export function consumeAssistantThreadRequest(workspaceId: string): string | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { workspaceId?: string; threadId?: string }
    if (!parsed.threadId || parsed.workspaceId !== workspaceId) return null
    sessionStorage.removeItem(PENDING_KEY)
    return parsed.threadId
  } catch {
    return null
  }
}
