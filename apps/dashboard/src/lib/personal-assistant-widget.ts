/**
 * Host bridge to the mounted `bokito-chat` element.
 *
 * The dashboard never renders its own chat surface for the personal helper:
 * anything that wants to open Bokito (the Messages rail, a Workspaces card,
 * the topbar Help button) hands the request to the one widget instance
 * mounted by `PersonalAssistantWidget`.
 */

import { isLocalHostname } from './host-routing'

/**
 * In-app Bokito helper is a dev-only surface: local Vite, loopback, and
 * `dev.app.bokito.ai`. Production (`app.bokito.ai` / tenant hosts) never
 * mounts the widget; Help goes to `/settings/help` instead.
 */
export function inAppAssistantEnabled(): boolean {
  if (typeof window === 'undefined') return false
  if (import.meta.env.DEV) return true
  const host = window.location.hostname.trim().toLowerCase()
  if (isLocalHostname(host)) return true
  if (host === 'dev.app.bokito.ai' || host.endsWith('.dev.app.bokito.ai')) return true
  return false
}

/**
 * The floating FAB is always hidden: open only via topbar Help / palette /
 * hub actions (`openAssistant`). Force-open still shows the panel. The chat
 * stack reads this too, so it does not reserve space for a launcher that is
 * never drawn.
 */
export function launcherHiddenFor(_pathname: string): boolean {
  return true
}

/**
 * A floating chat-stack thread takes the launcher's corner. While it is open
 * the launcher (and its panel) step aside; opening the helper again asks the
 * floating thread to minimize.
 */
let suppressed = false
const suppressListeners = new Set<() => void>()
const assistantOpenListeners = new Set<() => void>()

export function launcherSuppressed(): boolean {
  return suppressed
}

export function setLauncherSuppressed(next: boolean): void {
  if (suppressed === next) return
  suppressed = next
  if (next) mounted?.close?.()
  suppressListeners.forEach((fn) => fn())
}

export function onLauncherSuppressedChange(fn: () => void): () => void {
  suppressListeners.add(fn)
  return () => suppressListeners.delete(fn)
}

export function onAssistantOpen(fn: () => void): () => void {
  assistantOpenListeners.add(fn)
  return () => assistantOpenListeners.delete(fn)
}

function notifyAssistantOpen(): void {
  assistantOpenListeners.forEach((fn) => fn())
}

type BokitoChatElement = HTMLElement & {
  open?: () => void
  close?: () => void
  openThread?: (conversationId: string) => Promise<void> | void
  startThread?: () => Promise<void> | void
}

let mounted: BokitoChatElement | null = null
/** Open request that arrived before the custom element finished mounting. */
let pendingOpen = false

function showAndOpen(el: BokitoChatElement): void {
  // Communication may hide the host while a thread composer is on screen;
  // force-open from Help must still show the panel.
  notifyAssistantOpen()
  el.style.display = ''
  el.open?.()
}

export function registerAssistantWidget(element: HTMLElement | null): void {
  mounted = element as BokitoChatElement | null
  if (mounted && pendingOpen) {
    pendingOpen = false
    showAndOpen(mounted)
  }
}

/** Whether a widget is mounted and can take an open request right now. */
export function assistantWidgetReady(): boolean {
  return mounted != null
}

/** Viewport box of the floating helper launcher, or null when it is not shown. */
export function assistantLauncherRect(): DOMRect | null {
  const launcher = mounted?.shadowRoot?.querySelector<HTMLElement>('.bk-launcher')
  if (!launcher) return null
  const rect = launcher.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0 ? rect : null
}

/** Open the Bokito helper panel (works even when the FAB is hidden on Communication). */
export function openAssistant(): void {
  if (!mounted) {
    pendingOpen = true
    return
  }
  showAndOpen(mounted)
}

export function openAssistantThread(conversationId: string): void {
  if (!mounted) return
  notifyAssistantOpen()
  mounted.style.display = ''
  if (mounted.openThread) void mounted.openThread(conversationId)
  else mounted.open?.()
}

export function startAssistantThread(): void {
  if (!mounted) return
  notifyAssistantOpen()
  mounted.style.display = ''
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
