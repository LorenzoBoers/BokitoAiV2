import { CHAT_WIDGET_SCRIPT_PATH } from './api.config'

let loadPromise: Promise<void> | null = null

/**
 * Idempotently load the `bokito-chat` widget bundle so the custom element is
 * registered before the dashboard creates a `<bokito-chat>` node (preview).
 */
export function ensureChatWidgetScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (customElements.get('bokito-chat')) return Promise.resolve()
  if (loadPromise) return loadPromise

  loadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${CHAT_WIDGET_SCRIPT_PATH}"]`,
    )
    if (existing) {
      void customElements.whenDefined('bokito-chat').then(() => resolve())
      return
    }
    const script = document.createElement('script')
    script.src = CHAT_WIDGET_SCRIPT_PATH
    script.async = true
    script.onload = () => {
      void customElements.whenDefined('bokito-chat').then(() => resolve())
    }
    script.onerror = () => {
      loadPromise = null
      reject(new Error('Could not load the chat widget bundle.'))
    }
    document.head.appendChild(script)
  })
  return loadPromise
}
