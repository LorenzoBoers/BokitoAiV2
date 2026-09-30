/** Tiny observable store for the access token. Persisted so reloads stay logged in. */
const KEY = 'bokito2.auth'

type Listener = () => void

type State = { token: string | null; tenantId: string | null }

function load(): State {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as State
  } catch {
    /* ignore */
  }
  return { token: null, tenantId: null }
}

class AuthStore {
  private state: State = load()
  private listeners = new Set<Listener>()

  get token() {
    return this.state.token
  }

  get tenantId() {
    return this.state.tenantId
  }

  setToken(token: string, tenantId: string | null) {
    this.state = { token, tenantId }
    localStorage.setItem(KEY, JSON.stringify(this.state))
    this.emit()
  }

  clear() {
    this.state = { token: null, tenantId: null }
    localStorage.removeItem(KEY)
    this.emit()
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }
}

export const authStore = new AuthStore()
