/**
 * Bokito Chat Widget
 * Embed on any website:
 *   <script src="https://app.example.com/chat-widget/bokito-chat.js"
 *           data-bokito-chat-widget
 *           data-agent-slug="assistant"
 *           data-api-url="https://app.example.com"
 *           data-tenant="my-tenant"
 *           data-auth-mode="anonymous"
 *           defer></script>
 */
// @ts-nocheck — legacy monolith migrated to TS bundling; tighten types incrementally.
import { LIVECHAT_DEFAULT_HOST_AUTH_GROUP, apiGroupUrl, gatewayWebSocketUrl, livechatHttpUrl, normalizeLivechatApiBase } from './api/livechat-url'
import { livechatRoutes } from './api/livechat.routes'
import { applyBrandToHost, parseHexColor } from './brand'
import { ICONS, MONKEY_MARK } from './icons'
import {
  appendWorkLogEvent,
  collapseWorkLogStack,
  createWorkLogStackElement,
  isCustomerSafeLogEvent,
  parseWorkLogRealtimePayload,
} from './work-log-display'

/* ── Markdown renderer ──────────────────────────────────────── */
class MarkdownRenderer {
  static render(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/```[\s\S]*?```/g, m => { const code = m.slice(3,-3).replace(/^\w+\n/,''); return `<pre><code>${code}</code></pre>`; })
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/^[-*] (.+)/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`)
      .replace(/\n{2,}/g, '</p><p>')
      .replace(/^(.+)$/gm, m => m.startsWith('<') ? m : `<p>${m}</p>`)
      .replace(/<p><\/p>/g, '');
  }
}

/* ── PII filter ─────────────────────────────────────────────── */
class PIIFilter {
  static filter(text) {
    if (!text) return text;
    return text
      .replace(/\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Z|a-z]{2,}\b/g, '[email]')
      .replace(/\b(?:\d[ -]?){13,16}\b/g, '[card]')
      .replace(/\b\d{9}\b/g, '[id]')
      .replace(/\+?[\d\s\-().]{10,}/g, '[phone]');
  }
}

/* ── Time formatter ─────────────────────────────────────────── */
/** The API emits naive ISO timestamps in UTC (no Z suffix); normalize so the browser does not parse them as local time. */
function normalizeServerTimestamp(ts) {
  if (typeof ts === 'string' && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(ts.trim())) {
    return ts.trim().replace(' ', 'T') + 'Z';
  }
  return ts;
}

function formatTime(ts) {
  const d = new Date(normalizeServerTimestamp(ts)), now = new Date(), diff = now - d;
  if (!Number.isFinite(d.getTime())) return '';
  const m = Math.floor(diff/60000), h = Math.floor(diff/3600000), dy = Math.floor(diff/86400000);
  if (m < 1)  return 'now';
  if (m < 60) return `${m}m`;
  if (h < 24) return `${h}h`;
  if (dy < 7) return `${dy}d`;
  return d.toLocaleDateString(undefined, { day:'numeric', month:'short' });
}

const LIVECHAT_STREAM_SEGMENT = /^[a-zA-Z0-9_-]{1,64}$/;
function livechatStreamSegment(raw, fallback) {
  const s = typeof raw === 'string' ? raw.trim() : '';
  return LIVECHAT_STREAM_SEGMENT.test(s) ? s : fallback;
}

function resolveTenantSubdomainFromHost() {
  if (typeof window === 'undefined') return null;
  const hostname = String(window.location?.hostname || '').trim().toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) return null;
  const parts = hostname.split('.').filter(Boolean);
  if (parts.length < 3) return null;
  const subdomain = parts[0] || '';
  if (!subdomain || subdomain === 'www' || subdomain === 'app') return null;
  return subdomain;
}

const LS_THEME_KEY = 'bokito_theme';
const LS_SOUND_EFFECTS_KEY = 'bokito_sound_effects';
const LS_SOUND_NOTIFICATIONS_KEY = 'bokito_sound_notifications';
const LS_CUSTOMER_ID_KEY = 'bokito_customer_id';
const LS_VISITOR_IDENTITY_KEY = 'bokito_visitor_identity';
const LS_HIDDEN_CONVERSATIONS_KEY = 'bokito_hidden_conversations';
const LS_AUTH_TOKEN_KEY = 'bokito_auth_token';
const LS_PREFERENCES_CACHE_KEY = 'bokito_user_preferences_cache';
const LS_WIDGET_POSITION_KEY = 'bokito_widget_pos';
const LS_CSAT_RATED_KEY = 'bokito_csat_rated';
const WIDGET_BASE_MARGIN = 20;
const WIDGET_DRAG_THRESHOLD = 6;

function readCookieValue(cookieName = '') {
  const name = String(cookieName || '').trim();
  if (!name || typeof document === 'undefined') return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1] || null;
  }
}

/* ── API client ─────────────────────────────────────────────── */
class ApiClient {
  #baseUrl; #token = null; #agentSlug; #onSessionExpired; #stateMachine; #identityTokenGetter;
  #hostAuthTokenGetter; #authModeGetter; #authCookieNameGetter; #customerIdGetter; #tenantSubdomainGetter;

  constructor({
    baseUrl,
    agentSlug,
    stateMachine,
    onSessionExpired,
    identityTokenGetter,
    hostAuthTokenGetter,
    authModeGetter,
    authCookieNameGetter,
    customerIdGetter,
    tenantSubdomainGetter,
  }) {
    this.#baseUrl = normalizeLivechatApiBase(baseUrl);
    this.#agentSlug = agentSlug;
    this.#stateMachine = stateMachine;
    this.#onSessionExpired = onSessionExpired;
    this.#identityTokenGetter = identityTokenGetter;
    this.#hostAuthTokenGetter = hostAuthTokenGetter;
    this.#authModeGetter = authModeGetter;
    this.#authCookieNameGetter = authCookieNameGetter;
    this.#tenantSubdomainGetter = tenantSubdomainGetter;
    this.#customerIdGetter =
      typeof customerIdGetter === 'function' ? customerIdGetter : () => localStorage.getItem(LS_CUSTOMER_ID_KEY);
  }

  setToken(t) { this.#token = t; }

  #authHeaders(extra = {}) {
    return {
      'Content-Type': 'application/json',
      ...(this.#token ? { 'Authorization': `Bearer ${this.#token}` } : {}),
      ...extra,
    };
  }

  async #refreshSession() {
    try {
      const cid = this.#customerIdGetter();
      const identityToken = this.#identityTokenGetter?.();
      const hostAuthToken = this.#hostAuthTokenGetter?.();
      const authMode = this.#authModeGetter?.();
      const authCookieName = this.#authCookieNameGetter?.();
      const tenantSubdomain = this.#tenantSubdomainGetter?.() || resolveTenantSubdomainFromHost();
      const body = { agent_slug: this.#agentSlug, customer_id: cid };
      if (identityToken) body.identity_token = identityToken;
      if (hostAuthToken) body.host_auth_token = hostAuthToken;
      if (authMode) body.auth_mode = authMode;
      if (authCookieName) body.auth_cookie_name = authCookieName;
      if (tenantSubdomain) body.tenant_subdomain = tenantSubdomain;
      const r = await fetch(livechatHttpUrl(this.#baseUrl, livechatRoutes.session.start), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) return false;
      const d = await r.json();
      this.#token = d.session_token;
      if (this.#onSessionExpired) this.#onSessionExpired(d);
      return true;
    } catch { return false; }
  }

  async request(path, opts = {}) {
    const url = livechatHttpUrl(this.#baseUrl, path);
    const o = { ...opts, headers: this.#authHeaders(opts.headers) };
    let r = await fetch(url, o);
    if (r.status === 401) {
      const ok = await this.#refreshSession();
      if (!ok) { this.#stateMachine.transition('error'); return null; }
      o.headers = this.#authHeaders(opts.headers);
      r = await fetch(url, o);
    }
    return r;
  }

  async #logErrorResponse(method, path, r) {
    let body = null;
    try { body = await r.clone().json(); } catch { try { body = await r.clone().text(); } catch {} }
    console.error(
      `%c[Bokito API] ${method} /${path} → ${r.status}`,
      'color:#EF4444;font-weight:bold',
      '\nResponse body:', body,
      '\nURL:', livechatHttpUrl(this.#baseUrl, path),
    );
    return body;
  }

  async get(path) {
    // Token travels via the Authorization header only; never in the query
    // string, where it would leak into server access logs.
    const r = await this.request(path, { method: 'GET' });
    if (!r?.ok) { await this.#logErrorResponse('GET', path, r); return null; }
    return r.json();
  }

  async post(p, b) {
    const body = this.#token ? { ...b, session_token: this.#token } : b;
    const r = await this.request(p, { method: 'POST', body: JSON.stringify(body) });
    if (!r?.ok) {
      const errBody = await this.#logErrorResponse('POST', p, r);
      const msg = errBody?.message || errBody?.value || errBody?.error || `HTTP ${r?.status}`;
      const err = new Error(msg);
      err.statusCode = r?.status;
      err.errorName  = errBody?.name  || errBody?.code || 'ApiError';
      err.detail     = errBody;
      throw err;
    }
    return r.json();
  }

  async patch(p, b) {
    const body = this.#token ? { ...b, session_token: this.#token } : b;
    const r = await this.request(p, { method: 'PATCH', body: JSON.stringify(body) });
    if (!r?.ok) { await this.#logErrorResponse('PATCH', p, r); return null; }
    return r.json();
  }
}

/* ── Realtime client (gateway WebSocket protocol) ───────────── */
class RealtimeClient {
  #url; #topics; #token; #onEvent; #socket = null;
  #reconnectAttempts = 0; #maxReconnectDelay = 30000; #reconnectTimer = null; #onReconnect;

  constructor({ url, topics, token, onEvent, onReconnect }) {
    this.#url = url; this.#topics = topics; this.#token = token;
    this.#onEvent = onEvent; this.#onReconnect = onReconnect;
  }

  connect() {
    try {
      const params = new URLSearchParams({ device: 'widget' });
      if (this.#token) params.set('access_token', this.#token);
      this.#socket = new WebSocket(`${this.#url}?${params}`);
      this.#socket.onmessage = e => {
        try {
          const frame = JSON.parse(e.data);
          if (frame?.type === 'event') this.#onEvent(frame);
        } catch {}
      };
      this.#socket.onopen = () => {
        const w = this.#reconnectAttempts > 0;
        this.#reconnectAttempts = 0;
        this.#socket?.send(JSON.stringify({ type: 'sub', topics: this.#topics }));
        if (w && this.#onReconnect) this.#onReconnect();
      };
      this.#socket.onclose = () => this.#scheduleReconnect();
      this.#socket.onerror = () => this.#socket?.close();
    } catch { this.#scheduleReconnect(); }
  }

  #scheduleReconnect() {
    const d = Math.min(1000 * Math.pow(2, this.#reconnectAttempts), this.#maxReconnectDelay);
    this.#reconnectAttempts++;
    clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = setTimeout(() => this.connect(), d);
  }

  disconnect() {
    clearTimeout(this.#reconnectTimer);
    this.#socket?.close();
    this.#socket = null;
  }
}

/**
 * Map a gateway `message` event frame onto the legacy widget realtime shape
 * (`{ event_type, object }`) so the existing render pipeline keeps working.
 */
function gatewayFrameToWidgetEvent(frame) {
  if (frame?.event !== 'message') return null;
  const m = frame.data?.message || {};
  // AI assistant reply.
  if (m.role === 'assistant') {
    return {
      event_type: 'message',
      object: {
        id: m.id,
        sender_type: 'ai',
        status: 'sent',
        message_content: m.body_text || '',
        created_at: m.created_at,
      },
    };
  }
  // Human takeover: a staff operator replied from the dashboard. Such messages
  // are outbound with role "user"; render them as a human agent bubble. The
  // visitor's own (inbound) messages are ignored to avoid echoing.
  if (m.direction === 'outbound' && m.role === 'user') {
    return {
      event_type: 'message',
      object: {
        id: m.id,
        sender_type: 'agent',
        status: 'sent',
        message_content: m.body_text || '',
        created_at: m.created_at,
      },
    };
  }
  return null;
}

/* ── Page context manager ───────────────────────────────────── */
class PageContextManager {
  #conversationId = null; #apiClient; #debounceTimer = null;

  constructor(apiClient) {
    this.#apiClient = apiClient;
    window.addEventListener('chatContextUpdate', () => this.#pushContext());
    window.addEventListener('popstate', () => this.#pushContext());
  }

  setConversationId(id) { this.#conversationId = id; this.#pushContext(); }

  getMessageSnapshot() {
    const ctx = window.chatContext || {};
    return { url: window.location.href, title: document.title, chat_context: PIIFilter.filter(JSON.stringify(ctx)) };
  }

  getFullSnapshot() {
    return this.#buildFullContext();
  }

  async #pushContext() {
    if (!this.#conversationId) return;
    clearTimeout(this.#debounceTimer);
    this.#debounceTimer = setTimeout(async () => {
      const ctx = this.#buildFullContext();
      await this.#apiClient.patch(`conversation/${this.#conversationId}/context`, { page_context: ctx });
    }, 800);
  }

  #buildFullContext() {
    const structured = window.chatContext || null;
    const headings = Array.from(document.querySelectorAll('h1,h2,h3'))
      .slice(0, 10).map(h => ({ level: h.tagName, text: h.textContent.trim().slice(0, 120) }));
    const bodyClone = document.body.cloneNode(true);
    bodyClone.querySelectorAll('script,style,nav,footer,aside,input,textarea').forEach(el => el.remove());
    const rawText = bodyClone.innerText || bodyClone.textContent || '';
    return {
      url: window.location.href, title: document.title, headings,
      structured_data: structured,
      text: PIIFilter.filter(rawText.trim().replace(/\s+/g, ' ').slice(0, 3000)),
    };
  }
}

/* ── Idle watcher (proactive suggestions) ──────────────────── */
class IdleWatcher {
  #timer = null; #callback; #idleMs; #maxTriggers; #paused = false;
  #sessionKey = 'bokito_proactive_count';
  #events = ['mousemove', 'keydown', 'scroll', 'click', 'touchstart', 'pointerdown'];
  #boundReset;

  constructor(callback, { idleMs = 3000, maxTriggers = 3 } = {}) {
    this.#callback = callback;
    this.#idleMs = idleMs;
    this.#maxTriggers = maxTriggers;
    this.#boundReset = this.#resetTimer.bind(this);
  }

  get #count() { return parseInt(sessionStorage.getItem(this.#sessionKey) || '0', 10); }
  set #count(v) { sessionStorage.setItem(this.#sessionKey, String(v)); }

  get exhausted() { return this.#count >= this.#maxTriggers; }

  start() {
    if (this.exhausted) return;
    this.#events.forEach(e => document.addEventListener(e, this.#boundReset, { passive: true }));
    this.#resetTimer();
  }

  pause() { this.#paused = true; clearTimeout(this.#timer); }

  resume() {
    if (this.exhausted) return;
    this.#paused = false;
    this.#resetTimer();
  }

  stop() {
    clearTimeout(this.#timer);
    this.#events.forEach(e => document.removeEventListener(e, this.#boundReset));
  }

  #resetTimer() {
    clearTimeout(this.#timer);
    if (this.#paused || this.exhausted) return;
    this.#timer = setTimeout(() => this.#onIdle(), this.#idleMs);
  }

  #onIdle() {
    if (this.#paused || this.exhausted) return;
    this.#count = this.#count + 1;
    this.#callback();
    if (!this.exhausted) this.#resetTimer();
  }
}

/* ── State machine ──────────────────────────────────────────── */
class StateMachine {
  #state = 'idle'; #listeners = new Map();
  #validTransitions = {
    idle:           ['home', 'login_required'],
    home:           ['idle', 'connecting', 'active', 'login_required'],
    connecting:     ['active', 'error', 'idle'],
    active:         ['home', 'processing', 'agent_mode', 'error', 'idle'],
    processing:     ['active', 'agent_mode', 'error', 'idle'],
    agent_mode:     ['home', 'active', 'idle'],
    history:        ['home', 'active', 'idle'],
    error:          ['home', 'idle'],
    login_required: ['home', 'idle'],
  };

  get state() { return this.#state; }

  transition(next, data) {
    const allowed = this.#validTransitions[this.#state];
    if (!allowed?.includes(next)) return false;
    const prev = this.#state; this.#state = next;
    this.#listeners.get('*')?.forEach(fn => fn(next, prev, data));
    this.#listeners.get(next)?.forEach(fn => fn(next, prev, data));
    return true;
  }

  on(s, fn) {
    if (!this.#listeners.has(s)) this.#listeners.set(s, []);
    this.#listeners.get(s).push(fn);
  }
}

/* ── Widget CSS (inlined — Shadow DOM scoped) ───────────────── */
const WIDGET_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Jaro:opsz@6&family=JetBrains+Mono:wght@400;500;700&family=Montserrat:ital,wght@0,300..700;1,300..700&display=swap');
:host {
  --bk-brand:         #00D986;
  --bk-primary:       var(--bk-brand);
  --bk-primary-dark:  color-mix(in srgb, var(--bk-brand) 86%, #000);
  --bk-primary-light: color-mix(in srgb, var(--bk-brand) 14%, transparent);
  --bk-on-primary:    #0f172a;
  --bk-text:          #161022;
  --bk-text-muted:    #5B5870;
  --bk-text-inverse:  #FFFFFF;
  --bk-bg:            #F7F8FA;
  --bk-bg-surface:    #FFFFFF;
  --bk-bg-hover:      #F1F3F6;
  --bk-border:        #E2E6EC;
  --bk-border-light:  #EEF1F5;
  --bk-header-bg:     linear-gradient(180deg, color-mix(in srgb, var(--bk-brand) 18%, var(--bk-bg)) 0%, var(--bk-bg) 100%);
  --bk-header-text:   #FFFFFF;
  --bk-shadow-sm:     0 1px 3px rgba(17,24,39,.08),0 1px 2px rgba(17,24,39,.06);
  --bk-shadow:        0 8px 20px rgba(12,18,32,.12),0 2px 8px rgba(12,18,32,.06);
  --bk-shadow-lg:     0 24px 64px rgba(12,18,32,.18),0 8px 20px rgba(12,18,32,.08);
  --bk-glow:          0 0 28px color-mix(in srgb, var(--bk-primary) 32%, transparent);
  --bk-launcher-bg:   color-mix(in srgb, var(--bk-bg-surface) 88%, var(--bk-primary) 12%);
  --bk-launcher-icon: var(--bk-primary);
  --bk-launcher-shadow: 0 8px 28px color-mix(in srgb, var(--bk-primary) 22%, rgba(2,6,23,.1)), 0 2px 8px rgba(2,6,23,.06);
  --bk-launcher-shadow-hover: 0 14px 38px color-mix(in srgb, var(--bk-primary) 32%, rgba(2,6,23,.12)), 0 4px 12px rgba(2,6,23,.08);
  --bk-radius:        16px;
  --bk-radius-sm:     8px;
  --bk-radius-full:   100px;
  --bk-font:          'Montserrat',-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
  --bk-font-display:  'Jaro','Montserrat',sans-serif;
  --bk-font-mono:     'JetBrains Mono','SF Mono','Consolas',monospace;
  --bk-transition:    0.2s cubic-bezier(0.4,0,0.2,1);
  --bk-spring:        0.4s cubic-bezier(0.175,0.885,0.32,1.275);
  --bk-launcher-transition: 0.28s cubic-bezier(0.22,1,0.36,1);
  --bk-z-widget:      2147483647;
  --bk-bubble-size:   58px;
  --bk-window-w:      min(400px,calc(100vw - 32px));
  --bk-window-h:      min(640px,calc(100vh - 80px));
  --bk-atmosphere-height: min(56%, 380px);
  --bk-atmosphere-min-height: 260px;
  --bk-launcher-ring: color-mix(in srgb, var(--bk-primary) 34%, transparent);
  --bk-launcher-close-color: #fff;
}
@media (prefers-color-scheme:dark){:host{--bk-text:#B5BAC8;--bk-text-muted:#82879A;--bk-bg:#10131A;--bk-bg-surface:#1D2130;--bk-bg-hover:#252A3A;--bk-border:#2C314A;--bk-border-light:#353B53;--bk-popover:#161A26;--bk-header-bg:linear-gradient(180deg,color-mix(in srgb,var(--bk-brand) 22%,#14171F) 0%,#14171F 100%);--bk-header-text:#F4F7FB;--bk-window-glow:radial-gradient(135% 78% at 50% 30%,color-mix(in srgb,var(--bk-primary) 8.5%,transparent) 0%,color-mix(in srgb,var(--bk-primary) 3.2%,transparent) 44%,transparent 72%);--bk-shadow:0 8px 20px rgba(0,0,0,.45),0 2px 8px rgba(0,0,0,.25);--bk-shadow-lg:0 24px 64px rgba(0,0,0,.6),0 8px 20px rgba(0,0,0,.35);--bk-launcher-bg:color-mix(in srgb,var(--bk-bg) 76%,var(--bk-primary) 24%);--bk-launcher-icon:var(--bk-primary);--bk-launcher-shadow:0 8px 24px color-mix(in srgb,var(--bk-primary) 28%,transparent),inset 0 -10px 20px color-mix(in srgb,var(--bk-primary) 42%,#030508);--bk-launcher-shadow-hover:0 14px 34px color-mix(in srgb,var(--bk-primary) 42%,transparent),inset 0 -12px 24px color-mix(in srgb,var(--bk-primary) 52%,#030508),0 0 44px color-mix(in srgb,var(--bk-primary) 38%,transparent);--bk-launcher-ring:color-mix(in srgb,var(--bk-primary) 42%,transparent);--bk-launcher-close-color:#fff;}:host .bk-record-cancel{background:#252A3A;color:#B5BAC8;}:host .bk-record-cancel:hover{background:#2F354A;}}
:host([data-theme="light"]){--bk-text:#161022;--bk-text-muted:#5B5870;--bk-bg:#F7F8FA;--bk-bg-surface:#FFFFFF;--bk-bg-hover:#F1F3F6;--bk-border:#E2E6EC;--bk-border-light:#EEF1F5;--bk-popover:#FFFFFF;--bk-header-bg:linear-gradient(180deg,color-mix(in srgb,var(--bk-brand) 16%,#14171F) 0%,#14171F 100%);--bk-header-text:#F4F7FB;--bk-window-glow:none;--bk-launcher-bg:color-mix(in srgb,var(--bk-bg-surface) 90%,var(--bk-primary) 10%);--bk-launcher-icon:var(--bk-primary);--bk-launcher-ring:color-mix(in srgb,var(--bk-primary) 45%,var(--bk-border));--bk-launcher-shadow:0 8px 28px color-mix(in srgb,var(--bk-primary) 22%,rgba(2,6,23,.1)),0 2px 8px rgba(2,6,23,.06);--bk-launcher-shadow-hover:0 14px 38px color-mix(in srgb,var(--bk-primary) 32%,rgba(2,6,23,.14)),0 4px 12px rgba(2,6,23,.08);--bk-launcher-close-color:var(--bk-text);}
:host([data-theme="dark"]){--bk-text:#B5BAC8;--bk-text-muted:#82879A;--bk-bg:#10131A;--bk-bg-surface:#1D2130;--bk-bg-hover:#252A3A;--bk-border:#2C314A;--bk-border-light:#353B53;--bk-popover:#161A26;--bk-header-bg:linear-gradient(180deg,color-mix(in srgb,var(--bk-brand) 22%,#14171F) 0%,#14171F 100%);--bk-header-text:#F4F7FB;--bk-window-glow:radial-gradient(135% 78% at 50% 30%,color-mix(in srgb,var(--bk-primary) 8.5%,transparent) 0%,color-mix(in srgb,var(--bk-primary) 3.2%,transparent) 44%,transparent 72%);--bk-launcher-bg:color-mix(in srgb,var(--bk-bg) 76%,var(--bk-primary) 24%);--bk-launcher-icon:var(--bk-primary);--bk-launcher-shadow:0 8px 24px color-mix(in srgb,var(--bk-primary) 28%,transparent),inset 0 -10px 20px color-mix(in srgb,var(--bk-primary) 42%,#030508);--bk-launcher-shadow-hover:0 14px 34px color-mix(in srgb,var(--bk-primary) 42%,transparent),inset 0 -12px 24px color-mix(in srgb,var(--bk-primary) 52%,#030508),0 0 44px color-mix(in srgb,var(--bk-primary) 38%,transparent);--bk-launcher-ring:color-mix(in srgb,var(--bk-primary) 42%,transparent);--bk-launcher-close-color:#fff;}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
@keyframes bk-spring-in{0%{transform:scale(.6) translateY(20px);opacity:0}60%{transform:scale(1.04) translateY(-4px);opacity:1}100%{transform:scale(1) translateY(0);opacity:1}}
@keyframes bk-slide-up{from{transform:translateY(16px);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes bk-slide-down{from{transform:translateY(-10px);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes bk-fade-in{from{opacity:0}to{opacity:1}}
@keyframes bk-pop-in{0%{transform:scale(.85);opacity:0}100%{transform:scale(1);opacity:1}}
@keyframes bk-window-in{0%{transform:scale(.82) translateY(16px);opacity:0}100%{transform:scale(1) translateY(0);opacity:1}}
@keyframes bk-window-out{0%{transform:scale(1) translateY(0);opacity:1}100%{transform:scale(.9) translateY(10px);opacity:0}}
@keyframes bk-thinking-pulse{0%,80%,100%{transform:scale(.6);opacity:.4}40%{transform:scale(1);opacity:1}}
@keyframes bk-tool-stagger{0%{transform:translateX(-12px);opacity:0}100%{transform:translateX(0);opacity:1}}
@keyframes bk-spin{to{transform:rotate(360deg)}}
@keyframes bk-scale-in{from{transform:scale(0)}to{transform:scale(1)}}
@keyframes bk-blink{0%,100%{opacity:1}50%{opacity:0}}
@keyframes bk-header-in{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@media (prefers-reduced-motion:reduce){.bk-launcher.is-open~.bk-window .bk-header>*,.bk-launcher.is-open~.bk-window .bk-home-tab[data-tab="home"]:not([hidden]) .bk-home-hero-title,.bk-launcher.is-open~.bk-window .bk-home-tab[data-tab="home"]:not([hidden]) .bk-home-hero-sub,.bk-launcher.is-open~.bk-window .bk-home-tab[data-tab="home"]:not([hidden]) .bk-home-new-btn,:host([data-preview-mode="true"]) .bk-window .bk-header>*,:host([data-preview-mode="true"]) .bk-window .bk-home-tab[data-tab="home"]:not([hidden]) .bk-home-hero-title,:host([data-preview-mode="true"]) .bk-window .bk-home-tab[data-tab="home"]:not([hidden]) .bk-home-hero-sub,:host([data-preview-mode="true"]) .bk-window .bk-home-tab[data-tab="home"]:not([hidden]) .bk-home-new-btn,.bk-msg,.bk-thinking{animation:none!important;}}
.bk-launcher{position:fixed;bottom:20px;right:20px;width:var(--bk-bubble-size);height:var(--bk-bubble-size);border-radius:var(--bk-radius-full);background:var(--bk-launcher-bg);border:2px solid var(--bk-launcher-ring);cursor:grab;box-shadow:var(--bk-launcher-shadow),var(--bk-shadow-lg);display:flex;align-items:center;justify-content:center;transition:transform var(--bk-launcher-transition),box-shadow var(--bk-launcher-transition);z-index:var(--bk-z-widget);animation:bk-spring-in .5s var(--bk-spring);will-change:transform;outline:none;touch-action:none;user-select:none;-webkit-user-select:none;}
.bk-launcher:hover{transform:scale(1.06);box-shadow:var(--bk-launcher-shadow-hover);}
.bk-launcher:active{transform:scale(1.01);cursor:grabbing;}
.bk-launcher.is-dragging{transition:none;cursor:grabbing;transform:scale(1.04);}
.bk-launcher.is-dragging:hover{transform:scale(1.04);}
.bk-launcher-icon{width:30px;height:30px;color:var(--bk-launcher-icon);transition:transform var(--bk-transition),opacity var(--bk-transition);}
.bk-launcher-icon--monkey{width:34px;height:34px;transform:translateY(0.5px);}
.bk-launcher-icon--close{color:var(--bk-launcher-close-color,#fff);position:absolute;transform:scale(0) rotate(-90deg);opacity:0;}
.bk-launcher.is-open .bk-launcher-icon--chat{transform:scale(0) rotate(90deg);opacity:0;}
.bk-launcher.is-open .bk-launcher-icon--close{transform:scale(1) rotate(0);opacity:1;}
.bk-proactive-bubbles{position:fixed;bottom:14px;right:calc(20px + var(--bk-bubble-size) + 10px);display:flex;flex-direction:column;align-items:flex-end;gap:8px;z-index:var(--bk-z-widget);pointer-events:none;}
.bk-proactive-bubble{pointer-events:auto;max-width:260px;padding:10px 16px;background:var(--bk-bg-surface);border:1px solid var(--bk-border);border-radius:16px 16px 4px 16px;box-shadow:var(--bk-shadow);font-family:var(--bk-font);font-size:13.5px;line-height:1.4;color:var(--bk-text);cursor:pointer;transition:background .15s,color .15s,transform .15s;animation:bk-bubble-pop .35s cubic-bezier(.2,.8,.2,1) both;-webkit-appearance:none;appearance:none;text-align:left;}
.bk-proactive-bubble:nth-child(2){animation-delay:.1s;}
.bk-proactive-bubble:nth-child(3){animation-delay:.2s;}
.bk-proactive-bubble:hover{background:var(--bk-primary);color:var(--bk-text-inverse);transform:translateY(-1px);box-shadow:var(--bk-shadow-lg);}
.bk-proactive-bubble:active{transform:scale(.97);}
.bk-proactive-bubbles.is-dismissing .bk-proactive-bubble{animation:bk-bubble-out .2s ease both;}
.bk-proactive-bubbles.is-dismissing .bk-proactive-bubble:nth-child(2){animation-delay:.05s;}
.bk-proactive-bubbles.is-dismissing .bk-proactive-bubble:nth-child(3){animation-delay:.1s;}
@keyframes bk-bubble-pop{from{opacity:0;transform:translateY(12px) scale(.92);}to{opacity:1;transform:translateY(0) scale(1);}}
@keyframes bk-bubble-out{from{opacity:1;transform:translateY(0) scale(1);}to{opacity:0;transform:translateY(6px) scale(.95);}}
@media (max-width:480px){.bk-proactive-bubbles{right:calc(20px + var(--bk-bubble-size) + 8px);bottom:10px;max-width:calc(100vw - var(--bk-bubble-size) - 46px);}.bk-window{border-radius:0;}.bk-window::before{border-radius:0;}}
.bk-badge{position:absolute;top:-4px;right:-4px;min-width:20px;height:20px;padding:0 4px;border-radius:var(--bk-radius-full);background:#EF4444;color:white;font-size:11px;font-weight:700;font-family:var(--bk-font);display:flex;align-items:center;justify-content:center;animation:bk-scale-in .2s var(--bk-spring);box-sizing:border-box;}
.bk-window{position:fixed;bottom:calc(var(--bk-bubble-size) + 24px);right:20px;width:var(--bk-window-w);height:var(--bk-window-h);background:var(--bk-bg);border-radius:24px;box-shadow:0 16px 48px rgba(0,0,0,.34),0 6px 20px rgba(0,0,0,.2),0 0 1px rgba(255,255,255,.04);display:flex;flex-direction:column;overflow:hidden;z-index:calc(var(--bk-z-widget) - 1);border:none;font-family:var(--bk-font);transform-origin:bottom right;will-change:transform,opacity;isolation:isolate;}
.bk-window::before{content:'';position:absolute;left:0;right:0;top:0;height:var(--bk-atmosphere-height,min(56%,380px));min-height:var(--bk-atmosphere-min-height,260px);pointer-events:none;z-index:0;border-radius:24px 24px 0 0;background:var(--bk-window-atmosphere-bg,radial-gradient(118% 95% at 50% -12%,color-mix(in srgb,var(--bk-primary) 18%,transparent) 0%,color-mix(in srgb,var(--bk-primary) 6%,transparent) 42%,transparent 68%),linear-gradient(180deg,color-mix(in srgb,var(--bk-primary) 14%,var(--bk-bg)) 0%,color-mix(in srgb,var(--bk-primary) 5%,var(--bk-bg)) 46%,transparent 88%));}
.bk-window.is-opening{animation:bk-window-in .22s cubic-bezier(.2,.8,.2,1) both;}
.bk-window.is-closing{animation:bk-window-out .18s cubic-bezier(.4,0,1,1) both;pointer-events:none;}
.bk-window[hidden]{display:none;}
[hidden]{display:none!important;}
.bk-header{display:flex;align-items:center;gap:12px;padding:18px 20px 20px;background:transparent;color:var(--bk-header-text);flex-shrink:0;position:relative;z-index:25;}
.bk-launcher.is-open~.bk-window .bk-header>*{animation:bk-header-in .52s cubic-bezier(.22,1,.36,1) both;}
.bk-launcher.is-open~.bk-window .bk-header>.bk-btn-back{animation-delay:.04s;}
.bk-launcher.is-open~.bk-window .bk-header>.bk-header-avatar{animation-delay:.09s;}
.bk-launcher.is-open~.bk-window .bk-header>.bk-header-info{animation-delay:.14s;}
.bk-launcher.is-open~.bk-window .bk-header>.bk-header-actions{animation-delay:.19s;}
.bk-header>.bk-btn-back{flex-shrink:0;}
.bk-header-avatar{width:36px;height:36px;border-radius:var(--bk-radius-full);background:var(--bk-bg-surface);border:1px solid var(--bk-border-light);box-shadow:0 1px 2px rgba(2,6,23,.06);display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;flex-shrink:0;}
@media (prefers-color-scheme:dark){:host:not([data-theme="light"]) .bk-header-avatar{background:color-mix(in srgb,var(--bk-primary) 8%,transparent);border:1px solid color-mix(in srgb,var(--bk-primary) 22%,transparent);box-shadow:0 4px 12px color-mix(in srgb,var(--bk-primary) 22%,transparent),inset 0 -8px 20px color-mix(in srgb,var(--bk-primary) 32%,var(--bk-bg));}}
:host([data-theme="dark"]) .bk-header-avatar{background:color-mix(in srgb,var(--bk-primary) 8%,transparent);border:1px solid color-mix(in srgb,var(--bk-primary) 22%,transparent);box-shadow:0 4px 12px color-mix(in srgb,var(--bk-primary) 22%,transparent),inset 0 -8px 20px color-mix(in srgb,var(--bk-primary) 32%,var(--bk-bg));}
:host([data-theme="light"]) .bk-header-avatar{background:var(--bk-bg-surface);border:1px solid var(--bk-border-light);box-shadow:0 1px 2px rgba(2,6,23,.06);}
.bk-header-avatar .bk-avatar-logo{width:22px;height:22px;color:var(--bk-primary);}
.bk-header-avatar-img{width:22px;height:22px;object-fit:contain;display:block;border-radius:4px;}
:host([data-preview-mode="true"]){position:relative;display:block;width:100%;height:100%;min-height:0;min-width:0;max-width:none;margin:0;--bk-z-widget:50;--bk-window-w:100%;--bk-window-h:100%;}
:host([data-preview-mode="true"]) .bk-launcher{display:none!important;}
:host([data-preview-mode="true"]) .bk-proactive-bubbles{display:none!important;}
:host([data-preview-mode="true"]) .bk-window{position:relative!important;inset:auto!important;top:auto!important;right:auto!important;bottom:auto!important;left:auto!important;width:100%!important;height:100%!important;max-width:100%;max-height:100%;flex-shrink:0;border-radius:24px;z-index:51;transform-origin:center center;box-shadow:0 12px 36px rgba(0,0,0,.26),0 4px 14px rgba(0,0,0,.16),0 0 1px rgba(255,255,255,.05)!important;}
:host([data-preview-mode="true"]) .bk-window::before{border-radius:24px 24px 0 0;}
:host([data-preview-mode="true"]) .bk-window .bk-header>*{animation:bk-header-in .52s cubic-bezier(.22,1,.36,1) both;}
:host([data-preview-mode="true"]) .bk-window .bk-header>.bk-btn-back{animation-delay:.04s;}
:host([data-preview-mode="true"]) .bk-window .bk-header>.bk-header-avatar{animation-delay:.09s;}
:host([data-preview-mode="true"]) .bk-window .bk-header>.bk-header-info{animation-delay:.14s;}
:host([data-preview-mode="true"]) .bk-window .bk-header>.bk-header-actions{animation-delay:.19s;}
:host([data-preview-mode="true"]) .bk-window .bk-home-tab[data-tab="home"]:not([hidden]) .bk-home-hero-title,:host([data-preview-mode="true"]) .bk-window .bk-home-tab[data-tab="home"]:not([hidden]) .bk-home-hero-sub,:host([data-preview-mode="true"]) .bk-window .bk-home-tab[data-tab="home"]:not([hidden]) .bk-home-new-btn{animation:bk-header-in .55s cubic-bezier(.22,1,.36,1) both;}
:host([data-preview-mode="true"]) .bk-window .bk-home-tab[data-tab="home"]:not([hidden]) .bk-home-hero-title{animation-delay:.24s;}
:host([data-preview-mode="true"]) .bk-window .bk-home-tab[data-tab="home"]:not([hidden]) .bk-home-hero-sub{animation-delay:.32s;}
:host([data-preview-mode="true"]) .bk-window .bk-home-tab[data-tab="home"]:not([hidden]) .bk-home-new-btn{animation-delay:.42s;}
.bk-header-info{flex:1;min-width:0;}
.bk-header-name{font-size:15px;font-weight:600;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.bk-header-status{font-size:12px;opacity:.88;display:flex;align-items:center;gap:6px;margin-top:2px;}
.bk-header-status::before{content:'';display:inline-block;width:7px;height:7px;border-radius:50%;background:#4ADE80;flex-shrink:0;}
.bk-header-actions{display:flex;gap:4px;margin-left:auto;}
.bk-icon-btn{width:32px;height:32px;border-radius:var(--bk-radius-sm);background:rgba(255,255,255,.15);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:white;transition:background var(--bk-transition);}
.bk-icon-btn:hover{background:rgba(255,255,255,.25);}
.bk-icon-btn svg{width:18px;height:18px;}
.bk-user-wrap{position:relative;display:inline-flex;}
.bk-header-user{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;font:600 12px var(--bk-font);color:#fff;background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.2);user-select:none;cursor:pointer;padding:0;transition:transform var(--bk-transition),background var(--bk-transition);}
.bk-header-user:hover{transform:scale(1.05);background:rgba(255,255,255,.25);}
.bk-header-user:active{transform:scale(.96);}
.bk-header-user img{width:100%;height:100%;object-fit:cover;display:block;}
.bk-header-user svg{width:18px;height:18px;color:#fff;opacity:.9;}
.bk-header-user--initials{letter-spacing:.02em;}
.bk-user-popover{position:absolute;top:42px;right:0;min-width:240px;padding:14px;background:var(--bk-popover,#161A26);border:1px solid var(--bk-border);border-radius:14px;box-shadow:0 14px 32px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.02) inset;z-index:50;animation:bk-slide-down .16s ease both;color:var(--bk-text);}
.bk-user-popover[hidden]{display:none;}
.bk-user-popover-header{display:flex;align-items:center;gap:10px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,.08);}
.bk-user-popover-avatar{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;font:600 14px var(--bk-font);color:#fff;background:rgba(255,255,255,.12);}
.bk-user-popover-avatar img{width:100%;height:100%;object-fit:cover;display:block;}
.bk-user-popover-avatar svg{width:20px;height:20px;color:#fff;opacity:.85;}
.bk-user-popover-info{min-width:0;flex:1;}
.bk-user-popover-label{font-size:10.5px;font-weight:500;letter-spacing:.06em;text-transform:uppercase;color:rgba(255,255,255,.55);margin-bottom:2px;}
.bk-user-popover-name{font-size:14px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.bk-user-popover-email{font-size:12px;color:rgba(255,255,255,.65);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.bk-user-popover-actions{display:flex;flex-direction:column;gap:4px;margin-top:10px;}
.bk-user-popover-btn{display:flex;align-items:center;gap:8px;width:100%;padding:8px 10px;border:none;border-radius:8px;background:transparent;color:#fff;font:500 13px var(--bk-font);cursor:pointer;text-align:left;transition:background var(--bk-transition);}
.bk-user-popover-btn:hover{background:rgba(255,255,255,.08);}
.bk-user-popover-btn svg{width:14px;height:14px;flex-shrink:0;}
.bk-user-popover-btn--danger{color:#FCA5A5;}
.bk-user-popover-btn--primary{color:var(--bk-primary);}
.bk-user-popover-empty{padding:6px 4px 0;font-size:12.5px;color:rgba(255,255,255,.7);line-height:1.45;}
.bk-user-popover-theme{padding:0 0 10px;border-bottom:1px solid rgba(255,255,255,.08);margin-bottom:4px;}
.bk-user-popover-theme-btn{width:100%;justify-content:flex-start;}
.bk-user-popover-theme-icon{display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.bk-user-popover-theme-icon svg{width:16px;height:16px;display:block;}
:host([data-theme="light"]) .bk-user-popover{background:rgba(255,255,255,.98);border-color:rgba(15,23,42,.14);box-shadow:0 12px 28px rgba(2,6,23,.18),0 0 0 1px rgba(255,255,255,.5) inset;color:var(--bk-text);}
:host([data-theme="light"]) .bk-user-popover-name{color:var(--bk-text);}
:host([data-theme="light"]) .bk-user-popover-label{color:var(--bk-text-muted);}
:host([data-theme="light"]) .bk-user-popover-email{color:var(--bk-text-muted);}
:host([data-theme="light"]) .bk-user-popover-btn{color:var(--bk-text);}
:host([data-theme="light"]) .bk-user-popover-btn:hover{background:var(--bk-bg-hover);}
:host([data-theme="light"]) .bk-user-popover-header{border-color:var(--bk-border-light);}
:host([data-theme="light"]) .bk-user-popover-theme{border-bottom-color:var(--bk-border-light);}
:host([data-theme="light"]) .bk-user-popover-btn--danger{color:#dc2626;}
.bk-chat-actions{position:relative;}
.bk-chat-actions-menu{position:absolute;top:40px;right:0;min-width:170px;padding:6px;background:var(--bk-popover,#161A26);border:1px solid var(--bk-border);border-radius:12px;box-shadow:0 14px 32px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.02) inset;z-index:3;animation:bk-slide-down .16s ease both;}
.bk-chat-actions-item{width:100%;display:flex;align-items:center;gap:8px;padding:8px 10px;border:none;border-radius:8px;background:transparent;color:var(--bk-text);font:500 13px var(--bk-font);cursor:pointer;text-align:left;}
.bk-chat-actions-item:hover{background:var(--bk-bg-hover);}
:host([data-theme="light"]) .bk-chat-actions-menu{background:rgba(255,255,255,.98);border-color:rgba(15,23,42,.14);box-shadow:0 12px 28px rgba(2,6,23,.18),0 0 0 1px rgba(255,255,255,.5) inset;}
:host([data-theme="light"]) .bk-header{color:var(--bk-text);}
:host([data-theme="light"]) .bk-icon-btn{color:var(--bk-text);background:rgba(15,23,42,.07);}
:host([data-theme="light"]) .bk-icon-btn:hover{background:rgba(15,23,42,.11);}
:host([data-theme="light"]) .bk-header-user{color:var(--bk-text);background:rgba(15,23,42,.08);border-color:rgba(15,23,42,.12);}
:host([data-theme="light"]) .bk-header-user svg{color:var(--bk-text);}
:host([data-theme="light"]) .bk-home-hero{color:var(--bk-text);}
:host([data-theme="light"]) .bk-home-new-btn{color:#0b1220;background:rgba(255,255,255,.97);border-color:rgba(15,23,42,.22);box-shadow:0 12px 42px rgba(2,6,23,.16),0 0 0 1px rgba(255,255,255,.92) inset,0 0 1px color-mix(in srgb,var(--bk-primary) 35%,transparent);}
:host([data-theme="light"]) .bk-home-new-btn:hover{border-color:color-mix(in srgb,var(--bk-primary) 42%,var(--bk-border));box-shadow:0 14px 48px rgba(2,6,23,.2),0 0 0 1px rgba(255,255,255,.98) inset,0 0 22px color-mix(in srgb,var(--bk-primary) 14%,transparent);}
:host([data-theme="light"]) .bk-home-new-btn-icon{background:color-mix(in srgb,var(--bk-primary) 14%,transparent);border:1px solid color-mix(in srgb,var(--bk-primary) 32%,var(--bk-border));box-shadow:inset 0 1px 0 rgba(255,255,255,.65);}
.bk-home{flex:1;display:flex;flex-direction:column;min-height:0;position:relative;z-index:1;}
.bk-home-content{flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;}
.bk-home-tab{display:flex;flex-direction:column;flex:1;min-height:0;}
.bk-home-tab[hidden]{display:none;}
.bk-home-tab[data-tab="home"]{overflow-y:auto;-webkit-overflow-scrolling:touch;}
.bk-home-tab[data-tab="messages"],.bk-home-tab[data-tab="tools"]{overflow:hidden;min-height:0;}
.bk-home-footer{flex-shrink:0;background:var(--bk-bg);position:relative;z-index:2;display:flex;flex-direction:column;}
.bk-tab-nav{display:flex;flex-direction:row;justify-content:space-between;align-items:stretch;min-height:64px;padding:2px 0 6px;}
.bk-tab-btn{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0;padding:0;background:transparent;border:none;color:var(--bk-text-muted);font:600 12px var(--bk-font);cursor:pointer;transition:color .2s,opacity .2s;position:relative;opacity:.72;}
.bk-tab-btn svg{width:22px;height:22px;display:block;}
.bk-tab-btn .bk-tab-label{margin-top:6px;line-height:1.1;letter-spacing:.005em;}
.bk-tab-btn:hover{color:var(--bk-primary);}
.bk-tab-btn.is-active{color:var(--bk-primary);opacity:1;}
.bk-tab-badge{position:absolute;top:14px;left:50%;transform:translateX(8px);min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:var(--bk-primary);color:var(--bk-on-primary);font:700 10px var(--bk-font);display:flex;align-items:center;justify-content:center;}
.bk-window-powered{display:flex;align-items:center;justify-content:center;gap:5px;padding:4px 12px max(8px, env(safe-area-inset-bottom, 0px));font-size:10.5px;color:var(--bk-text-muted);font-weight:500;flex-shrink:0;background:var(--bk-bg);text-decoration:none;cursor:pointer;box-sizing:border-box;width:100%;position:relative;z-index:1;}
.bk-window-powered:hover{color:var(--bk-text);}
.bk-window-powered:focus-visible{outline:2px solid var(--bk-primary);outline-offset:-2px;border-radius:6px;}
.bk-window-powered strong{color:var(--bk-text);font-weight:600;}
.bk-home-hero{background:transparent;padding:28px 24px 24px;color:var(--bk-header-text);position:relative;z-index:1;}
.bk-home-hero-title{font-size:28px;font-weight:700;line-height:1.18;letter-spacing:-.03em;margin-bottom:12px;}
.bk-home-hero-sub{font-size:15.5px;line-height:1.6;opacity:.9;max-width:22em;font-weight:500;}
.bk-home-new-btn{display:flex;align-items:center;gap:14px;width:calc(100% - 48px);max-width:100%;box-sizing:border-box;margin:20px 24px 22px;padding:18px 21px;background:rgba(46,54,74,.86);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-radius:16px;border:1px solid rgba(255,255,255,.22);box-shadow:0 10px 38px rgba(0,0,0,.42),0 0 28px color-mix(in srgb,var(--bk-primary) 10%,transparent),0 0 0 1px rgba(255,255,255,.1) inset;cursor:pointer;color:#fff;font-size:15px;font-weight:600;font-family:var(--bk-font);transition:transform var(--bk-transition),box-shadow var(--bk-transition),border-color var(--bk-transition);text-align:left;}
.bk-home-new-btn:hover{transform:translateY(-2px);box-shadow:0 16px 46px rgba(0,0,0,.48),0 0 38px color-mix(in srgb,var(--bk-primary) 16%,transparent),0 0 0 1px color-mix(in srgb,var(--bk-primary) 20%,transparent) inset;border-color:color-mix(in srgb,var(--bk-primary) 40%,rgba(255,255,255,.22));}
.bk-home-new-btn-icon{width:40px;height:40px;border-radius:12px;background:color-mix(in srgb,var(--bk-primary) 20%,transparent);border:1px solid color-mix(in srgb,var(--bk-primary) 35%,transparent);box-shadow:inset 0 1px 0 rgba(255,255,255,.12);display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.bk-launcher.is-open~.bk-window .bk-home-tab[data-tab="home"]:not([hidden]) .bk-home-hero-title,.bk-launcher.is-open~.bk-window .bk-home-tab[data-tab="home"]:not([hidden]) .bk-home-hero-sub,.bk-launcher.is-open~.bk-window .bk-home-tab[data-tab="home"]:not([hidden]) .bk-home-new-btn{animation:bk-header-in .55s cubic-bezier(.22,1,.36,1) both;}
.bk-launcher.is-open~.bk-window .bk-home-tab[data-tab="home"]:not([hidden]) .bk-home-hero-title{animation-delay:.24s;}
.bk-launcher.is-open~.bk-window .bk-home-tab[data-tab="home"]:not([hidden]) .bk-home-hero-sub{animation-delay:.32s;}
.bk-launcher.is-open~.bk-window .bk-home-tab[data-tab="home"]:not([hidden]) .bk-home-new-btn{animation-delay:.42s;}
.bk-home-new-btn-icon svg{width:18px;height:18px;color:var(--bk-primary);}
.bk-home-tab[data-tab="help"]{overflow:hidden;min-height:0;}
.bk-home-tab[data-tab="help"] .bk-home-section{overflow-y:auto;-webkit-overflow-scrolling:touch;}
.bk-help-search{width:100%;box-sizing:border-box;padding:9px 12px;border:1px solid var(--bk-border);border-radius:10px;background:var(--bk-bg-surface);color:var(--bk-text);font:500 13px var(--bk-font);outline:none;margin-bottom:10px;}
.bk-help-search:focus{border-color:var(--bk-primary);}
.bk-help-item{display:block;width:100%;box-sizing:border-box;padding:12px 14px;margin-bottom:6px;border:1px solid var(--bk-border-light);border-radius:12px;background:var(--bk-bg-surface);cursor:pointer;text-align:left;color:var(--bk-text);font-family:var(--bk-font);transition:background var(--bk-transition),border-color var(--bk-transition);animation:bk-slide-up .25s ease both;}
.bk-help-item:hover{background:var(--bk-bg-hover);border-color:var(--bk-border);}
.bk-help-item-title{font-size:14px;font-weight:600;margin-bottom:2px;}
.bk-help-item-desc{font-size:12.5px;color:var(--bk-text-muted);line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.bk-help-empty{padding:14px 0;font-size:13px;color:var(--bk-text-muted);text-align:center;}
.bk-help-back{display:inline-flex;align-items:center;gap:6px;padding:4px 0;margin-bottom:10px;border:none;background:none;color:var(--bk-text-muted);font:600 12.5px var(--bk-font);cursor:pointer;}
.bk-help-back:hover{color:var(--bk-text);}
.bk-help-back svg{width:14px;height:14px;}
.bk-help-article-title{font-size:18px;font-weight:700;letter-spacing:-.01em;margin-bottom:10px;color:var(--bk-text);}
.bk-help-article-body{font-size:13.5px;line-height:1.6;color:var(--bk-text);padding-bottom:16px;}
.bk-help-article-body p{margin:0 0 10px;}
.bk-help-article-body h1{font-size:17px;font-weight:700;margin:14px 0 8px;letter-spacing:-.01em;}
.bk-help-article-body h2{font-size:15px;font-weight:700;margin:12px 0 6px;}
.bk-help-article-body h3{font-size:14px;font-weight:600;margin:10px 0 4px;}
.bk-help-article-body ul{padding-left:18px;margin:0 0 10px;}
.bk-help-article-body pre{overflow-x:auto;background:var(--bk-bg-surface);border:1px solid var(--bk-border-light);border-radius:8px;padding:10px;font-size:12px;}
.bk-help-article-body code{background:var(--bk-bg-surface);border-radius:4px;padding:1px 4px;font-size:.9em;}
.bk-help-article-body a{color:var(--bk-primary);}
.bk-tools-intro{font-size:12px;font-weight:600;color:var(--bk-text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;}
.bk-toolbox-pills{display:flex;flex-wrap:wrap;gap:6px;}
.bk-tool-pill{padding:6px 12px;border-radius:999px;font:500 12px var(--bk-font);color:var(--bk-text);background:var(--bk-bg-surface);border:1px solid var(--bk-border);}
.bk-tools-empty{padding:14px 0;font-size:13px;color:var(--bk-text-muted);text-align:center;}
.bk-home-section{padding:20px 16px 12px;flex:1;min-height:0;display:flex;flex-direction:column;}
.bk-conv-list{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;}
.bk-home-tab[data-tab="tools"] .bk-home-section{overflow-y:auto;}
.bk-home-section-title{font-size:12px;font-weight:600;color:var(--bk-text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;}
.bk-conv-item{display:flex;align-items:flex-start;gap:12px;padding:12px 16px;margin:2px 8px 2px 0;cursor:pointer;border:none;border-radius:var(--bk-radius-sm);width:100%;background:transparent;transition:background var(--bk-transition);text-align:left;color:var(--bk-text);animation:bk-slide-up .25s ease both;}
.bk-conv-item:hover{background:var(--bk-bg-hover);}
.bk-conv-item-avatar{width:36px;height:36px;border-radius:var(--bk-radius-full);background:color-mix(in srgb,var(--bk-primary) 8%,transparent);border:1px solid color-mix(in srgb,var(--bk-primary) 22%,transparent);box-shadow:0 4px 12px color-mix(in srgb,var(--bk-primary) 22%,transparent),inset 0 -8px 20px color-mix(in srgb,var(--bk-primary) 32%,var(--bk-bg));display:flex;align-items:center;justify-content:center;font-size:14px;color:var(--bk-primary);flex-shrink:0;}
.bk-conv-item-avatar svg{width:18px;height:18px;}
.bk-conv-item-body{flex:1;min-width:0;}
.bk-conv-item-row{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:3px;}
.bk-conv-item-title{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;}
.bk-conv-item-time{font-size:11px;color:var(--bk-text-muted);flex-shrink:0;}
.bk-conv-unread{width:18px;height:18px;border-radius:var(--bk-radius-full);background:var(--bk-primary);color:var(--bk-on-primary);font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:3px;}
.bk-settings{flex:1;overflow-y:auto;display:flex;flex-direction:column;position:relative;z-index:1;}
.bk-settings-inner{padding:20px 16px 24px;}
.bk-settings-title{font-size:20px;font-weight:700;color:var(--bk-text);margin-bottom:20px;letter-spacing:-.02em;position:relative;padding-bottom:12px;}
.bk-settings-title::after{content:'';position:absolute;left:0;bottom:0;width:32px;height:3px;border-radius:2px;background:linear-gradient(90deg,var(--bk-primary),transparent);opacity:.8;}
.bk-settings-section{margin-bottom:20px;padding:16px;border-radius:12px;background:var(--bk-bg-surface);border:1px solid var(--bk-border-light);transition:border-color var(--bk-transition),box-shadow var(--bk-transition);}
.bk-settings-section:hover{border-color:var(--bk-border);}
.bk-settings-section-title{font-size:11px;font-weight:600;color:var(--bk-text-muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px;}
.bk-settings-option{display:flex;flex-direction:column;gap:8px;}
.bk-settings-label{font-size:14px;font-weight:500;color:var(--bk-text);}
.bk-settings-options-row{display:flex;flex-wrap:wrap;gap:8px;}
.bk-settings-radio{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--bk-text);cursor:pointer;}
.bk-settings-radio input{accent-color:var(--bk-primary);}
.bk-settings-toggle-wrap{flex-direction:row;align-items:center;justify-content:space-between;padding:10px 0;gap:12px;}
.bk-settings-toggle-wrap:not(:last-child){border-bottom:1px solid var(--bk-border-light);}
.bk-settings-toggle{display:inline-flex;align-items:center;gap:12px;cursor:pointer;}
.bk-settings-toggle input{position:absolute;width:1px;height:1px;opacity:0;}
.bk-settings-toggle-slider{position:relative;width:48px;height:26px;border-radius:var(--bk-radius-full);background:var(--bk-border);box-shadow:inset 0 1px 3px rgba(0,0,0,.08);transition:background .25s cubic-bezier(.34,1.2,.64,1),box-shadow .25s ease;flex-shrink:0;}
.bk-settings-toggle-slider::after{content:'';position:absolute;top:2px;left:2px;width:22px;height:22px;border-radius:50%;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.2);transition:transform .25s cubic-bezier(.34,1.2,.64,1);}
.bk-settings-toggle input:checked+.bk-settings-toggle-slider{background:var(--bk-primary);box-shadow:inset 0 1px 2px rgba(0,0,0,.1),0 0 0 1px color-mix(in srgb,var(--bk-primary) 20%,transparent);}
.bk-settings-toggle input:checked+.bk-settings-toggle-slider::after{transform:translateX(22px);box-shadow:0 2px 8px rgba(0,0,0,.15);}
.bk-chat-view{flex:1;display:flex;flex-direction:column;overflow:hidden;position:relative;z-index:1;}
.bk-messages{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:4px;scroll-behavior:smooth;}
.bk-messages::-webkit-scrollbar{width:4px;}
.bk-messages::-webkit-scrollbar-track{background:transparent;}
.bk-messages::-webkit-scrollbar-thumb{background:var(--bk-border);border-radius:4px;}
.bk-msg{display:flex;flex-direction:column;max-width:82%;animation:bk-header-in .42s cubic-bezier(.22,1,.36,1) both;}
.bk-msg--ai{align-self:flex-start;}
.bk-msg--user{align-self:flex-end;}
.bk-msg-bubble{padding:10px 14px;border-radius:18px;font-size:14px;line-height:1.5;word-break:break-word;}
.bk-msg--ai .bk-msg-bubble{background:var(--bk-bg-surface);color:var(--bk-text);border-bottom-left-radius:4px;border:1px solid var(--bk-border-light);}
.bk-msg--user .bk-msg-bubble{background:var(--bk-primary);color:var(--bk-on-primary);border-bottom-right-radius:4px;}
.bk-msg-time{font-size:11px;color:var(--bk-text-muted);margin-top:4px;padding:0 4px;}
.bk-msg--user .bk-msg-time{text-align:right;}
.bk-msg-time--hidden{display:none;}
.bk-date-sep{text-align:center;font-size:12px;color:var(--bk-text-muted);padding:8px 0;position:relative;}
.bk-date-sep::before,.bk-date-sep::after{content:'';position:absolute;top:50%;width:40%;height:1px;background:var(--bk-border);}
.bk-date-sep::before{left:0;}.bk-date-sep::after{right:0;}
.bk-msg-bubble p{margin:0 0 8px;}.bk-msg-bubble p:last-child{margin-bottom:0;}
.bk-msg-bubble code{font-family:var(--bk-font-mono);font-size:12px;padding:1px 5px;border-radius:4px;}
.bk-msg--ai .bk-msg-bubble code{background:var(--bk-border-light);}
.bk-msg--user .bk-msg-bubble code{background:rgba(255,255,255,.2);}
.bk-msg-bubble pre{overflow-x:auto;margin:8px 0;}
.bk-msg-bubble ul,.bk-msg-bubble ol{padding-left:20px;margin:8px 0;}
.bk-msg-bubble li{margin-bottom:3px;}
.bk-msg-bubble a{color:var(--bk-primary);}
.bk-msg--user .bk-msg-bubble a{color:rgba(255,255,255,.9);}
.bk-thinking{margin:4px 0;align-self:flex-start;max-width:90%;animation:bk-header-in .4s cubic-bezier(.22,1,.36,1) both;}
.bk-thinking-dots{display:flex;align-items:center;gap:5px;padding:12px 14px;background:var(--bk-bg-surface);border-radius:18px;border-bottom-left-radius:4px;border:1px solid var(--bk-border-light);}
.bk-thinking-dot{width:7px;height:7px;border-radius:50%;background:var(--bk-text-muted);animation:bk-thinking-pulse 1.2s ease-in-out infinite;}
.bk-thinking-dot:nth-child(2){animation-delay:.2s;}
.bk-thinking-dot:nth-child(3){animation-delay:.4s;}
.bk-thinking-label{font-size:13px;color:var(--bk-text-muted);margin-left:4px;}
.bk-thinking-steps{margin-top:6px;border-radius:var(--bk-radius-sm);background:var(--bk-bg-surface);border:1px solid var(--bk-border);overflow:hidden;}.bk-thinking-steps:empty{display:none;}
.bk-thinking-step{display:flex;align-items:center;gap:10px;padding:8px 12px;font-size:13px;border-bottom:1px solid var(--bk-border-light);animation:bk-tool-stagger .25s ease both;}
.bk-thinking-step:last-child{border-bottom:none;}
.bk-step-icon{width:20px;height:20px;flex-shrink:0;display:flex;align-items:center;justify-content:center;}
.bk-step-spinner{width:14px;height:14px;border:2px solid var(--bk-border);border-top-color:var(--bk-primary);border-radius:50%;animation:bk-spin .7s linear infinite;}
.bk-step-check{width:18px;height:18px;background:#10B981;border-radius:50%;color:white;display:flex;align-items:center;justify-content:center;animation:bk-scale-in .2s var(--bk-spring);}
.bk-step-check svg{width:10px;height:10px;}
.bk-step-name{flex:1;color:var(--bk-text);font-weight:500;}
.bk-step-time{font-size:11px;color:var(--bk-text-muted);font-variant-numeric:tabular-nums;}
.bk-inputbar{padding:10px 12px;border-top:1px solid var(--bk-border-light);background:var(--bk-bg);flex-shrink:0;}
.bk-inputbar-inner{display:flex;align-items:center;gap:8px;background:var(--bk-bg-surface);border-radius:var(--bk-radius);border:1.5px solid var(--bk-border);padding:8px 10px 8px 14px;transition:border-color var(--bk-transition);}
.bk-inputbar-inner:focus-within{border-color:var(--bk-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--bk-primary) 16%,transparent);}
.bk-textarea{flex:1;background:transparent;border:none;outline:none;resize:none;font-family:var(--bk-font);font-size:14px;color:var(--bk-text);line-height:1.5;max-height:120px;min-height:20px;overflow-y:auto;}
.bk-textarea::placeholder{color:var(--bk-text-muted);}
.bk-send-btn{width:32px;height:32px;border-radius:var(--bk-radius-sm);background:var(--bk-primary);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--bk-on-primary);flex-shrink:0;transition:background var(--bk-transition),transform var(--bk-transition);}
.bk-send-btn:hover{background:var(--bk-primary-dark);}
.bk-send-btn:active{transform:scale(.92);}
.bk-send-btn:disabled{opacity:.4;cursor:not-allowed;}
.bk-send-btn svg{width:16px;height:16px;}
.bk-record-actions{display:flex;align-items:center;gap:6px;flex-shrink:0;}
.bk-record-btn{width:32px;height:32px;border-radius:var(--bk-radius-sm);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background var(--bk-transition),transform var(--bk-transition);}
.bk-record-btn svg{width:16px;height:16px;}
.bk-record-start{background:var(--bk-bg-surface);color:var(--bk-text-muted);border:1.5px solid var(--bk-border);}
.bk-record-start:hover{color:var(--bk-primary);border-color:var(--bk-primary);}
.bk-record-cancel{background:rgba(0,0,0,.12);color:#1a1a1a;}
.bk-record-cancel:hover{background:rgba(0,0,0,.2);}
.bk-record-confirm{background:var(--bk-primary);color:var(--bk-on-primary);}
.bk-record-confirm:hover{background:var(--bk-primary-dark);}
.bk-record-confirm--recording{animation:bk-record-pulse 1.6s ease-in-out infinite;}
.bk-record-confirm--recording:hover{animation:bk-record-pulse 1.6s ease-in-out infinite;}
.bk-record-wave{width:18px;height:18px;}
.bk-wave-bar{transform-origin:center bottom;animation:bk-wave-bar .8s ease-in-out infinite;}
.bk-wave-bar:nth-child(1){animation-delay:0s;}
.bk-wave-bar:nth-child(2){animation-delay:.1s;}
.bk-wave-bar:nth-child(3){animation-delay:.2s;}
.bk-wave-bar:nth-child(4){animation-delay:.15s;}
.bk-wave-bar:nth-child(5){animation-delay:.05s;}
@keyframes bk-wave-bar{0%,100%{transform:scaleY(0.4);opacity:.8;}50%{transform:scaleY(1);opacity:1;}}
@keyframes bk-record-pulse{0%,100%{transform:scale(1);box-shadow:0 0 0 0 color-mix(in srgb,var(--bk-primary) 35%,transparent);}25%{transform:scale(1.06);box-shadow:0 0 0 6px color-mix(in srgb,var(--bk-primary) 15%,transparent);}50%{transform:scale(.98);box-shadow:0 0 0 2px color-mix(in srgb,var(--bk-primary) 25%,transparent);}75%{transform:scale(1.04);box-shadow:0 0 0 8px color-mix(in srgb,var(--bk-primary) 8%,transparent);}}
.bk-record-btn:active{transform:scale(.92);}
.bk-record-confirm--recording:active{animation:none;transform:scale(.92);}
.bk-attach-btn{width:30px;height:30px;border-radius:var(--bk-radius-sm);background:transparent;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--bk-text-muted);flex-shrink:0;transition:color var(--bk-transition),background var(--bk-transition);}
.bk-attach-btn:hover{color:var(--bk-primary);background:var(--bk-primary-light);}
.bk-attach-btn svg{width:17px;height:17px;}
.bk-preview-strip{display:flex;gap:8px;padding:8px 12px 0;overflow-x:auto;scrollbar-width:none;flex-shrink:0;}
.bk-preview-strip::-webkit-scrollbar{display:none;}
.bk-preview-item{position:relative;width:72px;height:72px;border-radius:var(--bk-radius-sm);overflow:hidden;border:1.5px solid var(--bk-border);flex-shrink:0;background:var(--bk-bg-surface);}
.bk-preview-item img{width:100%;height:100%;object-fit:cover;}
.bk-preview-remove{position:absolute;top:3px;right:3px;width:18px;height:18px;border-radius:var(--bk-radius-full);background:rgba(0,0,0,.6);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;line-height:1;padding:0;}
.bk-preview-uploading::after{content:'';position:absolute;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;}
.bk-preview-spinner{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;}
.bk-preview-spinner svg{width:22px;height:22px;animation:bk-spin .7s linear infinite;color:#fff;}
.bk-msg-images{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;max-width:260px;}
.bk-msg-img{width:120px;height:100px;object-fit:cover;border-radius:10px;cursor:pointer;border:1px solid var(--bk-border-light);transition:opacity var(--bk-transition);}
.bk-msg-img:hover{opacity:.85;}
.bk-msg--user .bk-msg-img{border-color:rgba(255,255,255,.2);}
.bk-image-viewer{position:fixed;inset:0;z-index:9999;background:rgba(2,6,23,.88);display:flex;align-items:center;justify-content:center;padding:24px;}
.bk-image-viewer img{max-width:min(92vw,980px);max-height:86vh;border-radius:14px;box-shadow:0 20px 48px rgba(0,0,0,.45);object-fit:contain;}
.bk-image-viewer-close{position:absolute;top:16px;right:16px;width:36px;height:36px;border-radius:999px;border:1px solid rgba(255,255,255,.25);background:rgba(15,23,42,.65);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background var(--bk-transition),transform var(--bk-transition);}
.bk-image-viewer-close:hover{background:rgba(15,23,42,.9);transform:scale(1.04);}
.bk-image-viewer-close svg{width:18px;height:18px;}
.bk-suggestions{display:flex;gap:6px;padding:6px 12px 0;overflow-x:auto;scrollbar-width:none;flex-shrink:0;}
.bk-suggestions::-webkit-scrollbar{display:none;}
.bk-chip{white-space:nowrap;padding:6px 12px;border-radius:var(--bk-radius-full);font-size:13px;font-family:var(--bk-font);background:var(--bk-bg-surface);border:1.5px solid var(--bk-border);cursor:pointer;color:var(--bk-text);transition:background var(--bk-transition),border-color var(--bk-transition),transform var(--bk-transition);animation:bk-slide-up .25s ease both;}
.bk-chip:hover{background:var(--bk-primary-light);border-color:var(--bk-primary);color:var(--bk-primary);transform:translateY(-1px);}
.bk-error-msg{display:flex;align-items:center;gap:8px;padding:10px 14px;margin:8px;background:#FEF2F2;border:1px solid #FECACA;border-radius:var(--bk-radius-sm);font-size:13px;color:#DC2626;animation:bk-slide-down .25s ease both;}
.bk-error-msg svg{width:16px;height:16px;flex-shrink:0;}
.bk-login-required{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 24px;gap:12px;text-align:center;position:relative;z-index:1;}
.bk-login-icon svg{width:48px;height:48px;color:var(--bk-text-muted);}
.bk-login-title{font-size:17px;font-weight:700;color:var(--bk-text);}
.bk-login-sub{font-size:14px;color:var(--bk-text-muted);line-height:1.5;}
.bk-login-links{display:flex;justify-content:center;gap:8px;font-size:13px;margin-top:4px;}
.bk-login-links a{color:var(--bk-primary);text-decoration:none;font-weight:600;}
.bk-login-links a:hover{text-decoration:underline;}
.bk-agent-banner{display:flex;align-items:center;gap:8px;padding:10px 16px;background:#FFF7ED;border-bottom:1px solid #FED7AA;font-size:13px;color:#C2410C;font-weight:500;}
.bk-agent-banner svg{width:16px;height:16px;flex-shrink:0;}
.bk-offline-banner{display:flex;align-items:center;gap:8px;padding:10px 16px;background:var(--bk-bg-hover);border-bottom:1px solid var(--bk-border);font-size:13px;color:var(--bk-text-muted);font-weight:500;}
.bk-offline-banner svg{width:16px;height:16px;flex-shrink:0;}
.bk-prechat{margin:8px 0;padding:14px;border:1px solid var(--bk-border);border-radius:12px;background:var(--bk-bg-surface);display:flex;flex-direction:column;gap:8px;}
.bk-prechat-title{font-size:13px;font-weight:600;color:var(--bk-text);}
.bk-prechat-sub{font-size:12px;color:var(--bk-text-muted);margin-top:-4px;}
.bk-prechat input{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--bk-border);border-radius:8px;background:var(--bk-bg);color:var(--bk-text);font-size:13px;font-family:inherit;outline:none;}
.bk-prechat input:focus{border-color:var(--bk-primary);}
.bk-prechat-actions{display:flex;gap:8px;align-items:center;margin-top:2px;}
.bk-prechat-submit{padding:8px 14px;border:none;border-radius:8px;background:var(--bk-primary);color:var(--bk-on-primary);font-size:13px;font-weight:600;cursor:pointer;}
.bk-prechat-submit:disabled{opacity:0.6;cursor:default;}
.bk-prechat-skip{padding:8px 10px;border:none;background:none;color:var(--bk-text-muted);font-size:12px;cursor:pointer;}
.bk-prechat-error{font-size:12px;color:#DC2626;}
.bk-csat{margin:8px 0;padding:14px;border:1px solid var(--bk-border);border-radius:12px;background:var(--bk-bg-surface);display:flex;flex-direction:column;gap:10px;animation:bk-slide-up .25s ease both;}
.bk-csat-title{font-size:13px;font-weight:600;color:var(--bk-text);}
.bk-csat-stars{display:flex;gap:4px;}
.bk-csat-star{padding:4px;border:none;background:none;cursor:pointer;color:var(--bk-text-muted);transition:color var(--bk-transition),transform var(--bk-transition);}
.bk-csat-star:hover{transform:scale(1.1);}
.bk-csat-star.is-active{color:#F59E0B;}
.bk-csat-star.is-active svg{fill:currentColor;}
.bk-csat-star svg{width:22px;height:22px;display:block;}
.bk-csat-star:disabled{cursor:default;}
.bk-csat-comment{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--bk-border);border-radius:8px;background:var(--bk-bg);color:var(--bk-text);font-size:13px;font-family:inherit;outline:none;resize:none;}
.bk-csat-comment:focus{border-color:var(--bk-primary);}
.bk-csat-send{align-self:flex-start;padding:8px 14px;border:none;border-radius:8px;background:var(--bk-primary);color:var(--bk-on-primary);font-size:13px;font-weight:600;cursor:pointer;}
.bk-worklog-stack{margin:8px 16px 0;padding:10px 12px;border-radius:12px;background:var(--bk-surface-muted,#f3f4f6);font-size:13px;color:var(--bk-text-secondary,#4b5563);}
.bk-worklog-stack--done .bk-worklog-title{font-weight:600;color:var(--bk-accent,#00D986);}
.bk-worklog-title{font-weight:500;margin-bottom:6px;}
.bk-worklog-list{margin:0;padding-left:18px;}
.bk-worklog-list li{margin:2px 0;}
.bk-home-tab[data-tab="home"]::-webkit-scrollbar,.bk-conv-list::-webkit-scrollbar{width:4px;}
.bk-home-tab[data-tab="home"]::-webkit-scrollbar-track,.bk-conv-list::-webkit-scrollbar-track{background:transparent;}
.bk-home-tab[data-tab="home"]::-webkit-scrollbar-thumb,.bk-conv-list::-webkit-scrollbar-thumb{background:var(--bk-border);border-radius:4px;}
@media (max-width:480px){:host{--bk-window-w:100vw;--bk-window-h:100dvh;}.bk-window{bottom:0!important;right:0!important;left:0!important;top:0!important;border-radius:0;border:none;transform-origin:bottom center!important;}.bk-launcher.is-open{display:none;}}
`;

/* ── Widget component ───────────────────────────────────────── */
class BokitoChatWidget extends HTMLElement {
  #agentSlug; #apiUrl; #agentConfig = null; #sessionToken = null;
  #identityToken = null; #identityType = 'anonymous'; #conversationId = null;
  #hostAuthToken = null; #authCookieName = '';
  #authMode = 'anonymous'; #authTokenValidationUrl = null;
  #tenantSubdomain = null;
  #sessionUser = null; #sessionTenant = null; #tenantMcpServers = [];
  #loginSigninEl = null;
  #isPreferencesHydrated = false;
  #messageRateWindowMs = 12000; #messageRateMax = 12; #messageRateTimestamps = [];
  #sessionRefreshTimer = null;
  #sm = new StateMachine(); #api = null; #realtime = null; #workLogRealtime = null; #workLogStackEl = null;
  #workLogFinished = false; #pageCtx = null; #root;
  #launcher; #window; #homeView; #chatView; #loginRequiredView; #messageList; #thinkingEl;
  #textarea; #sendBtn; #suggChips; #headerName; #thinkingSteps; #thinkingLabel;
  #toolboxWrap; #toolboxToggle; #toolboxMenu; #toolboxPills;
  #chatActionsWrap; #chatActionsBtn; #chatActionsMenu; #settingsBtn;
  #backBtn; #settingsView; #headerUser; #userPopover; #preSettingsView = null; #activeHomeTab = 'home';
  #helpArticles = null; // null = not fetched yet, [] = none published (tab stays hidden)
  #soundEffectsEnabled = true; #soundNotificationsEnabled = true;
  #themeSchemeMedia = null; #themeSchemeListenerBound = false;
  #helpModuleEnabled = true;
  #badge; #unreadTotal = 0;
  #attachBtn; #fileInput; #previewStrip;
  #imageViewer; #imageViewerImg; #imageViewerClose;
  #globalImageViewer = null; #globalImageViewerImg = null; #globalImageViewerClose = null; #globalImageViewerEscHandler = null;
  #recordActionsWrap; #recordStartBtn; #recordCancelBtn; #recordConfirmBtn;
  #mediaRecorder = null; #recordChunks = []; #speechRecognition = null; #recordedTranscript = ''; #recordStream = null;
  #recordMimeType = 'audio/webm';
  #sounds = {};
  #audioCtx = null;
  #windowCloseTimer = null;
  #pollTimer = null;
  #renderedMsgIds = new Set();
  #streamingMsgEl = null;
  #streamingMsgId = null;
  #deltaQueue = [];
  #deltaRaf = null;
  #pendingFinalMsg = null;
  #pendingAttachments = []; // [{ localUrl, id, url, uploading }]
  #nonBlockingSend = true;
  #sendQueue = [];
  #activeSend = null;
  #isResponding = false;
  #bundleIdleMs = 900;
  #timestampClusterWindowMs = 300000;
  #staleSuppressGraceMs = 500;
  #bundleTimer = null;
  #processingWatchdogTimer = null;
  #processingTimeoutMs = 30000;
  #lastProcessingActivityAt = 0;
  #typingIdleMs = 700;
  #typingDebounceTimer = null;
  #isUserTyping = false;
  #pendingBundleTextParts = [];
  #pendingBundleAttachments = [];
  #turnCounter = 0;
  #activeTurnId = 0;
  #suppressedAiQuota = 0;
  #lastAbortAt = 0;
  _toolDisplayNames = {};
  #idleWatcher = null; #proactiveBubbles = null; #proactiveDismissTimer = null;
  #proactivePending = null; #shownProactiveSuggestions = [];
  #debugPanel = null;
  #launcherPosition = { edge: 'bottom', offset: 0 };
  #dragState = null;
  #suppressNextLauncherClick = false;
  #onWindowResizeBound = null;
  /** Non-empty when data-preview-mode: isolate localStorage from other widget instances */
  #storNs = '';
  #headerAvatarImg = null;
  /** Parsed JSON from data-preview-overrides (dashboard draft). */
  #previewParsedOverrides = null;

  static get observedAttributes() {
    return ['data-preview-overrides'];
  }

  attributeChangedCallback(name) {
    if (name === 'data-preview-overrides') {
      this.#parsePreviewOverridesAttribute();
      this.#refreshChromeFromThemeAndPreview();
    }
  }

  #storKey(key) {
    return this.#storNs ? `${this.#storNs}${key}` : key;
  }

  #storGet(key) {
    return localStorage.getItem(this.#storKey(key));
  }

  #storSet(key, value) {
    localStorage.setItem(this.#storKey(key), value);
  }

  #storRemove(key) {
    localStorage.removeItem(this.#storKey(key));
  }

  #isPreviewEmbedded() {
    return this.dataset.previewMode === 'true';
  }

  #parsePreviewOverridesAttribute() {
    this.#previewParsedOverrides = null;
    const raw = this.dataset.previewOverrides;
    if (!raw || typeof raw !== 'string') return;
    const t = raw.trim();
    if (!t) return;
    try {
      const obj = JSON.parse(t);
      this.#previewParsedOverrides = obj && typeof obj === 'object' ? obj : null;
    } catch {
      this.#previewParsedOverrides = null;
    }
  }

  #mergedThemeForChrome() {
    const base = this.#agentConfig?.theme && typeof this.#agentConfig.theme === 'object' ? { ...this.#agentConfig.theme } : {};
    const pv = this.#previewParsedOverrides && typeof this.#previewParsedOverrides === 'object' ? this.#previewParsedOverrides : {};
    const out = { ...base };
    const pick = (key) => {
      const v = pv[key];
      if (typeof v === 'string' && v.trim()) out[key] = v.trim();
    };
    pick('main_color');
    pick('primary_color');
    pick('welcome_title');
    pick('welcome_subtitle');
    pick('chatbot_name');
    pick('widget_favicon_url');
    if (pv.modules && typeof pv.modules === 'object') out.modules = { ...pv.modules };
    return out;
  }

  #refreshChromeFromThemeAndPreview() {
    const eff = this.#mergedThemeForChrome();
    this.#applyUserThemeOverride();
    this.#applyAgentTheme(eff);
    this.#syncAgentWindowAtmosphere();
    const name = typeof eff.chatbot_name === 'string' && eff.chatbot_name.trim() ? eff.chatbot_name.trim() : 'Bokito AI';
    if (this.#headerName) this.#headerName.textContent = name;
    this.#syncHomeHeroFromTheme(eff);
    this.#syncHeaderAvatarFromTheme(eff);
    this.#applyModuleVisibility(eff);
  }

  /* ── Messenger modules (tenant-configured widget tabs) ────────── */

  #moduleEnabled(theme, key) {
    const mods = theme && typeof theme.modules === 'object' ? theme.modules : null;
    if (!mods) return true;
    return mods[key] !== false;
  }

  /** Hide widget tabs the tenant disabled in Messenger settings. The Help
   * tab additionally requires published articles (see #maybeLoadHelpArticles). */
  #applyModuleVisibility(theme) {
    const tabs = ['home', 'messages', 'help', 'tools'];
    for (const tab of tabs) {
      const btn = this.#root?.querySelector(`.bk-tab-btn[data-tab="${tab}"]`);
      if (!btn) continue;
      const enabled = this.#moduleEnabled(theme, tab);
      if (tab === 'help') {
        this.#helpModuleEnabled = enabled;
        btn.hidden = !enabled || !(Array.isArray(this.#helpArticles) && this.#helpArticles.length > 0);
      } else {
        btn.hidden = !enabled;
      }
    }
    const active = this.#activeHomeTab;
    if (active && !this.#moduleEnabled(theme, active)) {
      const fallback = tabs.find((t) => this.#moduleEnabled(theme, t)) || 'messages';
      this.#switchHomeTab(fallback);
    }
  }

  #syncHomeHeroFromTheme(theme) {
    const t = theme && typeof theme === 'object' ? theme : {};
    const name = typeof t.chatbot_name === 'string' && t.chatbot_name.trim() ? t.chatbot_name.trim() : 'Bokito AI';
    const titleEl = this.#root?.querySelector('.bk-home-hero-title');
    const subEl = this.#root?.querySelector('.bk-home-hero-sub');
    if (titleEl) {
      titleEl.textContent =
        typeof t.welcome_title === 'string' && t.welcome_title.trim() ? t.welcome_title.trim() : 'Hi!';
    }
    if (subEl) {
      subEl.textContent =
        typeof t.welcome_subtitle === 'string' && t.welcome_subtitle.trim()
          ? t.welcome_subtitle.trim()
          : `Ask ${name} a question`;
    }
  }

  #syncHeaderAvatarFromTheme(theme) {
    const t = theme && typeof theme === 'object' ? theme : {};
    const url =
      typeof t.widget_favicon_url === 'string' && t.widget_favicon_url.trim()
        ? t.widget_favicon_url.trim()
        : null;
    const img = this.#headerAvatarImg || this.#root?.querySelector('.bk-header-avatar-img');
    const svg = this.#root?.querySelector('.bk-avatar-logo');
    if (!img) return;
    if (url) {
      img.src = url;
      img.hidden = false;
      if (svg) svg.hidden = true;
    } else {
      img.removeAttribute('src');
      img.hidden = true;
      if (svg) svg.hidden = false;
    }
  }

  setIdentityToken(token) { this.#identityToken = token; }

  #resolveHostAuthToken() {
    if (this.dataset.authToken) return String(this.dataset.authToken).trim();
    const cfg = window.BokitoConfig || {};
    if (cfg.authToken) return String(cfg.authToken).trim();
    if (typeof cfg.getAuthToken === 'function') {
      try {
        const maybePromise = cfg.getAuthToken();
        if (typeof maybePromise === 'string' && maybePromise.trim()) return maybePromise.trim();
      } catch {}
    }
    const cookieName = this.#authCookieName || cfg.authCookieName || '';
    if (cookieName) return readCookieValue(cookieName);
    return null;
  }

  async #refreshHostAuthToken() {
    const cfg = window.BokitoConfig || {};
    if (typeof cfg.getAuthToken === 'function') {
      try {
        const token = await cfg.getAuthToken();
        if (typeof token === 'string' && token.trim()) {
          this.#hostAuthToken = token.trim();
          this.#storSet(LS_AUTH_TOKEN_KEY, this.#hostAuthToken);
          return this.#hostAuthToken;
        }
      } catch {}
    }
    this.#hostAuthToken = this.#resolveHostAuthToken() || this.#storGet(LS_AUTH_TOKEN_KEY) || null;
    return this.#hostAuthToken;
  }

  #normalizeHostUser(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const avatar = raw.avatar ?? raw.avatar_url ?? raw.profile_picture ?? null;
    const id = raw.id ?? raw.user_id ?? null;
    const name = String(raw.name || raw.full_name || raw.display_name || '').trim();
    const email = String(raw.email || '').trim();
    if (!id && !email && !name) return null;
    return { id, name, email, avatar };
  }

  async #fetchHostUserInfo() {
    if (this.#sessionUser && this.#sessionUser.id) return;
    const cfg = window.BokitoConfig || {};

    let inlineUser = null;
    try {
      if (cfg.user && typeof cfg.user === 'object') {
        inlineUser = cfg.user;
      } else if (typeof cfg.getUser === 'function') {
        const maybe = cfg.getUser();
        if (maybe && typeof maybe === 'object' && typeof maybe.then !== 'function') {
          inlineUser = maybe;
        }
      }
    } catch {}
    const normalizedInline = this.#normalizeHostUser(inlineUser);
    if (normalizedInline) {
      this.#sessionUser = normalizedInline;
      this.#renderHeaderUser();
      return;
    }

    if (!this.#hostAuthToken) return;
    const defaultMeUrl = apiGroupUrl(this.#apiUrl, LIVECHAT_DEFAULT_HOST_AUTH_GROUP, livechatRoutes.hostAuth.me);
    const url = (this.dataset.hostMeUrl && String(this.dataset.hostMeUrl).trim())
      || (cfg.hostMeUrl && String(cfg.hostMeUrl).trim())
      || defaultMeUrl;

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.#hostAuthToken}` },
        credentials: 'omit',
      });
      if (!res.ok) return;
      const data = await res.json();
      const normalized = this.#normalizeHostUser(data);
      if (!normalized) return;
      this.#sessionUser = normalized;
      this.#renderHeaderUser();
    } catch {}
  }

  #resolveAuthMode(config = null) {
    const mode = (config?.auth_mode || this.#authMode || 'anonymous').toString().toLowerCase();
    return ['anonymous', 'optional', 'required'].includes(mode) ? mode : 'anonymous';
  }

  #isAuthRequired(config = null) {
    const mode = this.#resolveAuthMode(config || this.#agentConfig);
    if (mode === 'required') return true;
    if (config?.min_identity_to_start && config.min_identity_to_start !== 'anonymous') return true;
    if (config?.visibility === 'internal') return true;
    return false;
  }

  /** Public API: open the chat window programmatically. */
  open() {
    if (this.#sm.state === 'idle') void this.#openWidget();
  }

  /** Public API: close the chat window programmatically. */
  close() {
    if (this.#sm.state !== 'idle') this.#closeWindow();
  }

  /** Public API: toggle the chat window programmatically. */
  toggle() {
    if (this.#sm.state === 'idle') void this.#openWidget();
    else this.#closeWindow();
  }

  async identify(identityToken) {
    this.#identityToken = identityToken;
    if (this.#sessionToken) {
      try {
        const result = await this.#api.post('session/identify', { identity_token: identityToken });
        if (result) {
          this.#applySessionPayload(result);
          if (result.customer_id) this.#storSet(LS_CUSTOMER_ID_KEY, result.customer_id);
          if (this.#sm.state === 'login_required') this.#sm.transition('home');
        }
      } catch (e) { console.warn('[Bokito] Identity elevation failed:', e.message); }
    } else {
      await this.#initSession();
      if (this.#sessionToken && this.#sm.state === 'login_required') this.#sm.transition('home');
    }
  }

  async logout() {
    // The host platform owns the user session; the widget only drops its own
    // livechat session and cached identity so the next open starts fresh.
    this.#sessionToken = null;
    this.#sessionUser = null;
    this.#sessionTenant = null;
    this.#tenantMcpServers = [];
    this.#identityType = 'anonymous';
    this.#conversationId = null;
    this.#api?.setToken(null);
    this.#storRemove(LS_AUTH_TOKEN_KEY);
    this.#hostAuthToken = null;
    this.#renderHeaderUser();
    this.#sm.transition('idle');
  }

  connectedCallback() {
    const isPreview = this.dataset.previewMode === 'true';
    this.#storNs = isPreview
      ? `bkpw_${
          typeof crypto !== 'undefined' && crypto.getRandomValues
            ? [...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, '0')).join('')
            : String(Date.now())
        }_`
      : '';
    if (isPreview) this.setAttribute('data-preview-mode', 'true');

    this.#agentSlug     = this.dataset.agentSlug     || '';
    this.#apiUrl        = normalizeLivechatApiBase(this.dataset.apiUrl || '');
    this.#identityToken = this.dataset.identityToken || null;
    this.#authCookieName = (this.dataset.authCookieName || '').trim();
    this.#authMode = (this.dataset.authMode || 'anonymous').trim().toLowerCase();
    if (!['anonymous', 'optional', 'required'].includes(this.#authMode)) this.#authMode = 'anonymous';
    // Explicit tenant wins over host-based resolution (needed on customer domains).
    this.#tenantSubdomain = (this.dataset.tenant || '').trim() || null;
    this.#hostAuthToken = this.#resolveHostAuthToken();
    this.#nonBlockingSend = this.dataset.nonBlockingSend !== 'false';
    this.#processingTimeoutMs = Number(this.dataset.processingTimeoutMs || 30000);
    this.#typingIdleMs = Number(this.dataset.typingIdleMs || 700);
    this.#bundleIdleMs = Number(this.dataset.bundleIdleMs || 900);
    this.#timestampClusterWindowMs = Number(this.dataset.timestampClusterWindowMs || 300000);
    this.#staleSuppressGraceMs = Number(this.dataset.staleSuppressGraceMs || 500);
    // Open shadow root: styles stay fully scoped, but E2E tooling (Playwright)
    // and host-page debugging can reach the internals when needed.
    this.#root = this.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = WIDGET_CSS;
    this.#root.appendChild(style);

    this.#render();
    this.#bindEvents();
    this.#setupStateMachine();
    this.#pageCtx = new PageContextManager(this.#api);
    this.#initSounds();
    this.#loadUserPreferences();
    this.#syncLoginLinks();
    this.#syncVoiceAvailability();
    this.#idleWatcher = new IdleWatcher(() => this.#onUserIdle(), { idleMs: 3000, maxTriggers: 3 });
    this.#idleWatcher.start();
    if (import.meta.env.MODE !== 'production' && this.dataset.debug === 'true') {
      this.#setupDebugPanel();
    }
    this.addEventListener('bokito:agent-invoked', (e) => {
      const workLogId = e?.detail?.workLogId || e?.detail?.work_log_id;
      if (workLogId) this.#subscribeWorkLog(String(workLogId));
    });
    this.#parsePreviewOverridesAttribute();
    this.#refreshChromeFromThemeAndPreview();
    if (this.dataset.previewMode === 'true') {
      queueMicrotask(() => {
        void this.#openWidget();
      });
    }
  }

  #render() {
    const div = document.createElement('div');
    div.innerHTML = `
      <button class="bk-launcher" aria-label="Open chat">
        <svg class="bk-launcher-icon bk-launcher-icon--chat bk-launcher-icon--monkey" viewBox="-22 -24 361 403" fill="none" xmlns="http://www.w3.org/2000/svg">
          <style>
            .bk-bokito-wink-g{transform-origin:158.5px 177.5px;animation:bkHeadWink 45s ease-in-out infinite}
            .bk-bokito-g{transform-origin:158.5px 177.5px;animation:bkHeadMove 15s cubic-bezier(.42,0,.58,1) infinite}
            .bk-bokito-f{animation:bkFaceExpr 45s cubic-bezier(.42,0,.58,1) infinite}
            @keyframes bkHeadWink{0%,66%,69.5%,100%{transform:rotate(0) translate(0,0)}67.5%,68.5%{transform:rotate(2deg) translate(2px,-1px)}}
            @keyframes bkHeadMove{0%{transform:rotate(0) translate(0,0) scale(1)}1%{transform:rotate(1.5deg) translate(.5px,.5px) scale(.99)}5%{transform:rotate(-10deg) translate(-5px,-8px) scale(1.01)}7%{transform:rotate(-8.5deg) translate(-4px,-7px) scale(1.005)}8%{transform:rotate(-9deg) translate(-4.5px,-7.5px) scale(1.005)}12%{transform:rotate(1deg) translate(.3px,.3px) scale(1)}13%{transform:rotate(0) translate(0,0) scale(1)}18%{transform:rotate(-.5deg) translate(0,-1px) scale(1.01)}20%{transform:rotate(0) translate(0,-.5px) scale(1.005)}23%{transform:rotate(.5deg) translate(0,.5px) scale(.995)}26%{transform:rotate(0) translate(0,0) scale(1.005)}29%,100%{transform:rotate(0) translate(0,0) scale(1)}}
            @keyframes bkFaceExpr{0%,5%,5.3%,9.7%,10.7%,15.3%,22%,28%,31%,33.3%,37%,42%,57%,69.5%,72%,84%,93%,100%{d:path("M26.6433 267.197C45.1327 277.878 75.6447 286.435 101.358 290.367C146.687 297.256 196.097 295.654 238.874 285.905C259.443 281.121 273.961 275.586 288.806 268.009C285.993 282.241 279.806 295.127 268.54 308.402C229.03 350.457 151.035 366.187 97.7947 344.087C67.3069 331.432 37.7979 305.137 28.1169 272.852C27.5527 270.971 27.0636 269.085 26.6433 267.197ZM47.3689 0.20468C80.7091 -3.0015 124.515 32.3146 155.875 46.2232C165.375 41.7758 174.63 36.8241 183.605 31.3902C211.035 14.9719 239.021 -4.81321 272.735 2.00644C285.825 4.68202 297.29 12.5187 304.535 23.7476C317.79 43.9641 318.685 73.8533 314.085 97.1842C309.63 119.773 297.83 141.189 280.615 156.548C276.05 160.619 270.65 164.026 265.5 167.39C280.314 183.136 288.75 212.782 290.245 234.152C290.778 241.779 290.884 248.889 290.417 255.633C286.146 255.342 281.211 256.355 277.984 258.497C273.711 261.331 266.218 264.926 261.065 266.943C210.169 286.514 138.268 289.603 80.365 274.703C68.1936 271.555 57.6311 267.761 47.99 263.115C40.9507 259.722 38.6823 256.002 27.824 255.582C26.816 255.808 25.8593 256.059 24.9724 256.329C22.2867 225.615 36.144 194.75 50.5974 168.344C30.2548 152.877 20.2597 143.275 9.59936 118.911C-0.660435 95.4629 -3.88523 67.428 5.83862 43.2017C13.4066 23.9125 28.3537 8.43671 47.3689 0.20468ZM199.965 174.918C198.364 165.857 189.749 159.788 180.675 161.332C171.525 162.89 165.395 171.598 167.005 180.739C168.62 189.879 177.365 195.96 186.5 194.289C195.55 192.633 201.565 183.979 199.965 174.918ZM128.599 161.347C120.507 159.531 112.3 163.89 109.274 171.612C108.017 174.82 107.777 178.337 108.586 181.686C110.533 189.748 118.071 195.184 126.336 194.485C134.6 193.786 141.118 187.162 141.683 178.887C142.249 170.613 136.692 163.164 128.599 161.347ZM262.3 115.085C261.634 96.6836 247.099 68.673 225.354 70.0582C224.845 70.0897 224.339 70.1266 223.83 70.1685C209.08 76.2057 197.865 101.588 191.255 115.718C190.325 117.71 189.354 120.748 189.179 122.962L189.694 123.821C192.954 123.676 203.874 118.28 207.554 116.913C213.529 114.696 218.275 113.116 224.8 112.534C235.324 112.489 241.365 114.05 250.915 118.668C256.53 121.383 262.664 125.248 262.3 115.085ZM93.2605 71.108C90.6937 69.8213 87.4802 69.9627 84.9294 70.1441C63.3749 75.2763 51.8802 98.0641 52.7224 119.095C52.7689 120.263 53.5808 120.889 54.3152 121.607C58.0322 122.098 71.2004 114.553 76.6384 113.59C84.4266 112.212 87.9264 112.256 95.7996 113.206C100.812 114.322 123.644 124.057 125.413 123.759C125.971 122.434 125.164 119.889 124.471 118.538C117.079 104.119 108.177 78.5861 93.2605 71.108Z");animation-timing-function:cubic-bezier(.42,0,.58,1)}4.3%,14.7%,21.3%,27.3%,40%,55%,82%{d:path("M26.6433 267.197C45.1327 277.878 75.6447 286.435 101.358 290.367C146.687 297.256 196.097 295.654 238.874 285.905C259.443 281.121 273.961 275.586 288.806 268.009C285.993 282.241 279.806 295.127 268.54 308.402C229.03 350.457 151.035 366.187 97.7947 344.087C67.3069 331.432 37.7979 305.137 28.1169 272.852C27.5527 270.971 27.0636 269.085 26.6433 267.197ZM47.3689 0.20468C80.7091 -3.0015 124.515 32.3146 155.875 46.2232C165.375 41.7758 174.63 36.8241 183.605 31.3902C211.035 14.9719 239.021 -4.81321 272.735 2.00644C285.825 4.68202 297.29 12.5187 304.535 23.7476C317.79 43.9641 318.685 73.8533 314.085 97.1842C309.63 119.773 297.83 141.189 280.615 156.548C276.05 160.619 270.65 164.026 265.5 167.39C280.314 183.136 288.75 212.782 290.245 234.152C290.778 241.779 290.884 248.889 290.417 255.633C286.146 255.342 281.211 256.355 277.984 258.497C273.711 261.331 266.218 264.926 261.065 266.943C210.169 286.514 138.268 289.603 80.365 274.703C68.1936 271.555 57.6311 267.761 47.99 263.115C40.9507 259.722 38.6823 256.002 27.824 255.582C26.816 255.808 25.8593 256.059 24.9724 256.329C22.2867 225.615 36.144 194.75 50.5974 168.344C30.2548 152.877 20.2597 143.275 9.59936 118.911C-0.660435 95.4629 -3.88523 67.428 5.83862 43.2017C13.4066 23.9125 28.3537 8.43671 47.3689 0.20468ZM199.965 174.918C198.364 165.857 189.749 159.788 180.675 161.332C171.525 162.89 165.395 171.598 167.005 180.739C168.62 189.879 177.365 195.96 186.5 194.289C195.55 192.633 201.565 183.979 199.965 174.918ZM128.599 161.347C120.507 159.531 112.3 163.89 109.274 171.612C108.017 174.82 107.777 178.337 108.586 181.686C110.533 189.748 118.071 195.184 126.336 194.485C134.6 193.786 141.118 187.162 141.683 178.887C142.249 170.613 136.692 163.164 128.599 161.347ZM262.3 100.085C261.634 97.6836 247.099 93.673 225.354 94.0582C224.845 94.0897 224.339 94.1266 223.83 94.1685C209.08 95.2057 197.865 97.588 191.255 100.718C190.325 101.71 189.354 102.748 189.179 103.962L189.694 104.821C192.954 104.676 203.874 102.28 207.554 101.913C213.529 101.696 218.275 101.116 224.8 100.534C235.324 100.489 241.365 101.05 250.915 102.668C256.53 103.383 262.664 104.248 262.3 100.085ZM93.2605 94.108C90.6937 93.8213 87.4802 93.9627 84.9294 94.1441C63.3749 95.2763 51.8802 97.0641 52.7224 101.095C52.7689 101.263 53.5808 101.889 54.3152 102.607C58.0322 102.098 71.2004 100.553 76.6384 100.59C84.4266 100.212 87.9264 100.256 95.7996 100.206C100.812 100.322 123.644 103.057 125.413 102.759C125.971 102.434 125.164 101.889 124.471 101.538C117.079 98.119 108.177 95.5861 93.2605 94.108Z");animation-timing-function:cubic-bezier(.12,0,.39,0)}4.7%,15%,21.7%,27.7%,40.7%,55.7%,82.7%{d:path("M26.6433 267.197C45.1327 277.878 75.6447 286.435 101.358 290.367C146.687 297.256 196.097 295.654 238.874 285.905C259.443 281.121 273.961 275.586 288.806 268.009C285.993 282.241 279.806 295.127 268.54 308.402C229.03 350.457 151.035 366.187 97.7947 344.087C67.3069 331.432 37.7979 305.137 28.1169 272.852C27.5527 270.971 27.0636 269.085 26.6433 267.197ZM47.3689 0.20468C80.7091 -3.0015 124.515 32.3146 155.875 46.2232C165.375 41.7758 174.63 36.8241 183.605 31.3902C211.035 14.9719 239.021 -4.81321 272.735 2.00644C285.825 4.68202 297.29 12.5187 304.535 23.7476C317.79 43.9641 318.685 73.8533 314.085 97.1842C309.63 119.773 297.83 141.189 280.615 156.548C276.05 160.619 270.65 164.026 265.5 167.39C280.314 183.136 288.75 212.782 290.245 234.152C290.778 241.779 290.884 248.889 290.417 255.633C286.146 255.342 281.211 256.355 277.984 258.497C273.711 261.331 266.218 264.926 261.065 266.943C210.169 286.514 138.268 289.603 80.365 274.703C68.1936 271.555 57.6311 267.761 47.99 263.115C40.9507 259.722 38.6823 256.002 27.824 255.582C26.816 255.808 25.8593 256.059 24.9724 256.329C22.2867 225.615 36.144 194.75 50.5974 168.344C30.2548 152.877 20.2597 143.275 9.59936 118.911C-0.660435 95.4629 -3.88523 67.428 5.83862 43.2017C13.4066 23.9125 28.3537 8.43671 47.3689 0.20468ZM199.965 174.918C198.364 165.857 189.749 159.788 180.675 161.332C171.525 162.89 165.395 171.598 167.005 180.739C168.62 189.879 177.365 195.96 186.5 194.289C195.55 192.633 201.565 183.979 199.965 174.918ZM128.599 161.347C120.507 159.531 112.3 163.89 109.274 171.612C108.017 174.82 107.777 178.337 108.586 181.686C110.533 189.748 118.071 195.184 126.336 194.485C134.6 193.786 141.118 187.162 141.683 178.887C142.249 170.613 136.692 163.164 128.599 161.347ZM262.3 117.085C261.634 94.6836 247.099 63.673 225.354 65.0582C224.845 65.0897 224.339 65.1266 223.83 65.1685C209.08 72.2057 197.865 99.588 191.255 117.718C190.325 119.71 189.354 123.748 189.179 126.962L189.694 127.821C192.954 127.676 203.874 121.28 207.554 119.913C213.529 117.696 218.275 116.116 224.8 115.534C235.324 115.489 241.365 117.05 250.915 121.668C256.53 124.383 262.664 129.248 262.3 117.085ZM93.2605 65.108C90.6937 63.8213 87.4802 63.9627 84.9294 64.1441C63.3749 70.2763 51.8802 95.0641 52.7224 123.095C52.7689 124.263 53.5808 124.889 54.3152 125.607C58.0322 126.098 71.2004 117.553 76.6384 116.59C84.4266 115.212 87.9264 115.256 95.7996 116.206C100.812 117.322 123.644 128.057 125.413 127.759C125.971 126.434 125.164 123.889 124.471 122.538C117.079 107.119 108.177 73.5861 93.2605 65.108Z");animation-timing-function:cubic-bezier(.61,1,.88,1)}6%,6.7%{d:path("M26.6433 267.197C45.1327 280.878 75.6447 290.435 101.358 294.367C146.687 301.256 196.097 299.654 238.874 289.905C259.443 285.121 273.961 278.586 288.806 268.009C285.993 284.241 279.806 299.127 268.54 313.402C229.03 356.457 151.035 372.187 97.7947 349.087C67.3069 336.432 37.7979 309.137 28.1169 276.852C27.5527 274.971 27.0636 271.085 26.6433 267.197ZM47.3689 0.20468C80.7091 -3.0015 124.515 32.3146 155.875 46.2232C165.375 41.7758 174.63 36.8241 183.605 31.3902C211.035 14.9719 239.021 -4.81321 272.735 2.00644C285.825 4.68202 297.29 12.5187 304.535 23.7476C317.79 43.9641 318.685 73.8533 314.085 97.1842C309.63 119.773 297.83 141.189 280.615 156.548C276.05 160.619 270.65 164.026 265.5 167.39C280.314 183.136 288.75 212.782 290.245 234.152C290.778 241.779 290.884 248.889 290.417 255.633C286.146 255.342 281.211 256.355 277.984 258.497C273.711 261.331 266.218 264.926 261.065 266.943C210.169 286.514 138.268 289.603 80.365 274.703C68.1936 271.555 57.6311 267.761 47.99 263.115C40.9507 259.722 38.6823 256.002 27.824 255.582C26.816 255.808 25.8593 256.059 24.9724 256.329C22.2867 225.615 36.144 194.75 50.5974 168.344C30.2548 152.877 20.2597 143.275 9.59936 118.911C-0.660435 95.4629 -3.88523 67.428 5.83862 43.2017C13.4066 23.9125 28.3537 8.43671 47.3689 0.20468ZM199.965 174.918C198.364 165.857 189.749 159.788 180.675 161.332C171.525 162.89 165.395 171.598 167.005 180.739C168.62 189.879 177.365 195.96 186.5 194.289C195.55 192.633 201.565 183.979 199.965 174.918ZM128.599 161.347C120.507 159.531 112.3 163.89 109.274 171.612C108.017 174.82 107.777 178.337 108.586 181.686C110.533 189.748 118.071 195.184 126.336 194.485C134.6 193.786 141.118 187.162 141.683 178.887C142.249 170.613 136.692 163.164 128.599 161.347ZM262.3 110.085C261.634 95.6836 247.099 80.673 225.354 81.0582C224.845 81.0897 224.339 81.1266 223.83 81.1685C209.08 84.2057 197.865 100.588 191.255 110.718C190.325 112.71 189.354 114.748 189.179 115.962L189.694 116.821C192.954 116.676 203.874 113.28 207.554 112.913C213.529 111.696 218.275 110.116 224.8 109.534C235.324 109.489 241.365 110.05 250.915 112.668C256.53 114.383 262.664 117.248 262.3 110.085ZM93.2605 81.108C90.6937 80.8213 87.4802 80.9627 84.9294 81.1441C63.3749 84.2763 51.8802 96.0641 52.7224 112.095C52.7689 112.263 53.5808 112.889 54.3152 113.607C58.0322 113.098 71.2004 109.553 76.6384 108.59C84.4266 107.212 87.9264 107.256 95.7996 108.206C100.812 109.322 123.644 116.057 125.413 115.759C125.971 115.434 125.164 113.889 124.471 112.538C117.079 101.119 108.177 84.5861 93.2605 81.108Z");animation-timing-function:cubic-bezier(.42,0,.58,1)}7.7%,8.7%{d:path("M26.6433 267.197C45.1327 279.878 75.6447 288.435 101.358 292.367C146.687 299.256 196.097 297.654 238.874 287.905C259.443 283.121 273.961 277.586 288.806 268.009C285.993 283.241 279.806 297.127 268.54 311.402C229.03 354.457 151.035 370.187 97.7947 347.087C67.3069 334.432 37.7979 307.137 28.1169 274.852C27.5527 272.971 27.0636 270.085 26.6433 267.197ZM47.3689 0.20468C80.7091 -3.0015 124.515 32.3146 155.875 46.2232C165.375 41.7758 174.63 36.8241 183.605 31.3902C211.035 14.9719 239.021 -4.81321 272.735 2.00644C285.825 4.68202 297.29 12.5187 304.535 23.7476C317.79 43.9641 318.685 73.8533 314.085 97.1842C309.63 119.773 297.83 141.189 280.615 156.548C276.05 160.619 270.65 164.026 265.5 167.39C280.314 183.136 288.75 212.782 290.245 234.152C290.778 241.779 290.884 248.889 290.417 255.633C286.146 255.342 281.211 256.355 277.984 258.497C273.711 261.331 266.218 264.926 261.065 266.943C210.169 286.514 138.268 289.603 80.365 274.703C68.1936 271.555 57.6311 267.761 47.99 263.115C40.9507 259.722 38.6823 256.002 27.824 255.582C26.816 255.808 25.8593 256.059 24.9724 256.329C22.2867 225.615 36.144 194.75 50.5974 168.344C30.2548 152.877 20.2597 143.275 9.59936 118.911C-0.660435 95.4629 -3.88523 67.428 5.83862 43.2017C13.4066 23.9125 28.3537 8.43671 47.3689 0.20468ZM199.965 174.918C198.364 165.857 189.749 159.788 180.675 161.332C171.525 162.89 165.395 171.598 167.005 180.739C168.62 189.879 177.365 195.96 186.5 194.289C195.55 192.633 201.565 183.979 199.965 174.918ZM128.599 161.347C120.507 159.531 112.3 163.89 109.274 171.612C108.017 174.82 107.777 178.337 108.586 181.686C110.533 189.748 118.071 195.184 126.336 194.485C134.6 193.786 141.118 187.162 141.683 178.887C142.249 170.613 136.692 163.164 128.599 161.347ZM262.3 117.085C261.634 94.6836 247.099 63.673 225.354 65.0582C224.845 65.0897 224.339 65.1266 223.83 65.1685C209.08 72.2057 197.865 99.588 191.255 117.718C190.325 119.71 189.354 123.748 189.179 126.962L189.694 127.821C192.954 127.676 203.874 121.28 207.554 119.913C213.529 117.696 218.275 116.116 224.8 115.534C235.324 115.489 241.365 117.05 250.915 121.668C256.53 124.383 262.664 129.248 262.3 117.085ZM93.2605 65.108C90.6937 63.8213 87.4802 63.9627 84.9294 64.1441C63.3749 70.2763 51.8802 95.0641 52.7224 123.095C52.7689 124.263 53.5808 124.889 54.3152 125.607C58.0322 126.098 71.2004 117.553 76.6384 116.59C84.4266 115.212 87.9264 115.256 95.7996 116.206C100.812 117.322 123.644 128.057 125.413 127.759C125.971 126.434 125.164 123.889 124.471 122.538C117.079 107.119 108.177 73.5861 93.2605 65.108Z");animation-timing-function:cubic-bezier(.42,0,.58,1)}66%{d:path("M26.6433 267.197C45.1327 277.878 75.6447 286.435 101.358 290.367C146.687 297.256 196.097 295.654 238.874 285.905C259.443 281.121 273.961 275.586 288.806 268.009C285.993 282.241 279.806 295.127 268.54 308.402C229.03 350.457 151.035 366.187 97.7947 344.087C67.3069 331.432 37.7979 305.137 28.1169 272.852C27.5527 270.971 27.0636 269.085 26.6433 267.197ZM47.3689 0.20468C80.7091 -3.0015 124.515 32.3146 155.875 46.2232C165.375 41.7758 174.63 36.8241 183.605 31.3902C211.035 14.9719 239.021 -4.81321 272.735 2.00644C285.825 4.68202 297.29 12.5187 304.535 23.7476C317.79 43.9641 318.685 73.8533 314.085 97.1842C309.63 119.773 297.83 141.189 280.615 156.548C276.05 160.619 270.65 164.026 265.5 167.39C280.314 183.136 288.75 212.782 290.245 234.152C290.778 241.779 290.884 248.889 290.417 255.633C286.146 255.342 281.211 256.355 277.984 258.497C273.711 261.331 266.218 264.926 261.065 266.943C210.169 286.514 138.268 289.603 80.365 274.703C68.1936 271.555 57.6311 267.761 47.99 263.115C40.9507 259.722 38.6823 256.002 27.824 255.582C26.816 255.808 25.8593 256.059 24.9724 256.329C22.2867 225.615 36.144 194.75 50.5974 168.344C30.2548 152.877 20.2597 143.275 9.59936 118.911C-0.660435 95.4629 -3.88523 67.428 5.83862 43.2017C13.4066 23.9125 28.3537 8.43671 47.3689 0.20468ZM199.965 174.918C198.364 165.857 189.749 159.788 180.675 161.332C171.525 162.89 165.395 171.598 167.005 180.739C168.62 189.879 177.365 195.96 186.5 194.289C195.55 192.633 201.565 183.979 199.965 174.918ZM128.599 161.347C120.507 159.531 112.3 163.89 109.274 171.612C108.017 174.82 107.777 178.337 108.586 181.686C110.533 189.748 118.071 195.184 126.336 194.485C134.6 193.786 141.118 187.162 141.683 178.887C142.249 170.613 136.692 163.164 128.599 161.347ZM262.3 115.085C261.634 96.6836 247.099 68.673 225.354 70.0582C224.845 70.0897 224.339 70.1266 223.83 70.1685C209.08 76.2057 197.865 101.588 191.255 115.718C190.325 117.71 189.354 120.748 189.179 122.962L189.694 123.821C192.954 123.676 203.874 118.28 207.554 116.913C213.529 114.696 218.275 113.116 224.8 112.534C235.324 112.489 241.365 114.05 250.915 118.668C256.53 121.383 262.664 125.248 262.3 115.085ZM93.2605 71.108C90.6937 69.8213 87.4802 69.9627 84.9294 70.1441C63.3749 75.2763 51.8802 98.0641 52.7224 119.095C52.7689 120.263 53.5808 120.889 54.3152 121.607C58.0322 122.098 71.2004 114.553 76.6384 113.59C84.4266 112.212 87.9264 112.256 95.7996 113.206C100.812 114.322 123.644 124.057 125.413 123.759C125.971 122.434 125.164 119.889 124.471 118.538C117.079 104.119 108.177 78.5861 93.2605 71.108Z");animation-timing-function:cubic-bezier(.12,0,.39,0)}67.5%,68.5%{d:path("M26.6433 267.197C45.1327 277.878 75.6447 286.435 101.358 290.367C146.687 297.256 196.097 295.654 238.874 285.905C259.443 281.121 273.961 275.586 288.806 268.009C285.993 282.241 279.806 295.127 268.54 308.402C229.03 350.457 151.035 366.187 97.7947 344.087C67.3069 331.432 37.7979 305.137 28.1169 272.852C27.5527 270.971 27.0636 269.085 26.6433 267.197ZM47.3689 0.20468C80.7091 -3.0015 124.515 32.3146 155.875 46.2232C165.375 41.7758 174.63 36.8241 183.605 31.3902C211.035 14.9719 239.021 -4.81321 272.735 2.00644C285.825 4.68202 297.29 12.5187 304.535 23.7476C317.79 43.9641 318.685 73.8533 314.085 97.1842C309.63 119.773 297.83 141.189 280.615 156.548C276.05 160.619 270.65 164.026 265.5 167.39C280.314 183.136 288.75 212.782 290.245 234.152C290.778 241.779 290.884 248.889 290.417 255.633C286.146 255.342 281.211 256.355 277.984 258.497C273.711 261.331 266.218 264.926 261.065 266.943C210.169 286.514 138.268 289.603 80.365 274.703C68.1936 271.555 57.6311 267.761 47.99 263.115C40.9507 259.722 38.6823 256.002 27.824 255.582C26.816 255.808 25.8593 256.059 24.9724 256.329C22.2867 225.615 36.144 194.75 50.5974 168.344C30.2548 152.877 20.2597 143.275 9.59936 118.911C-0.660435 95.4629 -3.88523 67.428 5.83862 43.2017C13.4066 23.9125 28.3537 8.43671 47.3689 0.20468ZM199.965 174.918C198.364 165.857 189.749 159.788 180.675 161.332C171.525 162.89 165.395 171.598 167.005 180.739C168.62 189.879 177.365 195.96 186.5 194.289C195.55 192.633 201.565 183.979 199.965 174.918ZM128.599 161.347C120.507 159.531 112.3 163.89 109.274 171.612C108.017 174.82 107.777 178.337 108.586 181.686C110.533 189.748 118.071 195.184 126.336 194.485C134.6 193.786 141.118 187.162 141.683 178.887C142.249 170.613 136.692 163.164 128.599 161.347ZM262.3 100.085C261.634 97.6836 247.099 93.673 225.354 94.0582C224.845 94.0897 224.339 94.1266 223.83 94.1685C209.08 95.2057 197.865 97.588 191.255 100.718C190.325 101.71 189.354 102.748 189.179 103.962L189.694 104.821C192.954 104.676 203.874 102.28 207.554 101.913C213.529 101.696 218.275 101.116 224.8 100.534C235.324 100.489 241.365 101.05 250.915 102.668C256.53 103.383 262.664 104.248 262.3 100.085ZM93.2605 71.108C90.6937 69.8213 87.4802 69.9627 84.9294 70.1441C63.3749 75.2763 51.8802 98.0641 52.7224 119.095C52.7689 120.263 53.5808 120.889 54.3152 121.607C58.0322 122.098 71.2004 114.553 76.6384 113.59C84.4266 112.212 87.9264 112.256 95.7996 113.206C100.812 114.322 123.644 124.057 125.413 123.759C125.971 122.434 125.164 119.889 124.471 118.538C117.079 104.119 108.177 78.5861 93.2605 71.108Z");animation-timing-function:cubic-bezier(.61,1,.88,1)}}
          </style>
          <g class="bk-bokito-wink-g">
          <g class="bk-bokito-g">
            <path class="bk-bokito-f" d="M26.6433 267.197C45.1327 277.878 75.6447 286.435 101.358 290.367C146.687 297.256 196.097 295.654 238.874 285.905C259.443 281.121 273.961 275.586 288.806 268.009C285.993 282.241 279.806 295.127 268.54 308.402C229.03 350.457 151.035 366.187 97.7947 344.087C67.3069 331.432 37.7979 305.137 28.1169 272.852C27.5527 270.971 27.0636 269.085 26.6433 267.197ZM47.3689 0.20468C80.7091 -3.0015 124.515 32.3146 155.875 46.2232C165.375 41.7758 174.63 36.8241 183.605 31.3902C211.035 14.9719 239.021 -4.81321 272.735 2.00644C285.825 4.68202 297.29 12.5187 304.535 23.7476C317.79 43.9641 318.685 73.8533 314.085 97.1842C309.63 119.773 297.83 141.189 280.615 156.548C276.05 160.619 270.65 164.026 265.5 167.39C280.314 183.136 288.75 212.782 290.245 234.152C290.778 241.779 290.884 248.889 290.417 255.633C286.146 255.342 281.211 256.355 277.984 258.497C273.711 261.331 266.218 264.926 261.065 266.943C210.169 286.514 138.268 289.603 80.365 274.703C68.1936 271.555 57.6311 267.761 47.99 263.115C40.9507 259.722 38.6823 256.002 27.824 255.582C26.816 255.808 25.8593 256.059 24.9724 256.329C22.2867 225.615 36.144 194.75 50.5974 168.344C30.2548 152.877 20.2597 143.275 9.59936 118.911C-0.660435 95.4629 -3.88523 67.428 5.83862 43.2017C13.4066 23.9125 28.3537 8.43671 47.3689 0.20468ZM199.965 174.918C198.364 165.857 189.749 159.788 180.675 161.332C171.525 162.89 165.395 171.598 167.005 180.739C168.62 189.879 177.365 195.96 186.5 194.289C195.55 192.633 201.565 183.979 199.965 174.918ZM128.599 161.347C120.507 159.531 112.3 163.89 109.274 171.612C108.017 174.82 107.777 178.337 108.586 181.686C110.533 189.748 118.071 195.184 126.336 194.485C134.6 193.786 141.118 187.162 141.683 178.887C142.249 170.613 136.692 163.164 128.599 161.347ZM262.3 115.085C261.634 96.6836 247.099 68.673 225.354 70.0582C224.845 70.0897 224.339 70.1266 223.83 70.1685C209.08 76.2057 197.865 101.588 191.255 115.718C190.325 117.71 189.354 120.748 189.179 122.962L189.694 123.821C192.954 123.676 203.874 118.28 207.554 116.913C213.529 114.696 218.275 113.116 224.8 112.534C235.324 112.489 241.365 114.05 250.915 118.668C256.53 121.383 262.664 125.248 262.3 115.085ZM93.2605 71.108C90.6937 69.8213 87.4802 69.9627 84.9294 70.1441C63.3749 75.2763 51.8802 98.0641 52.7224 119.095C52.7689 120.263 53.5808 120.889 54.3152 121.607C58.0322 122.098 71.2004 114.553 76.6384 113.59C84.4266 112.212 87.9264 112.256 95.7996 113.206C100.812 114.322 123.644 124.057 125.413 123.759C125.971 122.434 125.164 119.889 124.471 118.538C117.079 104.119 108.177 78.5861 93.2605 71.108Z" fill="currentColor"/>
          </g>
          </g>
        </svg>
        ${ICONS.close.replace('<svg ', '<svg class="bk-launcher-icon bk-launcher-icon--close" ')}
        <span class="bk-badge" style="display:none"></span>
      </button>
      <div class="bk-proactive-bubbles" hidden></div>
      <div class="bk-window" style="display:none">
        <div class="bk-header">
          <button class="bk-icon-btn bk-btn-back" title="Back to menu" aria-label="Back to menu" hidden>
            ${ICONS.back}
          </button>
          <div class="bk-header-avatar">
            <img class="bk-header-avatar-img" alt="" hidden />
            ${MONKEY_MARK}
          </div>
          <div class="bk-header-info">
            <div class="bk-header-name">Bokito AI</div>
            <div class="bk-header-status">Online</div>
          </div>
          <div class="bk-header-actions">
            <div class="bk-chat-actions">
              <button class="bk-icon-btn bk-btn-more" title="Chat actions" aria-label="Chat actions" aria-expanded="false">
                ${ICONS.more}
              </button>
              <div class="bk-chat-actions-menu" hidden>
                <button class="bk-chat-actions-item" type="button" data-action="stop">Stop generating</button>
                <button class="bk-chat-actions-item" type="button" data-action="archive">Archive</button>
                <button class="bk-chat-actions-item" type="button" data-action="delete">Delete</button>
                <button class="bk-chat-actions-item" type="button" data-action="export">Export</button>
              </div>
            </div>
            <div class="bk-user-wrap">
              <button type="button" class="bk-header-user" title="Account" aria-label="Account" aria-expanded="false" aria-haspopup="true">
                ${ICONS.user}
              </button>
              <div class="bk-user-popover" hidden></div>
            </div>
          </div>
        </div>
        <div class="bk-login-required" style="display:none">
          <div class="bk-login-icon">
            ${ICONS.lock}
          </div>
          <div class="bk-login-title">Sign in required</div>
          <div class="bk-login-sub">Sign in on this website to chat with the assistant.</div>
          <div class="bk-login-links">
            <a class="bk-login-signin" href="#" hidden>Sign in</a>
          </div>
        </div>
        <div class="bk-home" style="display:none">
          <div class="bk-home-content">
            <div class="bk-home-tab" data-tab="home">
              <div class="bk-home-hero">
                <div class="bk-home-hero-title">Hi!</div>
                <div class="bk-home-hero-sub">Hoe kunnen we je helpen?</div>
              </div>
              <button class="bk-home-new-btn">
                <div class="bk-home-new-btn-icon">
                  ${ICONS.chat}
                </div>
                <span>Start new conversation</span>
              </button>
            </div>
            <div class="bk-home-tab" data-tab="messages" hidden>
              <div class="bk-home-section">
                <div class="bk-conv-list"></div>
              </div>
            </div>
            <div class="bk-home-tab" data-tab="help" hidden>
              <div class="bk-home-section">
                <div class="bk-help-list-view">
                  <input class="bk-help-search" type="text" placeholder="Search articles">
                  <div class="bk-help-list"></div>
                </div>
                <div class="bk-help-article" hidden>
                  <button type="button" class="bk-help-back">
                    ${ICONS.back}
                    All articles
                  </button>
                  <div class="bk-help-article-title"></div>
                  <div class="bk-help-article-body"></div>
                </div>
              </div>
            </div>
            <div class="bk-home-tab" data-tab="tools" hidden>
              <div class="bk-home-section">
                <div class="bk-tools-intro">Available tools for this assistant</div>
                <div class="bk-toolbox-pills"></div>
                <div class="bk-tools-empty" hidden>No tools available yet.</div>
              </div>
            </div>
          </div>
          <div class="bk-home-footer">
            <nav class="bk-tab-nav" role="tablist">
              <button type="button" class="bk-tab-btn is-active" data-tab="home" role="tab" aria-selected="true" aria-label="Home">
                ${ICONS.home}
                <span class="bk-tab-label">Home</span>
              </button>
              <button type="button" class="bk-tab-btn" data-tab="messages" role="tab" aria-selected="false" aria-label="Messages">
                ${ICONS.messages}
                <span class="bk-tab-label">Messages</span>
                <span class="bk-tab-badge" hidden>0</span>
              </button>
              <button type="button" class="bk-tab-btn" data-tab="help" role="tab" aria-selected="false" aria-label="Help" hidden>
                ${ICONS.help}
                <span class="bk-tab-label">Help</span>
              </button>
              <button type="button" class="bk-tab-btn" data-tab="tools" role="tab" aria-selected="false" aria-label="Tools">
                ${ICONS.tools}
                <span class="bk-tab-label">Tools</span>
              </button>
            </nav>
          </div>
        </div>
        <div class="bk-chat-view" style="display:none">
          <div class="bk-agent-banner" style="display:none">
            ${ICONS.user}
            <span>A team member is helping you</span>
          </div>
          <div class="bk-offline-banner" style="display:none">
            ${ICONS.clock}
            <span class="bk-offline-text">We are currently offline. Leave a message and we will get back to you.</span>
          </div>
          <div class="bk-messages">
            <div class="bk-thinking" style="display:none">
              <div class="bk-thinking-dots">
                <div class="bk-thinking-dot"></div>
                <div class="bk-thinking-dot"></div>
                <div class="bk-thinking-dot"></div>
                <span class="bk-thinking-label">Working...</span>
              </div>
              <div class="bk-thinking-steps"></div>
            </div>
          </div>
          <div class="bk-suggestions"></div>
          <div class="bk-preview-strip" style="display:none"></div>
          <div class="bk-inputbar">
            <div class="bk-inputbar-inner">
              <button class="bk-attach-btn" type="button" aria-label="Attach image">
                ${ICONS.attach}
              </button>
              <input class="bk-file-input" type="file" accept="image/jpeg,image/png,image/gif,image/webp" multiple style="display:none">
              <textarea class="bk-textarea" placeholder="Ask a question..." rows="1" maxlength="4000"></textarea>
              <div class="bk-record-actions" hidden>
                <button type="button" class="bk-record-btn bk-record-cancel" aria-label="Cancel recording">
                  ${ICONS.close}
                </button>
                <button type="button" class="bk-record-btn bk-record-confirm bk-record-confirm--recording" aria-label="Send recording">
                  <svg class="bk-record-wave" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <rect class="bk-wave-bar" x="1" y="16" width="3" height="8" rx="1.5"/>
                    <rect class="bk-wave-bar" x="6" y="8" width="3" height="16" rx="1.5"/>
                    <rect class="bk-wave-bar" x="11" y="4" width="3" height="20" rx="1.5"/>
                    <rect class="bk-wave-bar" x="16" y="12" width="3" height="12" rx="1.5"/>
                    <rect class="bk-wave-bar" x="21" y="18" width="3" height="6" rx="1.5"/>
                  </svg>
                </button>
              </div>
              <button type="button" class="bk-record-btn bk-record-start" aria-label="Record voice" hidden>
                ${ICONS.mic}
              </button>
              <button class="bk-send-btn" disabled aria-label="Send">
                ${ICONS.send}
              </button>
            </div>
          </div>
        </div>
        <div class="bk-settings" style="display:none">
          <div class="bk-settings-inner">
            <h2 class="bk-settings-title">Settings</h2>
            <section class="bk-settings-section">
              <h3 class="bk-settings-section-title">Appearance</h3>
              <div class="bk-settings-option">
                <span class="bk-settings-label">Theme</span>
                <div class="bk-settings-options-row" role="radiogroup" aria-label="Theme">
                  <label class="bk-settings-radio"><input type="radio" name="bk-theme" value="light"> Light</label>
                  <label class="bk-settings-radio"><input type="radio" name="bk-theme" value="dark"> Dark</label>
                  <label class="bk-settings-radio"><input type="radio" name="bk-theme" value="system"> System</label>
                </div>
              </div>
            </section>
            <section class="bk-settings-section">
              <h3 class="bk-settings-section-title">Sound</h3>
              <div class="bk-settings-option bk-settings-toggle-wrap">
                <span class="bk-settings-label">Sound effects</span>
                <label class="bk-settings-toggle">
                  <input type="checkbox" id="bk-sound-effects-pref" checked>
                  <span class="bk-settings-toggle-slider"></span>
                </label>
              </div>
              <div class="bk-settings-option bk-settings-toggle-wrap">
                <span class="bk-settings-label">Notification sounds</span>
                <label class="bk-settings-toggle">
                  <input type="checkbox" id="bk-sound-notifications-pref" checked>
                  <span class="bk-settings-toggle-slider"></span>
                </label>
              </div>
            </section>
          </div>
        </div>
        <div class="bk-image-viewer" hidden>
          <button class="bk-image-viewer-close" type="button" aria-label="Close image">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
          <img alt="Enlarged image" />
        </div>
        <a class="bk-window-powered" href="https://bokito.ai" target="_blank" rel="noopener noreferrer" hidden aria-label="Open Bokito AI website">
          <span>Powered by</span>
          <strong>Bokito AI</strong>
        </a>
      </div>
    `;
    while (div.firstChild) this.#root.appendChild(div.firstChild);

    this.#launcher          = this.#root.querySelector('.bk-launcher');
    this.#badge             = this.#root.querySelector('.bk-badge');
    this.#proactiveBubbles  = this.#root.querySelector('.bk-proactive-bubbles');
    this.#window            = this.#root.querySelector('.bk-window');
    this.#loginRequiredView = this.#root.querySelector('.bk-login-required');
    this.#homeView          = this.#root.querySelector('.bk-home');
    this.#chatView          = this.#root.querySelector('.bk-chat-view');
    this.#messageList       = this.#root.querySelector('.bk-messages');
    this.#thinkingEl        = this.#root.querySelector('.bk-thinking');
    this.#thinkingSteps     = this.#root.querySelector('.bk-thinking-steps');
    this.#thinkingLabel     = this.#root.querySelector('.bk-thinking-label');
    this.#textarea          = this.#root.querySelector('.bk-textarea');
    this.#sendBtn           = this.#root.querySelector('.bk-send-btn');
    this.#recordActionsWrap = this.#root.querySelector('.bk-record-actions');
    this.#recordStartBtn    = this.#root.querySelector('.bk-record-start');
    this.#recordCancelBtn   = this.#root.querySelector('.bk-record-cancel');
    this.#recordConfirmBtn  = this.#root.querySelector('.bk-record-confirm');
    this.#suggChips         = this.#root.querySelector('.bk-suggestions');
    this.#headerName        = this.#root.querySelector('.bk-header-name');
    this.#headerAvatarImg   = this.#root.querySelector('.bk-header-avatar-img');
    this.#toolboxWrap       = null;
    this.#toolboxToggle     = null;
    this.#toolboxMenu       = null;
    this.#toolboxPills      = this.#root.querySelector('.bk-toolbox-pills');
    this.#chatActionsWrap   = this.#root.querySelector('.bk-chat-actions');
    this.#chatActionsBtn    = this.#root.querySelector('.bk-btn-more');
    this.#chatActionsMenu   = this.#root.querySelector('.bk-chat-actions-menu');
    this.#settingsBtn       = null;
    this.#backBtn           = this.#root.querySelector('.bk-btn-back');
    this.#settingsView      = this.#root.querySelector('.bk-settings');
    this.#headerUser        = this.#root.querySelector('.bk-header-user');
    this.#userPopover       = this.#root.querySelector('.bk-user-popover');
    this.#attachBtn         = this.#root.querySelector('.bk-attach-btn');
    this.#fileInput         = this.#root.querySelector('.bk-file-input');
    this.#previewStrip      = this.#root.querySelector('.bk-preview-strip');
    this.#imageViewer       = this.#root.querySelector('.bk-image-viewer');
    this.#imageViewerImg    = this.#root.querySelector('.bk-image-viewer img');
    this.#imageViewerClose  = this.#root.querySelector('.bk-image-viewer-close');
    this.#loginSigninEl     = this.#root.querySelector('.bk-login-signin');

    this.#api = new ApiClient({
      baseUrl: this.#apiUrl,
      agentSlug: this.#agentSlug,
      stateMachine: this.#sm,
      identityTokenGetter: () => this.#identityToken,
      hostAuthTokenGetter: () => this.#hostAuthToken,
      authModeGetter: () => this.#authMode,
      authCookieNameGetter: () => this.#authCookieName,
      tenantSubdomainGetter: () => this.#tenantSubdomain,
      customerIdGetter: () => this.#storGet(LS_CUSTOMER_ID_KEY),
      onSessionExpired: (data) => {
        this.#applySessionPayload(data);
        this.#emitTenantMcpTelemetry('session_refresh');
      },
    });
  }

  #bindEvents() {
    this.#window.addEventListener('animationend', (e) => {
      if (e.animationName === 'bk-window-in') this.#window.classList.remove('is-opening');
      if (e.animationName === 'bk-window-out') {
        this.#window.classList.remove('is-closing');
        if (!this.#isPreviewEmbedded()) this.#window.style.display = 'none';
      }
    });

    this.#launcher.addEventListener('click', (e) => {
      if (this.#isPreviewEmbedded()) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (this.#suppressNextLauncherClick) {
        this.#suppressNextLauncherClick = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (this.#sm.state === 'idle') this.#openWidget();
      else this.#closeWindow();
    });
    this.#chatActionsBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = this.#chatActionsMenu?.hidden;
      if (this.#chatActionsMenu) this.#chatActionsMenu.hidden = !willOpen;
      this.#chatActionsBtn?.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });
    this.#chatActionsMenu?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const action = e.target?.closest?.('[data-action]')?.dataset?.action;
      if (!action) return;
      this.#closeChatActionsMenu();
      if (action === 'stop') { this.#cancelActiveResponse(); return; }
      if (action === 'archive') await this.#archiveCurrentConversation();
      if (action === 'delete') await this.#deleteCurrentConversation();
      if (action === 'export') this.#exportCurrentConversation();
    });
    this.#backBtn?.addEventListener('click', () => {
      if (this.#settingsView && this.#settingsView.style.display !== 'none') {
        this.#hideSettings();
        return;
      }
      this.#showHome();
    });
    this.#headerUser?.addEventListener('click', (e) => {
      e.stopPropagation();
      const popover = this.#userPopover;
      if (!popover) return;
      const willOpen = popover.hidden;
      if (willOpen) {
        this.#renderUserPopoverContent();
        popover.hidden = false;
      } else {
        popover.hidden = true;
      }
      this.#headerUser?.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });
    this.#userPopover?.addEventListener('click', (e) => e.stopPropagation());
    this.#settingsView?.querySelectorAll('input[name="bk-theme"]').forEach((radio) => {
      radio.addEventListener('change', (e) => this.#setUserTheme(e.target.value));
    });
    this.#root.querySelector('#bk-sound-effects-pref')?.addEventListener('change', (e) => {
      this.#setUserSoundEffects(e.target.checked);
    });
    this.#root.querySelector('#bk-sound-notifications-pref')?.addEventListener('change', (e) => {
      this.#setUserSoundNotifications(e.target.checked);
    });
    this.#root.querySelector('.bk-home-new-btn').addEventListener('click', () => this.#startNewConversation());
    this.#root.querySelectorAll('.bk-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        if (tab) this.#switchHomeTab(tab);
      });
    });
    this.#root.querySelector('.bk-help-search')?.addEventListener('input', () => this.#renderHelpList());
    this.#root.querySelector('.bk-help-back')?.addEventListener('click', () => this.#renderHelpList());
    this.#root.addEventListener('click', () => {
      this.#closeChatActionsMenu();
      this.#closeUserPopover();
    });

    this.#attachBtn.addEventListener('click', () => this.#fileInput.click());

    this.#fileInput.addEventListener('change', (e) => {
      if (e.target.files?.length) this.#handleFileSelect(Array.from(e.target.files));
      e.target.value = ''; // reset so same file can be re-selected
    });

    this.#textarea.addEventListener('input', () => {
      this.#markUserTyping();
      this.#textarea.style.height = 'auto';
      this.#textarea.style.height = Math.min(this.#textarea.scrollHeight, 120) + 'px';
      this.#updateSendBtnState();
    });

    this.#textarea.addEventListener('paste', (e) => this.#handlePaste(e));

    this.#textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.#sendMessage(); }
    });

    this.#sendBtn.addEventListener('click', () => this.#sendMessage());
    this.#recordStartBtn?.addEventListener('click', () => this.#startRecording());
    this.#recordCancelBtn?.addEventListener('click', () => this.#cancelRecording());
    this.#recordConfirmBtn?.addEventListener('click', () => this.#confirmRecording());

    if (!this.#isPreviewEmbedded()) {
      this.#initLauncherDrag();
      this.#launcherPosition = this.#readSavedPosition();
      this.#applyLauncherPosition(this.#launcherPosition);
    }
    this.#onWindowResizeBound = () => this.#onWindowResize();
    window.addEventListener('resize', this.#onWindowResizeBound, { passive: true });
    this.#renderHeaderUser();
  }

  #setupStateMachine() {
    this.#sm.on('*', (state) => this.#onStateChange(state));
  }

  #showView(viewName) {
    const views = { home: this.#homeView, chat: this.#chatView, login: this.#loginRequiredView };
    Object.entries(views).forEach(([k, el]) => { if (el) el.style.display = k === viewName ? '' : 'none'; });
    this.#syncWindowPowered();
    this.#updateHeaderActionButtons(this.#sm?.state ?? 'home');
  }

  #syncWindowPowered() {
    const el = this.#root.querySelector('.bk-window-powered');
    if (!el) return;
    const settingsOpen = this.#settingsView && this.#settingsView.style.display !== 'none';
    const homeVisible = this.#homeView && this.#homeView.style.display !== 'none';
    const chatVisible = this.#chatView && this.#chatView.style.display !== 'none';
    el.hidden = settingsOpen || (!homeVisible && !chatVisible);
  }

  #onStateChange(state) {
    const launcher = this.#launcher, win = this.#window;
    this.#closeChatActionsMenu();
    this.#updateHeaderActionButtons(state);
    switch (state) {
      case 'idle':
        this.#clearProcessingWatchdog();
        if (this.#sessionRefreshTimer) {
          clearTimeout(this.#sessionRefreshTimer);
          this.#sessionRefreshTimer = null;
        }
        clearTimeout(this.#typingDebounceTimer);
        this.#typingDebounceTimer = null;
        this.#isUserTyping = false;
        if (!this.#isPreviewEmbedded()) launcher.classList.remove('is-open');
        clearTimeout(this.#bundleTimer);
        this.#bundleTimer = null;
        this.#pendingBundleTextParts = [];
        this.#pendingBundleAttachments = [];
        this.#activeSend?.abortController?.abort();
        this.#activeSend = null;
        this.#isResponding = false;
        this.#sendQueue = [];
        this.#updateQueueTelemetry();
        if (!this.#isPreviewEmbedded()) this.#animateWindowClose();
        this.#realtime?.disconnect();
        this.#stopPolling();
        this.#idleWatcher?.resume();
        break;
      case 'home':
        this.#clearProcessingWatchdog();
        clearTimeout(this.#typingDebounceTimer);
        this.#typingDebounceTimer = null;
        this.#isUserTyping = false;
        launcher.classList.add('is-open');
        this.#dismissProactiveBubbles();
        this.#idleWatcher?.pause();
        this.#animateWindowOpen();
        this.#showView('home');
        this.#loadConversationHistory();
        break;
      case 'connecting':
        this.#showView('chat');
        this.#messageList.innerHTML = '';
        this.#root.querySelector('.bk-agent-banner').style.display = 'none';
        break;
      case 'active':
        this.#clearProcessingWatchdog();
        this.#showView('chat');
        this.#thinkingEl.style.display = 'none';
        this.#thinkingSteps.innerHTML = '';
        this.#updateSendBtnState();
        this.#stopPolling();
        break;
      case 'processing':
        this.#markProcessingActivity();
        this.#armProcessingWatchdog();
        this.#showThinking();
        this.#updateSendBtnState();
        break;
      case 'agent_mode':
        this.#clearProcessingWatchdog();
        this.#showView('chat');
        this.#thinkingEl.style.display = 'none';
        this.#root.querySelector('.bk-agent-banner').style.display = '';
        this.#updateSendBtnState();
        this.#stopPolling();
        break;
      case 'error':
        this.#clearProcessingWatchdog();
        this.#showView('chat');
        this.#thinkingEl.style.display = 'none';
        this.#updateSendBtnState();
        this.#stopPolling();
        break;
      case 'login_required':
        this.#clearProcessingWatchdog();
        launcher.classList.add('is-open');
        this.#dismissProactiveBubbles();
        this.#idleWatcher?.pause();
        this.#animateWindowOpen();
        this.#showView('login');
        break;
    }
  }

  #syncLoginLinks() {
    // Host-platform sign-in only: the widget never collects credentials itself.
    // Configure a sign-in URL via agent config or the data-signin-url attribute.
    if (!this.#loginSigninEl) return;
    const signinUrl =
      this.#agentConfig?.login_url ||
      this.dataset.signinUrl ||
      '';
    if (signinUrl) {
      this.#loginSigninEl.href = signinUrl;
      this.#loginSigninEl.target = '_blank';
      this.#loginSigninEl.rel = 'noopener noreferrer';
      this.#loginSigninEl.hidden = false;
    } else {
      this.#loginSigninEl.hidden = true;
    }
  }

  async #openWidget() {
    if (!this.#isPreviewEmbedded()) this.#playSound('open');
    await this.#refreshHostAuthToken();
    if (!this.#sessionToken) {
      await this.#initSession();
    } else {
      this.#fetchHostUserInfo().catch(() => {});
    }
    if (this.#sm.state === 'login_required') {
      this.dispatchEvent(new CustomEvent('bokito:login-required', {
        bubbles: true,
        composed: true,
        detail: {
          auth_mode: this.#authMode,
          cookie_name: this.#authCookieName || null,
          agent_slug: this.#agentSlug,
        },
      }));
      return;
    }
    this.#sm.transition('home');
  }

  #getLauncherSize() {
    return this.#launcher?.offsetWidth || 58;
  }

  #computeUserInitials(name = '') {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    const first = parts[0][0] || '';
    const last = parts[parts.length - 1][0] || '';
    return (first + last).toUpperCase();
  }

  #computeUserAvatarColor(seed = '') {
    const palette = [
      { bg: '#4652f2', text: '#ffffff' },
      { bg: '#7c3aed', text: '#ffffff' },
      { bg: '#0891b2', text: '#ffffff' },
      { bg: '#0d9488', text: '#ffffff' },
      { bg: '#059669', text: '#ffffff' },
      { bg: '#d97706', text: '#ffffff' },
      { bg: '#dc2626', text: '#ffffff' },
      { bg: '#db2777', text: '#ffffff' },
      { bg: '#9333ea', text: '#ffffff' },
      { bg: '#2563eb', text: '#ffffff' },
      { bg: '#16a34a', text: '#ffffff' },
      { bg: '#ea580c', text: '#ffffff' },
    ];
    const str = String(seed || '');
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    }
    return palette[hash % palette.length];
  }

  #extractUserAvatarUrl(user) {
    if (!user) return '';
    const avatar = user.avatar;
    if (avatar && typeof avatar === 'object') {
      return String(avatar.url || avatar.path || avatar.src || '').trim();
    }
    if (typeof avatar === 'string') return avatar.trim();
    if (typeof user.avatar_url === 'string') return user.avatar_url.trim();
    if (typeof user.profile_picture === 'string') return user.profile_picture.trim();
    return '';
  }

  #renderHeaderUser() {
    const el = this.#headerUser;
    if (!el) return;
    const user = this.#sessionUser;
    const isLoggedIn = !!(user && (user.id || user.email || user.name));

    el.classList.remove('bk-header-user--initials');
    el.style.removeProperty('background');
    el.style.removeProperty('color');
    el.innerHTML = '';

    if (!isLoggedIn) {
      el.title = 'Not signed in';
      el.setAttribute('aria-label', 'Not signed in');
      el.innerHTML = ICONS.user;
      this.#refreshUserPopoverIfOpen();
      return;
    }

    const displayName = String(user.name || user.email || '').trim();
    el.title = displayName || 'Ingelogd';
    el.setAttribute('aria-label', displayName || 'Ingelogd');

    const avatarUrl = this.#extractUserAvatarUrl(user);
    if (avatarUrl) {
      const img = document.createElement('img');
      img.src = avatarUrl;
      img.alt = displayName;
      img.referrerPolicy = 'no-referrer';
      img.onerror = () => {
        img.remove();
        this.#renderHeaderUserInitials(user, displayName);
      };
      el.appendChild(img);
      this.#refreshUserPopoverIfOpen();
      return;
    }

    this.#renderHeaderUserInitials(user, displayName);
    this.#refreshUserPopoverIfOpen();
  }

  #renderHeaderUserInitials(user, displayName) {
    const el = this.#headerUser;
    if (!el) return;
    const initials = this.#computeUserInitials(displayName || user?.email || '');
    const seed = String(user?.email || displayName || user?.id || '');
    const { bg, text } = this.#computeUserAvatarColor(seed);
    el.classList.add('bk-header-user--initials');
    el.style.background = bg;
    el.style.color = text;
    el.textContent = initials;
  }

  #refreshUserPopoverIfOpen() {
    if (this.#userPopover && !this.#userPopover.hidden) {
      this.#renderUserPopoverContent();
    }
  }

  #closeUserPopover() {
    if (!this.#userPopover || this.#userPopover.hidden) return;
    this.#userPopover.hidden = true;
    this.#headerUser?.setAttribute('aria-expanded', 'false');
  }

  #renderUserPopoverContent() {
    const el = this.#userPopover;
    if (!el) return;
    el.innerHTML = '';
    const user = this.#sessionUser;
    const isLoggedIn = !!(user && (user.id || user.email || user.name));

    const header = document.createElement('div');
    header.className = 'bk-user-popover-header';

    const avatar = document.createElement('div');
    avatar.className = 'bk-user-popover-avatar';
    if (isLoggedIn) {
      const url = this.#extractUserAvatarUrl(user);
      const displayName = String(user.name || user.email || '').trim();
      if (url) {
        const img = document.createElement('img');
        img.src = url;
        img.alt = displayName;
        img.referrerPolicy = 'no-referrer';
        img.onerror = () => { img.remove(); this.#fillPopoverAvatarInitials(avatar, user, displayName); };
        avatar.appendChild(img);
      } else {
        this.#fillPopoverAvatarInitials(avatar, user, displayName);
      }
    } else {
      avatar.innerHTML = ICONS.user;
    }

    const info = document.createElement('div');
    info.className = 'bk-user-popover-info';
    if (isLoggedIn) {
      const labelEl = document.createElement('div');
      labelEl.className = 'bk-user-popover-label';
      labelEl.textContent = 'Ingelogd als';
      info.appendChild(labelEl);
    }
    const nameEl = document.createElement('div');
    nameEl.className = 'bk-user-popover-name';
    nameEl.textContent = isLoggedIn
      ? String(user.name || user.email || 'Ingelogd')
      : 'Not signed in';
    info.appendChild(nameEl);
    if (isLoggedIn && user.email && user.email !== user.name) {
      const emailEl = document.createElement('div');
      emailEl.className = 'bk-user-popover-email';
      emailEl.textContent = String(user.email);
      info.appendChild(emailEl);
    }

    header.appendChild(avatar);
    header.appendChild(info);
    el.appendChild(header);

    const themeRow = document.createElement('div');
    themeRow.className = 'bk-user-popover-theme';
    const themeBtn = document.createElement('button');
    themeBtn.type = 'button';
    themeBtn.className = 'bk-user-popover-btn bk-user-popover-theme-btn';
    const themeIcon = document.createElement('span');
    themeIcon.className = 'bk-user-popover-theme-icon';
    themeIcon.setAttribute('aria-hidden', 'true');
    const themeCaption = document.createElement('span');
    themeCaption.className = 'bk-user-popover-theme-caption';
    themeBtn.appendChild(themeIcon);
    themeBtn.appendChild(themeCaption);
    themeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const dark = this.#effectiveUserThemeIsDark();
      this.#setUserTheme(dark ? 'light' : 'dark');
    });
    themeRow.appendChild(themeBtn);
    el.appendChild(themeRow);

    const actions = document.createElement('div');
    actions.className = 'bk-user-popover-actions';

    if (!isLoggedIn) {
      const empty = document.createElement('div');
      empty.className = 'bk-user-popover-empty';
      empty.textContent = 'Log in om je account te zien.';
      actions.appendChild(empty);
    }

    const settingsBtn = document.createElement('button');
    settingsBtn.type = 'button';
    settingsBtn.className = 'bk-user-popover-btn';
    settingsBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-.4-1 1.7 1.7 0 0 0-1-.6 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1-.4H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1-.4 1.7 1.7 0 0 0 .6-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6c.38 0 .74-.14 1-.4.26-.26.4-.62.4-1V3a2 2 0 1 1 4 0v.1c0 .38.14.74.4 1 .26.26.62.4 1 .4.7 0 1.37-.28 1.87-.78l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c0 .38.14.74.4 1 .26.26.62.4 1 .4h.1a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1 .4c-.26.26-.4.62-.4 1z"/></svg><span>Settings</span>';
    settingsBtn.addEventListener('click', () => {
      this.#closeUserPopover();
      this.#showSettings();
    });
    actions.appendChild(settingsBtn);

    if (isLoggedIn) {
      const logoutBtn = document.createElement('button');
      logoutBtn.type = 'button';
      logoutBtn.className = 'bk-user-popover-btn bk-user-popover-btn--danger';
      logoutBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg><span>Sign out</span>';
      logoutBtn.addEventListener('click', async () => {
        this.#closeUserPopover();
        try { await this.logout(); } catch {}
      });
      actions.appendChild(logoutBtn);
    }

    el.appendChild(actions);
    this.#syncUserPopoverThemeToggle();
  }

  #fillPopoverAvatarInitials(avatar, user, displayName) {
    const initials = this.#computeUserInitials(displayName || user?.email || '');
    const seed = String(user?.email || displayName || user?.id || '');
    const { bg, text } = this.#computeUserAvatarColor(seed);
    avatar.style.background = bg;
    avatar.style.color = text;
    avatar.textContent = initials;
  }

  #clampPosition(pos) {
    const margin = WIDGET_BASE_MARGIN;
    const size = this.#getLauncherSize();
    const safeOffset = (axis) => {
      const span = (axis === 'x' ? window.innerWidth : window.innerHeight) - 2 * margin - size;
      return Math.max(0, Math.min(Number.isFinite(pos.offset) ? pos.offset : 0, Math.max(0, span)));
    };
    if (pos?.edge === 'right') return { edge: 'right', offset: safeOffset('y') };
    return { edge: 'bottom', offset: safeOffset('x') };
  }

  #readSavedPosition() {
    try {
      const raw = this.#storGet(LS_WIDGET_POSITION_KEY);
      if (!raw) return { edge: 'bottom', offset: 0 };
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return { edge: 'bottom', offset: 0 };
      const edge = parsed.edge === 'right' ? 'right' : 'bottom';
      const offset = Number(parsed.offset);
      return this.#clampPosition({ edge, offset: Number.isFinite(offset) ? offset : 0 });
    } catch {
      return { edge: 'bottom', offset: 0 };
    }
  }

  #savePosition(pos) {
    try {
      const clean = this.#clampPosition(pos);
      this.#storSet(LS_WIDGET_POSITION_KEY, JSON.stringify({
        edge: clean.edge,
        offset: clean.offset,
        savedAt: Date.now(),
      }));
    } catch {}
  }

  #applyLauncherPosition(pos) {
    if (!this.#launcher) return;
    const clean = this.#clampPosition(pos || this.#launcherPosition);
    this.#launcherPosition = clean;
    const margin = WIDGET_BASE_MARGIN;
    const size = this.#getLauncherSize();

    const launcherStyle = this.#launcher.style;
    launcherStyle.removeProperty('top');
    launcherStyle.removeProperty('left');
    if (clean.edge === 'bottom') {
      launcherStyle.bottom = `${margin}px`;
      launcherStyle.right = `${margin + clean.offset}px`;
    } else {
      launcherStyle.right = `${margin}px`;
      launcherStyle.bottom = `${margin + clean.offset}px`;
    }

    if (this.#proactiveBubbles) {
      const bubbles = this.#proactiveBubbles.style;
      bubbles.removeProperty('top');
      bubbles.removeProperty('left');
      if (clean.edge === 'bottom') {
        const launcherCenterX = window.innerWidth - margin - clean.offset - size / 2;
        const onLeftHalf = launcherCenterX < window.innerWidth / 2;
        bubbles.bottom = `${margin + (size - 50) / 2}px`;
        if (onLeftHalf) {
          bubbles.removeProperty('right');
          bubbles.left = `${margin + clean.offset + size + 10}px`;
        } else {
          bubbles.removeProperty('left');
          bubbles.right = `${margin + clean.offset + size + 10}px`;
        }
      } else {
        const launcherCenterY = window.innerHeight - margin - clean.offset - size / 2;
        const onTopHalf = launcherCenterY < window.innerHeight / 2;
        bubbles.right = `${margin + (size - 50) / 2}px`;
        bubbles.removeProperty('left');
        if (onTopHalf) {
          bubbles.removeProperty('bottom');
          bubbles.top = `${window.innerHeight - margin - clean.offset - size - 10 - 50}px`;
        } else {
          bubbles.removeProperty('top');
          bubbles.bottom = `${margin + clean.offset + size + 10}px`;
        }
      }
    }
  }

  #cursorToPosition(clientX, clientY) {
    const margin = WIDGET_BASE_MARGIN;
    const size = this.#getLauncherSize();
    const distFromBottom = window.innerHeight - clientY;
    const distFromRight = window.innerWidth - clientX;
    const useBottomEdge = distFromBottom <= distFromRight;
    if (useBottomEdge) {
      const offset = window.innerWidth - clientX - margin - size / 2;
      return this.#clampPosition({ edge: 'bottom', offset });
    }
    const offset = window.innerHeight - clientY - margin - size / 2;
    return this.#clampPosition({ edge: 'right', offset });
  }

  #initLauncherDrag() {
    if (!this.#launcher) return;
    const launcher = this.#launcher;
    launcher.addEventListener('pointerdown', (e) => {
      if (e.button != null && e.button !== 0) return;
      if (this.#sm.state !== 'idle') return;
      this.#dragState = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
      };
      try { launcher.setPointerCapture(e.pointerId); } catch {}
    });

    launcher.addEventListener('pointermove', (e) => {
      const drag = this.#dragState;
      if (!drag || drag.pointerId !== e.pointerId) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < WIDGET_DRAG_THRESHOLD) return;
      if (!drag.moved) {
        drag.moved = true;
        launcher.classList.add('is-dragging');
        if (this.#proactiveBubbles && !this.#proactiveBubbles.hidden) {
          this.#dismissProactiveBubbles({ resumeWatcher: true });
        }
      }
      const next = this.#cursorToPosition(e.clientX, e.clientY);
      this.#applyLauncherPosition(next);
    });

    const endDrag = (e) => {
      const drag = this.#dragState;
      if (!drag || drag.pointerId !== e.pointerId) return;
      this.#dragState = null;
      try { launcher.releasePointerCapture(e.pointerId); } catch {}
      if (drag.moved) {
        launcher.classList.remove('is-dragging');
        this.#suppressNextLauncherClick = true;
        this.#savePosition(this.#launcherPosition);
        setTimeout(() => { this.#suppressNextLauncherClick = false; }, 0);
      }
    };
    launcher.addEventListener('pointerup', endDrag);
    launcher.addEventListener('pointercancel', endDrag);
  }

  #onWindowResize() {
    if (this.#isPreviewEmbedded()) return;
    if (!this.#launcher) return;
    const before = this.#launcherPosition;
    const after = this.#clampPosition(before);
    this.#applyLauncherPosition(after);
    if (after.edge !== before.edge || Math.abs(after.offset - before.offset) > 0.5) {
      this.#savePosition(after);
    }
  }

  #computeWindowAnchor() {
    if (this.#isPreviewEmbedded()) return;
    if (!this.#window || !this.#launcher) return;
    if (window.innerWidth <= 480) {
      const ws = this.#window.style;
      ws.removeProperty('top');
      ws.removeProperty('left');
      ws.removeProperty('right');
      ws.removeProperty('bottom');
      ws.removeProperty('transform-origin');
      return;
    }
    const rect = this.#launcher.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 12;
    const safeMargin = 12;

    const winRect = this.#window.getBoundingClientRect();
    let winW = winRect.width;
    let winH = winRect.height;
    if (!winW || !winH) {
      winW = Math.min(400, vw - 32);
      winH = Math.min(640, vh - 80);
    }

    const launcherCenterX = rect.left + rect.width / 2;
    const launcherCenterY = rect.top + rect.height / 2;

    const horizontalSide = launcherCenterX > vw / 2 ? 'right' : 'left';
    const verticalSide = launcherCenterY > vh / 2 ? 'bottom' : 'top';

    const ws = this.#window.style;
    ws.removeProperty('top');
    ws.removeProperty('left');
    ws.removeProperty('right');
    ws.removeProperty('bottom');

    let verticalClamped = false;
    if (verticalSide === 'bottom') {
      const desired = vh - rect.top + gap;
      const maxBottom = vh - winH - safeMargin;
      const bottom = Math.max(safeMargin, Math.min(desired, maxBottom));
      verticalClamped = bottom < desired - 0.5;
      ws.bottom = `${bottom}px`;
      ws.top = 'auto';
    } else {
      const desired = rect.bottom + gap;
      const maxTop = vh - winH - safeMargin;
      const top = Math.max(safeMargin, Math.min(desired, maxTop));
      verticalClamped = top < desired - 0.5;
      ws.top = `${top}px`;
      ws.bottom = 'auto';
    }

    let horizontalSideEffective = horizontalSide;
    let horizontalAnchor;
    if (horizontalSide === 'right') {
      horizontalAnchor = vw - rect.right;
    } else {
      horizontalAnchor = rect.left;
    }

    if (verticalClamped) {
      if (horizontalSide === 'right') {
        const besideAnchor = vw - rect.left + gap;
        const maxRight = vw - winW - safeMargin;
        if (besideAnchor <= maxRight) {
          horizontalAnchor = besideAnchor;
        } else {
          const altLeft = rect.right + gap;
          const maxLeft = vw - winW - safeMargin;
          if (altLeft <= maxLeft) {
            horizontalSideEffective = 'left';
            horizontalAnchor = altLeft;
          }
        }
      } else {
        const besideAnchor = rect.right + gap;
        const maxLeft = vw - winW - safeMargin;
        if (besideAnchor <= maxLeft) {
          horizontalAnchor = besideAnchor;
        } else {
          const altRight = vw - rect.left + gap;
          const maxRight = vw - winW - safeMargin;
          if (altRight <= maxRight) {
            horizontalSideEffective = 'right';
            horizontalAnchor = altRight;
          }
        }
      }
    }

    if (horizontalSideEffective === 'right') {
      const maxRight = vw - winW - safeMargin;
      const right = Math.max(safeMargin, Math.min(horizontalAnchor, maxRight));
      ws.right = `${right}px`;
      ws.left = 'auto';
    } else {
      const maxLeft = vw - winW - safeMargin;
      const left = Math.max(safeMargin, Math.min(horizontalAnchor, maxLeft));
      ws.left = `${left}px`;
      ws.right = 'auto';
    }

    ws.transformOrigin = `${verticalSide} ${horizontalSideEffective}`;
  }

  #animateWindowOpen() {
    clearTimeout(this.#windowCloseTimer);
    this.#window.style.display = '';
    this.#window.classList.remove('is-closing');
    this.#computeWindowAnchor();
    void this.#window.offsetWidth;
    this.#window.classList.add('is-opening');
  }

  #animateWindowClose() {
    if (this.#isPreviewEmbedded()) return;
    clearTimeout(this.#windowCloseTimer);
    if (this.#window.style.display === 'none') return;
    this.#window.classList.remove('is-opening');
    this.#window.classList.add('is-closing');
    this.#windowCloseTimer = setTimeout(() => {
      this.#window.classList.remove('is-closing');
      this.#window.style.display = 'none';
    }, 220);
  }

  #renderToolbox() {
    const pills = this.#toolboxPills;
    if (!pills) return;
    const emptyEl = this.#root.querySelector('.bk-tools-empty');
    const labels = Object.values(this._toolDisplayNames || {}).filter(Boolean);
    pills.innerHTML = '';
    if (!labels.length) {
      if (emptyEl) emptyEl.hidden = false;
      return;
    }
    if (emptyEl) emptyEl.hidden = true;
    labels.sort((a, b) => String(a).localeCompare(String(b), 'nl', { sensitivity: 'base' }));
    labels.forEach((label) => {
      const el = document.createElement('span');
      el.className = 'bk-tool-pill';
      el.textContent = String(label);
      pills.appendChild(el);
    });
  }

  #applySessionPayload(data = {}) {
    if (!data || typeof data !== 'object') return;
    if (data.session_token) {
      this.#sessionToken = data.session_token;
      this.#api.setToken(data.session_token);
    }
    this.#identityType = data.identity_type || this.#identityType || 'anonymous';
    this.#agentConfig = data.agent_config || this.#agentConfig || null;
    this.#sessionUser = data.user || this.#sessionUser || null;
    this.#sessionTenant = data.tenant || this.#sessionTenant || null;
    if (Array.isArray(data.mcp_servers)) this.#tenantMcpServers = data.mcp_servers;
    if (Array.isArray(this.#agentConfig?.mcp_servers)) this.#tenantMcpServers = this.#agentConfig.mcp_servers;
    if (Array.isArray(this.#agentConfig?.tenant_mcp_servers)) this.#tenantMcpServers = this.#agentConfig.tenant_mcp_servers;
    if (data.customer_id) this.#storSet(LS_CUSTOMER_ID_KEY, data.customer_id);
    this.#authMode = this.#resolveAuthMode(this.#agentConfig);
    this.#authCookieName = this.#agentConfig?.auth_cookie_name || this.#authCookieName;
    this.#authTokenValidationUrl = this.#agentConfig?.auth_token_validation_url || null;

    this._toolDisplayNames = this.#agentConfig?.tool_display_names || this._toolDisplayNames || {};
    this.#renderToolbox();
    this.#refreshChromeFromThemeAndPreview();
    this.#syncOfflineBanner();
    this.#syncLoginLinks();
    this.#syncVoiceAvailability();
    void this.#maybeLoadHelpArticles();
    this.#renderHeaderUser();
    this.#scheduleSessionRefresh(data);

    if (data.preferences) this.#hydrateUserPreferences(data.preferences);
  }

  #syncOfflineBanner() {
    const banner = this.#root?.querySelector('.bk-offline-banner');
    if (!banner) return;
    const isOpen = this.#agentConfig?.office_open !== false;
    if (isOpen) {
      banner.style.display = 'none';
      return;
    }
    const textEl = banner.querySelector('.bk-offline-text');
    const custom = String(this.#agentConfig?.offline_message || '').trim();
    if (textEl && custom) textEl.textContent = custom;
    banner.style.display = 'flex';
  }

  #visitorIdentity() {
    try {
      const parsed = JSON.parse(this.#storGet(LS_VISITOR_IDENTITY_KEY) || 'null');
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  #maybeShowPreChatForm() {
    if (!this.#agentConfig?.pre_chat_form) return;
    if (this.#sessionUser?.id) return;
    if (this.#visitorIdentity()) return;
    if (this.#messageList.querySelector('.bk-prechat')) return;

    const card = document.createElement('div');
    card.className = 'bk-prechat';
    card.innerHTML = `
      <div class="bk-prechat-title">Before we start</div>
      <div class="bk-prechat-sub">Leave your name and email so we can follow up if needed.</div>
      <input type="text" class="bk-prechat-name" placeholder="Your name" maxlength="120" autocomplete="name">
      <input type="email" class="bk-prechat-email" placeholder="you@example.com" maxlength="254" autocomplete="email">
      <div class="bk-prechat-error" hidden></div>
      <div class="bk-prechat-actions">
        <button type="button" class="bk-prechat-submit">Start chatting</button>
        <button type="button" class="bk-prechat-skip">Skip</button>
      </div>
    `;
    const nameInput = card.querySelector('.bk-prechat-name');
    const emailInput = card.querySelector('.bk-prechat-email');
    const errorEl = card.querySelector('.bk-prechat-error');
    const submitBtn = card.querySelector('.bk-prechat-submit');
    const skipBtn = card.querySelector('.bk-prechat-skip');

    submitBtn.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      const email = emailInput.value.trim();
      if (!name && !email) {
        errorEl.textContent = 'Enter a name or email address.';
        errorEl.hidden = false;
        return;
      }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errorEl.textContent = 'That email address does not look right.';
        errorEl.hidden = false;
        return;
      }
      errorEl.hidden = true;
      submitBtn.disabled = true;
      try {
        await this.#api.post('session/identify', {
          name,
          email,
          conversation_id: this.#conversationId || undefined,
        });
        this.#storSet(LS_VISITOR_IDENTITY_KEY, JSON.stringify({ name, email }));
        card.remove();
        this.#textarea?.focus();
      } catch (e) {
        submitBtn.disabled = false;
        errorEl.textContent = 'Could not save your details. Try again.';
        errorEl.hidden = false;
      }
    });
    skipBtn.addEventListener('click', () => {
      this.#storSet(LS_VISITOR_IDENTITY_KEY, JSON.stringify({ skipped: true }));
      card.remove();
      this.#textarea?.focus();
    });

    this.#messageList.appendChild(card);
    nameInput.focus();
  }

  #scheduleSessionRefresh(data = {}) {
    if (this.#sessionRefreshTimer) {
      clearTimeout(this.#sessionRefreshTimer);
      this.#sessionRefreshTimer = null;
    }
    const expiresInSec = Number(data?.expires_in || 0);
    const expiresAtRaw = data?.expires_at || null;
    let delayMs = 0;
    if (Number.isFinite(expiresInSec) && expiresInSec > 30) {
      delayMs = Math.max(15000, (expiresInSec - 20) * 1000);
    } else if (typeof expiresAtRaw === 'string' && expiresAtRaw) {
      const expiresAtMs = Date.parse(expiresAtRaw);
      if (Number.isFinite(expiresAtMs)) delayMs = Math.max(15000, expiresAtMs - Date.now() - 20000);
    }
    if (!delayMs) return;
    this.#sessionRefreshTimer = setTimeout(async () => {
      try {
        await this.#initSession();
      } catch {}
    }, delayMs);
  }

  #emitTenantMcpTelemetry(source = 'unknown') {
    this.#emitTelemetry('tenant_mcp_servers_loaded', {
      source,
      tenant_id: this.#sessionTenant?.id || null,
      count: Array.isArray(this.#tenantMcpServers) ? this.#tenantMcpServers.length : 0,
      server_ids: (this.#tenantMcpServers || []).map((s) => s?.server_id || s?.id).filter(Boolean),
    });
  }

  async #initSession() {
    try {
      await this.#refreshHostAuthToken();
      const customerId = this.#storGet(LS_CUSTOMER_ID_KEY);
      const tenantSubdomain = this.#tenantSubdomain || resolveTenantSubdomainFromHost();
      const body = { agent_slug: this.#agentSlug, customer_id: customerId || undefined };
      if (this.#identityToken) body.identity_token = this.#identityToken;
      if (this.#hostAuthToken) body.host_auth_token = this.#hostAuthToken;
      if (this.#authCookieName) body.auth_cookie_name = this.#authCookieName;
      body.auth_mode = this.#authMode;
      if (tenantSubdomain) body.tenant_subdomain = tenantSubdomain;
      const data = await this.#api.post('session/start', body);
      this.#applySessionPayload(data);
      this.#emitTenantMcpTelemetry('session_start');
      this.#fetchHostUserInfo().catch(() => {});
      if (!data?.preferences) this.#fetchRemotePreferences();
      const requiresAuth = this.#isAuthRequired(this.#agentConfig);
      const isAnonymous = this.#identityType === 'anonymous' && !this.#sessionUser?.id;
      if (requiresAuth && isAnonymous) {
        this.#sm.transition('login_required');
        return;
      }
    } catch (e) {
      console.error('[Bokito] Session init failed:', e.message);
      if (e.errorName === 'AccessDeniedError') { this.#sm.transition('login_required'); return; }
      this.#sm.transition('error');
    }
  }

  #isValidCssColor(value) {
    return typeof value === 'string' && value.trim() !== '' && CSS.supports('color', value.trim());
  }

  #parseColorToRgbTriplet(cssColor) {
    if (!cssColor || typeof cssColor !== 'string') return null;
    const probe = document.createElement('span');
    probe.style.color = '';
    probe.style.color = cssColor.trim();
    if (!probe.style.color) return null;
    document.documentElement.appendChild(probe);
    const rgbStr = getComputedStyle(probe).color;
    probe.remove();
    const m = rgbStr.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3] };
  }

  #rgbTripletToCssRgb(rgb) {
    if (!rgb) return '';
    const c = (n) => Math.max(0, Math.min(255, Math.round(n)));
    return `rgb(${c(rgb.r)},${c(rgb.g)},${c(rgb.b)})`;
  }

  #darkenRgbTriplet(rgb, factor = 0.14) {
    if (!rgb) return null;
    const f = Math.max(0, Math.min(0.5, factor));
    return {
      r: rgb.r * (1 - f),
      g: rgb.g * (1 - f),
      b: rgb.b * (1 - f),
    };
  }

  #isSafeAtmosphereLengthValue(val) {
    if (typeof val !== 'string') return false;
    const t = val.trim();
    if (t.length < 1 || t.length > 56) return false;
    if (/[;{}]|url\s*\(|expression\s*\(|@import|javascript:/i.test(t)) return false;
    return /^[\d.\s%,px()-]+$|^min\s*\(|^max\s*\(|^clamp\s*\(/i.test(t);
  }

  #isSafeAtmosphereBackgroundCss(val) {
    if (typeof val !== 'string') return false;
    const t = val.trim();
    if (t.length < 8 || t.length > 1400) return false;
    const lower = t.toLowerCase();
    if (/url\s*\(|expression\s*\(|@import|javascript:/i.test(lower)) return false;
    return true;
  }

  #buildWindowAtmosphereBackground(intensity, linearFadeEndPct = 88) {
    const int = Math.min(1, Math.max(0, Number(intensity) || 1));
    const end = Math.min(96, Math.max(52, Number(linearFadeEndPct) || 88));
    const cs = getComputedStyle(this);
    const primary = (cs.getPropertyValue('--bk-primary').trim() || '#00D986');
    const bg = (cs.getPropertyValue('--bk-bg').trim() || '#F7FBF9');
    const a1 = Math.round(100 * 0.18 * int);
    const a2 = Math.round(100 * 0.06 * int);
    const l1 = Math.round(100 * 0.14 * int);
    const l2 = Math.round(100 * 0.05 * int);
    return `radial-gradient(118% 95% at 50% -12%,color-mix(in srgb,${primary} ${a1}%,transparent) 0%,color-mix(in srgb,${primary} ${a2}%,transparent) 42%,transparent 68%),linear-gradient(180deg,color-mix(in srgb,${primary} ${l1}%,${bg}) 0%,color-mix(in srgb,${primary} ${l2}%,${bg}) 46%,transparent ${end}%)`;
  }

  #syncAgentWindowAtmosphere() {
    const theme = this.#agentConfig?.theme;
    if (!theme || typeof theme !== 'object') return;
    if (typeof theme.atmosphere_background === 'string' && theme.atmosphere_background.trim()) return;
    const raw = theme.atmosphere_intensity;
    if (Number.isFinite(Number(raw))) {
      const fade = theme.atmosphere_linear_fade_end_pct;
      this.style.setProperty('--bk-window-atmosphere-bg', this.#buildWindowAtmosphereBackground(Number(raw), Number(fade)));
      return;
    }
    this.style.removeProperty('--bk-window-atmosphere-bg');
  }

  #applyAgentTheme(theme) {
    const host = this;
    if (!theme || typeof theme !== 'object') {
      if (!this.#isPreviewEmbedded()) host.removeAttribute('data-theme');
      return;
    }

    host.style.removeProperty('--bk-window-atmosphere-bg');
    host.style.removeProperty('--bk-atmosphere-height');
    host.style.removeProperty('--bk-atmosphere-min-height');

    const heightStr = theme.atmosphere_height;
    if (typeof heightStr === 'string' && this.#isSafeAtmosphereLengthValue(heightStr)) {
      host.style.setProperty('--bk-atmosphere-height', heightStr.trim());
    }
    const minH = theme.atmosphere_min_height;
    if (typeof minH === 'string' && this.#isSafeAtmosphereLengthValue(minH)) {
      host.style.setProperty('--bk-atmosphere-min-height', minH.trim());
    }
    const pct = Number(theme.atmosphere_height_pct);
    const maxPx = Number(theme.atmosphere_max_px);
    if (Number.isFinite(pct) && pct > 0 && pct <= 100 && Number.isFinite(maxPx) && maxPx >= 80 && maxPx <= 900) {
      host.style.setProperty('--bk-atmosphere-height', `min(${Math.round(pct)}%, ${Math.round(maxPx)}px)`);
    }

    const mainColor = theme.main_color || theme.primary_color;
    if (this.#isValidCssColor(mainColor)) {
      const trimmed = mainColor.trim();
      const rgb = parseHexColor(trimmed) || this.#parseColorToRgbTriplet(trimmed);
      applyBrandToHost(host, trimmed, rgb);
    }

    if (this.#isValidCssColor(theme.text_color)) {
      host.style.setProperty('--bk-text-inverse', theme.text_color.trim());
    }

    const abg = theme.atmosphere_background;
    if (typeof abg === 'string' && abg.trim() && this.#isSafeAtmosphereBackgroundCss(abg)) {
      host.style.setProperty('--bk-window-atmosphere-bg', abg.trim());
    }

    if (!this.#isPreviewEmbedded()) {
      if (theme.dark_light_mode === 'dark' || theme.dark_light_mode === 'light') {
        host.setAttribute('data-theme', theme.dark_light_mode);
      } else {
        host.removeAttribute('data-theme');
      }
    }
  }

  async #startNewConversation() {
    if (!this.#sessionToken) await this.#initSession();
    if (this.#sm.state === 'login_required') return;
    this.#sm.transition('connecting');
    this.#renderedMsgIds.clear();
    clearTimeout(this.#bundleTimer);
    this.#bundleTimer = null;
    this.#pendingBundleTextParts = [];
    this.#pendingBundleAttachments = [];
    this.#activeSend = null;
    this.#isResponding = false;
    this.#sendQueue = [];
    this.#updateQueueTelemetry();
    this.#streamingMsgEl = null;
    this.#streamingMsgId = null;
    this.#deltaQueue = [];
    this.#pendingFinalMsg = null;
    if (this.#deltaRaf) { cancelAnimationFrame(this.#deltaRaf); this.#deltaRaf = null; }
    try {
      const data = await this.#api.post('conversation', {});
      const conversationId = data?.conversation_id || data?.id || data?.conversation?.id || null;
      if (!conversationId) throw new Error('Conversation create returned no id');
      this.#conversationId = conversationId;
      if (data.customer_id) this.#storSet(LS_CUSTOMER_ID_KEY, data.customer_id);
      this.#pageCtx?.setConversationId(this.#conversationId);
      this.#connectRealtime();
      if (data.greeting_message) this.#appendMessage(data.greeting_message);
      this.#sm.transition('active');
      this.#maybeShowPreChatForm();
      this.#loadSuggestions();
    } catch (e) {
      console.error('[Bokito] startNewConversation failed:', { message: e.message });
      this.#sm.transition('error');
    }
  }

  async #openConversation(conversationId) {
    this.#conversationId = conversationId;
    this.#renderedMsgIds.clear();
    clearTimeout(this.#bundleTimer);
    this.#bundleTimer = null;
    this.#pendingBundleTextParts = [];
    this.#pendingBundleAttachments = [];
    this.#activeSend = null;
    this.#isResponding = false;
    this.#sendQueue = [];
    this.#updateQueueTelemetry();
    this.#streamingMsgEl = null;
    this.#streamingMsgId = null;
    this.#deltaQueue = [];
    this.#pendingFinalMsg = null;
    if (this.#deltaRaf) { cancelAnimationFrame(this.#deltaRaf); this.#deltaRaf = null; }
    this.#root.querySelector('.bk-agent-banner').style.display = 'none';
    this.#messageList.innerHTML = '';
    try {
      const [, msgs] = await Promise.all([
        this.#api.get(`conversation/${conversationId}`),
        this.#api.get(`conversation/${conversationId}/messages?per_page=100`),
      ]);
      const orderedMsgs = [...(msgs?.items || [])].sort((a, b) => {
        const seqA = Number.isFinite(Number(a?.sequence)) ? Number(a.sequence) : null;
        const seqB = Number.isFinite(Number(b?.sequence)) ? Number(b.sequence) : null;
        if (seqA !== null && seqB !== null && seqA !== seqB) return seqA - seqB;
        return new Date(a?.created_at || 0).getTime() - new Date(b?.created_at || 0).getTime();
      });
      orderedMsgs.forEach(m => this.#appendMessage(m, { silent: true }));
      this.#pageCtx?.setConversationId(conversationId);
      this.#connectRealtime();
      this.#sm.transition('active');
    } catch (e) {
      console.error('[Bokito] openConversation failed:', { message: e.message, errorName: e.errorName, detail: e.detail });
      this.#sm.transition('error');
    }
  }

  async #loadConversationHistory() {
    const list = this.#root.querySelector('.bk-conv-list');
    if (!list) return;
    list.innerHTML = '<div style="padding:12px 16px;font-size:13px;color:var(--bk-text-muted)">Loading...</div>';
    try {
      const endpoint = this.#sessionUser?.id ? 'user/conversations?per_page=10' : 'customer/conversations?per_page=10';
      let data = await this.#api.get(endpoint);
      if (!data?.items && endpoint !== 'customer/conversations?per_page=10') {
        data = await this.#api.get('customer/conversations?per_page=10');
      }
      const hiddenIds = this.#getHiddenConversationIds();
      const items = (data?.items || []).filter((item) => !hiddenIds.includes(item.id));
      if (!items.length) {
        list.innerHTML = '<div style="padding:12px 16px;font-size:13px;color:var(--bk-text-muted)">No conversations yet</div>';
        this.#updateUnreadBadge(0);
        return;
      }
      const unreadTotal = items.reduce((sum, c) => sum + (c.unread_count || 0), 0);
      this.#updateUnreadBadge(unreadTotal);
      list.innerHTML = '';
      items.forEach(conv => {
        const el = document.createElement('button');
        el.className = 'bk-conv-item';
        el.dataset.convId = conv.id;
        const preview = conv.title || conv.last_message_preview || 'Conversation';
        el.innerHTML = `
          <div class="bk-conv-item-avatar">${ICONS.chat}</div>
          <div class="bk-conv-item-body">
            <div class="bk-conv-item-row">
              <span class="bk-conv-item-title">${preview.slice(0,60)}</span>
              <span class="bk-conv-item-time">${formatTime(conv.last_message_at || conv.updated_at || conv.created_at)}</span>
            </div>
          </div>
          ${conv.unread_count > 0 ? `<div class="bk-conv-unread">${conv.unread_count}</div>` : ''}
        `;
        el.addEventListener('click', () => this.#openConversation(conv.id));
        list.appendChild(el);
      });
    } catch {
      list.innerHTML = '<div style="padding:12px 16px;font-size:13px;color:var(--bk-text-muted)">Could not load conversations</div>';
    }
  }

  #closeChatActionsMenu() {
    if (!this.#chatActionsMenu || this.#chatActionsMenu.hidden) return;
    this.#chatActionsMenu.hidden = true;
    this.#chatActionsBtn?.setAttribute('aria-expanded', 'false');
  }

  #updateHeaderActionButtons(state) {
    const isSettingsOpen = this.#settingsView && this.#settingsView.style.display !== 'none';
    const loginVisible = this.#loginRequiredView && this.#loginRequiredView.style.display !== 'none';
    const chatPanelVisible = this.#chatView && this.#chatView.style.display !== 'none' && !loginVisible;
    const isChatState = state === 'connecting' || state === 'active' || state === 'processing' || state === 'agent_mode' || state === 'error';
    const showChatHeaderTools = chatPanelVisible && !isSettingsOpen;
    if (this.#chatActionsWrap) this.#chatActionsWrap.hidden = !showChatHeaderTools;
    if (this.#backBtn) this.#backBtn.hidden = !(isSettingsOpen || chatPanelVisible);
    if (!showChatHeaderTools || !isChatState) this.#closeChatActionsMenu();
  }

  #getHiddenConversationIds() {
    try {
      const parsed = JSON.parse(this.#storGet(LS_HIDDEN_CONVERSATIONS_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  #hideConversationFromHistory(conversationId) {
    if (!conversationId) return;
    const hidden = new Set(this.#getHiddenConversationIds());
    hidden.add(conversationId);
    const list = [...hidden];
    this.#storSet(LS_HIDDEN_CONVERSATIONS_KEY, JSON.stringify(list));
    this.#persistPreferencePatch({ hidden_conversations: list });
  }

  #attachmentSrc(url) {
    const raw = String(url || '')
    if (!raw || !this.#sessionToken || !raw.includes('/api/uploads/files/')) return raw
    try {
      const parsed = new URL(raw, this.#apiUrl || window.location.origin)
      if (!parsed.searchParams.get('session_token') && !parsed.searchParams.get('access_token')) {
        parsed.searchParams.set('session_token', this.#sessionToken)
      }
      return parsed.toString()
    } catch {
      return raw
    }
  }

  #openImageViewer(url) {
    if (!url) return;
    this.#ensureGlobalImageViewer();
    if (!this.#globalImageViewer || !this.#globalImageViewerImg) return;
    this.#globalImageViewerImg.src = this.#attachmentSrc(url);
    this.#globalImageViewer.style.display = 'flex';
    this.#globalImageViewerClose?.focus();
  }

  #closeImageViewer() {
    if (!this.#globalImageViewer || !this.#globalImageViewerImg) return;
    this.#globalImageViewer.style.display = 'none';
    this.#globalImageViewerImg.removeAttribute('src');
  }

  #ensureGlobalImageViewer() {
    if (this.#globalImageViewer && this.#globalImageViewerImg) return;
    const overlay = document.createElement('div');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Image viewer');
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:2147483646',
      'background:rgba(2,6,23,.84)',
      'display:none',
      'align-items:center',
      'justify-content:center',
      'padding:24px',
      'backdrop-filter:blur(3px)',
      '-webkit-backdrop-filter:blur(3px)'
    ].join(';');

    const panel = document.createElement('div');
    panel.style.cssText = [
      'position:relative',
      'max-width:min(92vw,1080px)',
      'max-height:90vh',
      'border-radius:16px',
      'padding:14px',
      'background:rgba(11,18,32,.94)',
      'border:1px solid rgba(255,255,255,.14)',
      'box-shadow:0 22px 60px rgba(0,0,0,.5)'
    ].join(';');

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.innerHTML = ICONS.close;
    closeBtn.style.cssText = [
      'position:absolute',
      'top:-12px',
      'right:-12px',
      'width:36px',
      'height:36px',
      'border-radius:999px',
      'border:1px solid rgba(255,255,255,.28)',
      'background:rgba(15,23,42,.92)',
      'color:#fff',
      'cursor:pointer',
      'display:flex',
      'align-items:center',
      'justify-content:center'
    ].join(';');
    closeBtn.querySelector('svg').style.cssText = 'width:18px;height:18px;';

    const img = document.createElement('img');
    img.alt = 'Enlarged image';
    img.style.cssText = [
      'display:block',
      'max-width:min(88vw,1040px)',
      'max-height:84vh',
      'object-fit:contain',
      'border-radius:12px'
    ].join(';');

    panel.appendChild(closeBtn);
    panel.appendChild(img);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.#closeImageViewer();
    });
    closeBtn.addEventListener('click', () => this.#closeImageViewer());

    this.#globalImageViewerEscHandler = (e) => {
      if (e.key === 'Escape' && this.#globalImageViewer?.style.display !== 'none') this.#closeImageViewer();
    };
    window.addEventListener('keydown', this.#globalImageViewerEscHandler);

    this.#globalImageViewer = overlay;
    this.#globalImageViewerImg = img;
    this.#globalImageViewerClose = closeBtn;
  }

  async #archiveCurrentConversation() {
    if (!this.#conversationId) return;
    try {
      await this.#api.patch(`conversation/${this.#conversationId}/close`, {});
    } catch {}
    this.#showHome();
  }

  async #deleteCurrentConversation() {
    if (!this.#conversationId) return;
    const confirmed = window.confirm('Remove this conversation from your list?');
    if (!confirmed) return;
    this.#hideConversationFromHistory(this.#conversationId);
    try {
      await this.#api.patch(`conversation/${this.#conversationId}/close`, {});
    } catch {}
    this.#showHome();
  }

  #exportCurrentConversation() {
    const messages = [...this.#messageList.querySelectorAll('.bk-msg')];
    if (!messages.length) {
      this.#showError('No messages to export.');
      return;
    }
    const lines = messages.map((msg) => {
      const role = msg.classList.contains('bk-msg--user') ? 'Jij' : (this.#headerName?.textContent || 'Bokito AI');
      const text = (msg.querySelector('.bk-msg-bubble')?.innerText || '').trim();
      const time = (msg.querySelector('.bk-msg-time')?.textContent || '').trim();
      return `[${time || '--:--'}] ${role}: ${text}`;
    });
    const blob = new Blob([lines.join('\n\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.href = url;
    a.download = `bokito-chat-${stamp}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  #createGuid() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  #normalizeSenderType(senderType) {
    return senderType === 'ai' || senderType === 'agent' ? 'ai' : 'user';
  }

  #toEpochMs(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const trimmed = normalizeServerTimestamp(value.trim());
      if (!trimmed) return null;
      if (/^\d+$/.test(trimmed)) {
        const asNum = Number(trimmed);
        if (Number.isFinite(asNum)) return asNum;
      }
      const parsed = Date.parse(trimmed);
      if (Number.isFinite(parsed)) return parsed;
      const isoParsed = Date.parse(trimmed.replace(' ', 'T'));
      if (Number.isFinite(isoParsed)) return isoParsed;
    }
    return null;
  }

  #dayKey(epochMs) {
    const d = new Date(epochMs);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  #formatRelativeDayLabel(epochMs) {
    const d = new Date(epochMs);
    const now = new Date();
    const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diffDays = Math.round((start(now) - start(d)) / 86400000);
    if (diffDays === 0) return 'today';
    if (diffDays === 1) return 'yesterday';
    const parts = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).formatToParts(d);
    const weekday = (parts.find((p) => p.type === 'weekday')?.value || '').replace('.', '').toLowerCase();
    const day = parts.find((p) => p.type === 'day')?.value || '';
    const month = (parts.find((p) => p.type === 'month')?.value || '').replace('.', '').toLowerCase();
    return `${weekday} ${day} ${month}`.trim();
  }

  #recomputeDaySeparators() {
    this.#messageList.querySelectorAll('.bk-date-sep').forEach((el) => el.remove());
    const items = [...this.#messageList.querySelectorAll('.bk-msg')];
    let prevDay = null;
    for (const item of items) {
      const ms = this.#toEpochMs(item.dataset.createdAtMs) ?? this.#toEpochMs(item.dataset.createdAt);
      if (!Number.isFinite(ms)) continue;
      const day = this.#dayKey(ms);
      if (day !== prevDay) {
        const sep = document.createElement('div');
        sep.className = 'bk-date-sep';
        sep.textContent = this.#formatRelativeDayLabel(ms);
        this.#messageList.insertBefore(sep, item);
        prevDay = day;
      }
    }
  }

  #recomputeMessageTimestampVisibility() {
    const items = [...this.#messageList.querySelectorAll('.bk-msg')];
    for (let i = 0; i < items.length; i++) {
      const current = items[i];
      const next = items[i + 1] || null;
      let shouldShow = true;
      if (next) {
        const sameSender = (current.dataset.senderGroup || '') === (next.dataset.senderGroup || '');
        if (sameSender) {
          const currentTime = this.#toEpochMs(current.dataset.createdAtMs) ?? this.#toEpochMs(current.dataset.createdAt);
          const nextTime = this.#toEpochMs(next.dataset.createdAtMs) ?? this.#toEpochMs(next.dataset.createdAt);
          if (Number.isFinite(currentTime) && Number.isFinite(nextTime) && Math.abs(nextTime - currentTime) <= this.#timestampClusterWindowMs) {
            shouldShow = false;
          } else {
            const curLabel = (current.querySelector('.bk-msg-time')?.textContent || '').trim();
            const nextLabel = (next.querySelector('.bk-msg-time')?.textContent || '').trim();
            if (curLabel && nextLabel && curLabel === nextLabel) shouldShow = false;
          }
        }
      }
      const timeEl = current.querySelector('.bk-msg-time');
      if (timeEl) timeEl.classList.toggle('bk-msg-time--hidden', !shouldShow);
    }
  }

  #shouldSuppressAiResponse(messageObj = {}) {
    if (!this.#nonBlockingSend) return false;
    const correlation = messageObj.in_reply_to || messageObj.client_message_id || messageObj.request_id || null;
    if (this.#activeSend && correlation) {
      return correlation !== this.#activeSend.clientMessageId;
    }
    if (!this.#activeSend && this.#suppressedAiQuota > 0) {
      this.#suppressedAiQuota -= 1;
      return true;
    }
    if (!this.#activeSend && this.#lastAbortAt && (Date.now() - this.#lastAbortAt) <= this.#staleSuppressGraceMs) {
      return true;
    }
    return false;
  }

  #clearStreamingState() {
    if (this.#deltaRaf) {
      cancelAnimationFrame(this.#deltaRaf);
      this.#deltaRaf = null;
    }
    this.#deltaQueue = [];
    this.#pendingFinalMsg = null;
    if (this.#streamingMsgEl) {
      this.#streamingMsgEl.remove();
      this.#streamingMsgEl = null;
      this.#streamingMsgId = null;
      this.#recomputeDaySeparators();
      this.#recomputeMessageTimestampVisibility();
    }
  }

  #queueBundledSend(text = '', attachments = []) {
    const trimmed = (text || '').trim();
    if (this.#activeSend?.text) this.#pendingBundleTextParts.push(this.#activeSend.text);
    if (this.#activeSend?.attachments?.length) this.#pendingBundleAttachments.push(...this.#activeSend.attachments);
    if (this.#sendQueue.length) {
      this.#sendQueue.forEach((item) => {
        if (item?.text) this.#pendingBundleTextParts.push(item.text);
        if (item?.attachments?.length) this.#pendingBundleAttachments.push(...item.attachments);
      });
      this.#sendQueue = [];
    }
    if (trimmed) this.#pendingBundleTextParts.push(trimmed);
    if (attachments.length) this.#pendingBundleAttachments.push(...attachments);
    if (this.#activeSend) this.#cancelActiveResponse('superseded');
    clearTimeout(this.#bundleTimer);
    this.#bundleTimer = setTimeout(() => this.#flushBundledSend(), this.#bundleIdleMs);
  }

  #markUserTyping() {
    this.#isUserTyping = true;
    clearTimeout(this.#typingDebounceTimer);
    this.#typingDebounceTimer = setTimeout(() => {
      this.#isUserTyping = false;
      if (this.#sendQueue.length) this.#drainSendQueue();
      if ((this.#pendingBundleTextParts.length || this.#pendingBundleAttachments.length) && !this.#bundleTimer) {
        this.#bundleTimer = setTimeout(() => this.#flushBundledSend(), this.#typingIdleMs);
      }
    }, this.#typingIdleMs);
    if (this.#nonBlockingSend && this.#activeSend) this.#cancelActiveResponse('typing');
    if (this.#pendingBundleTextParts.length || this.#pendingBundleAttachments.length) {
      clearTimeout(this.#bundleTimer);
      this.#bundleTimer = setTimeout(() => this.#flushBundledSend(), Math.max(this.#bundleIdleMs, this.#typingIdleMs));
    }
  }

  #flushBundledSend() {
    clearTimeout(this.#bundleTimer);
    this.#bundleTimer = null;
    if (this.#isUserTyping) {
      this.#bundleTimer = setTimeout(() => this.#flushBundledSend(), this.#typingIdleMs);
      return;
    }
    if (!this.#conversationId) {
      this.#pendingBundleTextParts = [];
      this.#pendingBundleAttachments = [];
      return;
    }
    const text = this.#pendingBundleTextParts.join('\n');
    const attachments = [...this.#pendingBundleAttachments];
    this.#pendingBundleTextParts = [];
    this.#pendingBundleAttachments = [];
    if (!text && !attachments.length) return;
    const turnId = ++this.#turnCounter;
    this.#sendQueue.push({
      turnId,
      text,
      attachments,
      clientMessageId: this.#createGuid(),
      idempotencyKey: this.#createGuid(),
    });
    this.#updateQueueTelemetry();
    this.#drainSendQueue();
  }

  #emitTelemetry(eventName, detail = {}) {
    this.dispatchEvent(new CustomEvent('bokito:telemetry', {
      bubbles: true,
      composed: true,
      detail: { event: eventName, ...detail },
    }));
  }

  #clearProcessingWatchdog() {
    if (this.#processingWatchdogTimer) {
      clearTimeout(this.#processingWatchdogTimer);
      this.#processingWatchdogTimer = null;
    }
  }

  #markProcessingActivity() {
    this.#lastProcessingActivityAt = Date.now();
    if (this.#sm.state === 'processing') this.#armProcessingWatchdog();
  }

  #armProcessingWatchdog() {
    this.#clearProcessingWatchdog();
    this.#processingWatchdogTimer = setTimeout(() => {
      if (this.#sm.state !== 'processing') return;
      const idleFor = Date.now() - this.#lastProcessingActivityAt;
      if (idleFor < this.#processingTimeoutMs - 50) {
        this.#armProcessingWatchdog();
        return;
      }
      if (this.#activeSend) {
        this.#cancelActiveResponse('watchdog_timeout');
      } else {
        this.#clearStreamingState();
        this.#stopPolling();
        this.#thinkingEl.style.display = 'none';
        this.#thinkingSteps.innerHTML = '';
        this.#isResponding = false;
        this.#activeTurnId = 0;
        this.#updateThinkingLabel();
        this.#updateQueueTelemetry();
        if (this.#sm.state === 'processing') this.#sm.transition('active');
      }
      this.#emitTelemetry('processing_watchdog_recovered', {
        conversation_id: this.#conversationId,
        idle_ms: idleFor,
        queue_length: this.#sendQueue.length,
      });
    }, this.#processingTimeoutMs);
  }

  #updateQueueTelemetry() {
    this.#emitTelemetry('queue_length', {
      conversation_id: this.#conversationId,
      queue_length: this.#sendQueue.length,
      is_responding: this.#isResponding,
    });
  }

  #updateThinkingLabel() {
    if (!this.#thinkingLabel) return;
    if (!this.#isResponding) {
      this.#thinkingLabel.textContent = 'Working...';
      return;
    }
    if (this.#sendQueue.length > 0) {
      this.#thinkingLabel.textContent = `Working... (+${this.#sendQueue.length} queued)`;
      return;
    }
    this.#thinkingLabel.textContent = 'Working...';
  }

  async #drainSendQueue() {
    if (!this.#nonBlockingSend) return;
    if (this.#isUserTyping) return;
    if (this.#activeSend || !this.#sendQueue.length || !this.#conversationId) return;
    const next = this.#sendQueue.shift();
    this.#activeSend = {
      ...next,
      abortController: new AbortController(),
      startedAt: performance.now(),
    };
    this.#activeTurnId = next.turnId || this.#activeTurnId;
    this.#isResponding = true;
    if (this.#sm.state !== 'processing') this.#sm.transition('processing');
    this.#markProcessingActivity();
    this.#updateQueueTelemetry();
    this.#updateThinkingLabel();
    try {
      await this.#streamChat(next.text, next.attachments, this.#activeSend);
    } catch {
      this.#handleSendError('Could not send your message.');
    }
  }

  #handleSendError(message) {
    this.#clearProcessingWatchdog();
    const failed = this.#activeSend;
    const duration = failed?.startedAt ? Math.round(performance.now() - failed.startedAt) : undefined;
    this.#activeSend = null;
    this.#isResponding = false;
    this.#stopPolling();
    this.#showError(message);
    this.#emitTelemetry('send_failed', {
      conversation_id: this.#conversationId,
      duration_ms: duration,
      queue_length: this.#sendQueue.length,
    });
    if (this.#sendQueue.length) {
      this.#isResponding = true;
      this.#drainSendQueue();
      return;
    }
    if (this.#sm.state === 'processing') this.#sm.transition('active');
    this.#updateThinkingLabel();
    this.#updateQueueTelemetry();
  }

  #finishAssistantTurn(reason = 'done') {
    this.#clearProcessingWatchdog();
    const finished = this.#activeSend;
    const duration = finished?.startedAt ? Math.round(performance.now() - finished.startedAt) : undefined;
    this.#activeSend = null;
    this.#stopPolling();
    if (this.#sendQueue.length > 0) {
      this.#isResponding = true;
      this.#emitTelemetry('send_completed', {
        reason,
        conversation_id: this.#conversationId,
        duration_ms: duration,
        queue_remaining: this.#sendQueue.length,
      });
      this.#updateThinkingLabel();
      this.#updateQueueTelemetry();
      this.#drainSendQueue();
      return;
    }
    this.#isResponding = false;
    this.#activeTurnId = 0;
    if (this.#sm.state === 'processing') this.#sm.transition('active');
    this.#emitTelemetry('send_completed', {
      reason,
      conversation_id: this.#conversationId,
      duration_ms: duration,
      queue_remaining: 0,
    });
    this.#updateThinkingLabel();
    this.#updateQueueTelemetry();
  }

  #cancelActiveResponse(reason = 'manual') {
    if (!this.#activeSend?.abortController) return;
    this.#suppressedAiQuota += 1;
    this.#lastAbortAt = Date.now();
    this.#activeSend.abortController.abort();
    this.#clearStreamingState();
    this.#emitTelemetry('send_aborted', {
      conversation_id: this.#conversationId,
      queue_length: this.#sendQueue.length,
      reason,
    });
    this.#finishAssistantTurn('aborted');
  }

  #canSendMessageNow() {
    const now = Date.now();
    this.#messageRateTimestamps = this.#messageRateTimestamps.filter((ts) => (now - ts) <= this.#messageRateWindowMs);
    if (this.#messageRateTimestamps.length >= this.#messageRateMax) {
      const waitMs = this.#messageRateWindowMs - (now - this.#messageRateTimestamps[0]);
      this.#showError(`Too many messages at once. Try again in ${Math.max(1, Math.ceil(waitMs / 1000))}s.`);
      return false;
    }
    this.#messageRateTimestamps.push(now);
    return true;
  }

  async #sendMessage() {
    const text = this.#textarea.value.trim();
    const readyAttachments = this.#pendingAttachments.filter(a => !a.uploading);
    if (!text && !readyAttachments.length) return;
    if (!this.#canSendMessageNow()) return;

    if (this.#pendingAttachments.some(a => a.uploading)) {
      this.#showError('Images are still uploading, one moment...');
      return;
    }

    // Full metadata (mime/name/size) so the backend can inline images for vision.
    const attachments = readyAttachments.map(a => ({ id: a.id, url: a.url, mime: a.mime, name: a.name, size: a.size }));
    this.#sendMessageWithContent(text, attachments);
    this.#textarea.value = '';
    this.#textarea.style.height = 'auto';
    this.#sendBtn.disabled = true;
    this.#suggChips.innerHTML = '';
    this.#pendingAttachments.forEach(a => URL.revokeObjectURL(a.localUrl));
    this.#pendingAttachments = [];
    this.#renderPreviewStrip();
    this.#updateSendBtnState();
  }

  async #sendMessageWithContent(text, attachments = []) {
    if (!text && !attachments.length) return;
    const createdAt = new Date().toISOString();
    this.#appendMessage({
      id: Date.now(),
      sender_type: 'customer',
      message_content: text || '',
      created_at: createdAt,
      attachments,
    });
    if (!this.#conversationId) {
      this.#showError('No active conversation. Close and reopen the chat to try again.');
      return;
    }
    if (!this.#nonBlockingSend) {
      this.#sm.transition('processing');
      try {
        await this.#streamChat(text || '', attachments, null);
      } catch {
        this.#stopPolling();
        this.#sm.transition('active');
        this.#showError('Could not send your message.');
      }
      return;
    }
    this.#queueBundledSend(text || '', attachments);
  }

  #streamChatPath() {
    return livechatStreamSegment(this.#agentConfig?.stream_chat_path, 'stream-chat');
  }

  #streamChatContinuePath() {
    return livechatStreamSegment(this.#agentConfig?.stream_chat_continue_path, 'stream-chat-continue');
  }

  #transcribePath() {
    // No default: the core livechat API has no transcribe endpoint, so voice
    // input is only offered when the agent config provides an explicit path.
    return livechatStreamSegment(this.#agentConfig?.transcribe_path, null);
  }

  #syncVoiceAvailability() {
    if (!this.#recordStartBtn) return;
    const hasRecorder = typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
    this.#recordStartBtn.hidden = !(hasRecorder && this.#transcribePath());
  }

  /** Mutable bag for incremental SSE (`evt.t`) → one streaming AI bubble. */
  #createSseStreamState() {
    return { streamEl: null, fullContent: '', msgId: null, hadTokenChunks: false };
  }

  /** When the server only sends `done` (no `t`), optionally reveal text in small steps so the UI streams offline too. */
  #sseSplitForClientSim(text, approxLen) {
    const n = Math.max(8, Math.min(Number(approxLen) || 20, 80));
    const out = [];
    let i = 0;
    while (i < text.length) {
      let end = Math.min(i + n, text.length);
      if (end < text.length) {
        const slice = text.slice(i, end);
        const lastSpace = slice.lastIndexOf(' ');
        if (lastSpace > 0) end = i + lastSpace + 1;
        else {
          const hy = slice.lastIndexOf('-');
          if (hy > (slice.length >> 1)) end = i + hy + 1;
        }
      }
      out.push(text.slice(i, end));
      i = end;
    }
    return out.length ? out : [text];
  }

  async #sseMaybeSimulateClientChunks(state, sendMeta) {
    if (this.dataset.clientSimulateStream === 'false') return;
    const full = state.fullContent ?? '';
    // Do not skip when streamEl is set: pre-read shell or first real chunk may already exist.
    if (!full.trim() || state.hadTokenChunks) return;
    const minLen = Number(this.dataset.clientSimulateMinChars ?? '20');
    if (full.trim().length < minLen) return;

    const savedId = state.msgId;
    const pieces = this.#sseSplitForClientSim(full, Number(this.dataset.clientSimulateChunk ?? '20'));
    const delayMs = Number(this.dataset.clientSimulateMs ?? '22');

    state.fullContent = '';
    state.msgId = savedId;
    if (state.streamEl) {
      const b = state.streamEl.querySelector('.bk-msg-bubble');
      if (b) b.textContent = '';
    } else {
      state.streamEl = null;
    }

    for (let i = 0; i < pieces.length; i++) {
      if (sendMeta && this.#activeSend !== sendMeta) {
        this.#sseDiscardPartialBubble(state);
        state.fullContent = full;
        state.msgId = savedId;
        return;
      }
      this.#sseApplyTokenChunk(state, { t: pieces[i], id: savedId }, sendMeta);
      if (i < pieces.length - 1) await new Promise(r => setTimeout(r, delayMs));
    }
  }

  #sseApplyTokenChunk(state, evt, sendMeta) {
    if (evt.t === undefined || evt.t === null) return;
    const chunk = String(evt.t);
    if (chunk) state.hadTokenChunks = true;
    if (!state.msgId && evt.id != null) state.msgId = evt.id;
    state.fullContent += chunk;
    if (sendMeta && this.#activeSend !== sendMeta) return;
    if (!state.streamEl) {
      this.#thinkingEl.style.display = 'none';
      this.#thinkingSteps.innerHTML = '';
      const el = document.createElement('div');
      el.className = 'bk-msg bk-msg--ai bk-msg--streaming';
      const createdAt = new Date().toISOString();
      el.innerHTML = `<div class="bk-msg-bubble"></div><div class="bk-msg-time">${formatTime(createdAt)}</div>`;
      el.dataset.createdAt = String(createdAt);
      el.dataset.createdAtMs = String(this.#toEpochMs(createdAt) ?? Date.now());
      el.dataset.senderGroup = 'ai';
      this.#messageList.appendChild(el);
      state.streamEl = el;
      this.#recomputeDaySeparators();
      this.#recomputeMessageTimestampVisibility();
    }
    const bubble = state.streamEl?.querySelector('.bk-msg-bubble');
    if (bubble) bubble.textContent = state.fullContent;
    this.#scrollToBottom();
  }

  #sseDiscardPartialBubble(state) {
    if (state.streamEl?.parentNode) state.streamEl.remove();
    state.streamEl = null;
    state.fullContent = '';
    state.msgId = null;
    state.hadTokenChunks = false;
  }

  /** Hide thinking row and show an empty AI streaming row as soon as the HTTP response is streaming (before first SSE byte). */
  #sseShowStreamShell(state, sendMeta) {
    if (state.streamEl) return;
    if (sendMeta && this.#activeSend !== sendMeta) return;
    this.#thinkingEl.style.display = 'none';
    this.#thinkingSteps.innerHTML = '';
    const el = document.createElement('div');
    el.className = 'bk-msg bk-msg--ai bk-msg--streaming bk-msg--stream-shell';
    const createdAt = new Date().toISOString();
    el.innerHTML = `<div class="bk-msg-bubble"></div><div class="bk-msg-time">${formatTime(createdAt)}</div>`;
    el.dataset.createdAt = String(createdAt);
    el.dataset.createdAtMs = String(this.#toEpochMs(createdAt) ?? Date.now());
    el.dataset.senderGroup = 'ai';
    this.#messageList.appendChild(el);
    state.streamEl = el;
    this.#recomputeDaySeparators();
    this.#recomputeMessageTimestampVisibility();
    this.#scrollToBottom();
  }

  /** After stream ends: markdown + remove streaming class, or #appendMessage if no chunks arrived. */
  #sseFinalizeAssistantMessage(state, sendMeta) {
    const raw = state.fullContent ?? '';
    const trimmed = raw.trim();
    if (!trimmed) {
      if (state.streamEl?.parentNode) state.streamEl.remove();
      return false;
    }
    if (sendMeta && this.#activeSend !== sendMeta) {
      if (state.streamEl?.parentNode) state.streamEl.remove();
      return false;
    }
    const finalId = state.msgId ?? `stream-${Date.now()}`;
    if (state.streamEl) {
      this.#playSound('incoming');
      const bubble = state.streamEl.querySelector('.bk-msg-bubble');
      if (bubble) bubble.innerHTML = MarkdownRenderer.render(raw);
      state.streamEl.classList.remove('bk-msg--streaming');
      this.#renderedMsgIds.add(finalId);
      this.#recomputeDaySeparators();
      this.#recomputeMessageTimestampVisibility();
      this.#scrollToBottom();
    } else {
      this.#thinkingEl.style.display = 'none';
      this.#thinkingSteps.innerHTML = '';
      const finalObj = {
        id: finalId,
        message_content: raw,
        sender_type: 'ai',
        created_at: new Date().toISOString(),
      };
      this.#appendMessage(finalObj);
      this.#renderedMsgIds.add(finalObj.id);
    }
    return true;
  }

  // Sends message; SSE `evt.t` chunks update the UI live; `done` finalizes markdown in the bubble.
  async #streamChat(text, attachments = [], sendMeta = null) {
    let response;
    try {
      response = await fetch(livechatHttpUrl(this.#apiUrl, this.#streamChatPath()), {
        method: 'POST',
        signal: sendMeta?.abortController?.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(this.#sessionToken ? { Authorization: `Bearer ${this.#sessionToken}` } : {}),
          ...(sendMeta?.idempotencyKey ? { 'X-Idempotency-Key': sendMeta.idempotencyKey } : {}),
        },
        body: JSON.stringify({
          conversation_id: this.#conversationId,
          message_content: text,
          session_token: this.#sessionToken,
          page_context: this.#pageCtx?.getMessageSnapshot() ?? null,
          attachments: attachments.length ? attachments : null,
          user_context: this.#sessionUser ? {
            id: this.#sessionUser.id || null,
            email: this.#sessionUser.email || null,
            name: this.#sessionUser.name || null,
          } : null,
          tenant_context: this.#sessionTenant ? {
            id: this.#sessionTenant.id || null,
            slug: this.#sessionTenant.slug || null,
            name: this.#sessionTenant.name || null,
          } : null,
          mcp_server_ids: (this.#tenantMcpServers || []).map((s) => s?.server_id || s?.id).filter(Boolean),
          client_message_id: sendMeta?.clientMessageId || null,
          idempotency_key: sendMeta?.idempotencyKey || null,
          turn_id: sendMeta?.turnId || null,
        }),
      });
    } catch {
      if (sendMeta?.abortController?.signal?.aborted) return;
      if (sendMeta) this.#handleSendError('Could not send your message.');
      else {
        this.#thinkingEl.style.display = 'none';
        this.#startPolling();
      }
      return;
    }

    if (!response.ok || !response.body) {
      if (sendMeta) this.#handleSendError('Could not send your message.');
      else {
        this.#thinkingEl.style.display = 'none';
        this.#startPolling();
      }
      return;
    }
    this.#markProcessingActivity();
    if (sendMeta) {
      const replayed = (response.headers.get('x-idempotency-replayed') || response.headers.get('idempotency-replayed') || '').toLowerCase();
      if (replayed === 'true') {
        this.#emitTelemetry('idempotency_replay', {
          conversation_id: this.#conversationId,
          idempotency_key: sendMeta.idempotencyKey,
        });
      }
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = '';
    const state = this.#createSseStreamState();
    let pageContextHandoff = false;

    this.#sseShowStreamShell(state, sendMeta);

    try {
      outer: while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        this.#markProcessingActivity();

        sseBuffer += decoder.decode(value, { stream: true });

        const parts = sseBuffer.split('\n\n');
        sseBuffer = parts.pop() ?? '';

        for (const part of parts) {
          for (const line of part.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr) continue;
            let evt;
            try { evt = JSON.parse(jsonStr); } catch { continue; }

            if (evt.t !== undefined) {
              this.#sseApplyTokenChunk(state, evt, sendMeta);
            } else if (evt.type === 'title') {
              this.#updateConversationTitle(evt.conversation_id, evt.title);
            } else if (evt.type === 'page_context_needed') {
              this.#sseDiscardPartialBubble(state);
              this.#thinkingEl.style.display = '';
              this.#thinkingSteps.innerHTML = '';
              if (this.#thinkingLabel) this.#thinkingLabel.textContent = evt.status || 'Pagina ophalen...';
              await this.#continueWithPageContext(sendMeta);
              pageContextHandoff = true;
              break outer;
            } else if (evt.type === 'done') {
              if (evt.id != null) state.msgId = evt.id;
              if (evt.content != null) state.fullContent = String(evt.content);
              break outer;
            }
          }
        }
      }
    } catch {
      // Read error — use whatever we accumulated
    }

    if (pageContextHandoff) return;

    await this.#sseMaybeSimulateClientChunks(state, sendMeta);

    if (this.#sseFinalizeAssistantMessage(state, sendMeta)) {
      if (sendMeta) this.#finishAssistantTurn('stream_done');
      else if (this.#sm.state === 'processing') this.#sm.transition('active');
      this.#loadSuggestions();
    } else {
      if (sendMeta && this.#activeSend !== sendMeta) return;
      this.#startPolling();
    }
  }

  async #continueWithPageContext(sendMeta = null) {
    const snapshot = this.#pageCtx?.getFullSnapshot();
    const text = [
      snapshot?.text ?? '',
      snapshot?.structured_data ? JSON.stringify(snapshot.structured_data) : '',
    ].filter(Boolean).join('\n').slice(0, 4000);

    let response;
    try {
      response = await fetch(livechatHttpUrl(this.#apiUrl, this.#streamChatContinuePath()), {
        method: 'POST',
        signal: sendMeta?.abortController?.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(this.#sessionToken ? { Authorization: `Bearer ${this.#sessionToken}` } : {}),
        },
        body: JSON.stringify({
          conversation_id: this.#conversationId,
          session_token: this.#sessionToken,
          page_content: text || `[URL: ${window.location.href}] [No further content available]`,
          tenant_context: this.#sessionTenant ? {
            id: this.#sessionTenant.id || null,
            slug: this.#sessionTenant.slug || null,
          } : null,
          mcp_server_ids: (this.#tenantMcpServers || []).map((s) => s?.server_id || s?.id).filter(Boolean),
          client_message_id: sendMeta?.clientMessageId || null,
          idempotency_key: sendMeta?.idempotencyKey || null,
          turn_id: sendMeta?.turnId || null,
        }),
      });
    } catch {
      if (sendMeta?.abortController?.signal?.aborted) return;
      if (sendMeta) this.#handleSendError('Could not send your message.');
      else this.#startPolling();
      return;
    }

    if (!response.ok || !response.body) {
      if (sendMeta) this.#handleSendError('Could not send your message.');
      else this.#startPolling();
      return;
    }
    this.#markProcessingActivity();
    if (sendMeta) {
      const replayed = (response.headers.get('x-idempotency-replayed') || response.headers.get('idempotency-replayed') || '').toLowerCase();
      if (replayed === 'true') {
        this.#emitTelemetry('idempotency_replay', {
          conversation_id: this.#conversationId,
          idempotency_key: sendMeta.idempotencyKey,
        });
      }
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = '';
    const state = this.#createSseStreamState();

    this.#sseShowStreamShell(state, sendMeta);

    try {
      outer: while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        this.#markProcessingActivity();

        sseBuffer += decoder.decode(value, { stream: true });
        const parts = sseBuffer.split('\n\n');
        sseBuffer = parts.pop() ?? '';

        for (const part of parts) {
          for (const line of part.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr) continue;
            let evt;
            try { evt = JSON.parse(jsonStr); } catch { continue; }

            if (evt.t !== undefined) {
              this.#sseApplyTokenChunk(state, evt, sendMeta);
            } else if (evt.type === 'done') {
              if (evt.id != null) state.msgId = evt.id;
              if (evt.content != null) state.fullContent = String(evt.content);
              break outer;
            }
          }
        }
      }
    } catch {
      // Read error — use whatever we accumulated
    }

    if (this.#thinkingLabel) this.#thinkingLabel.textContent = 'Working...';
    await this.#sseMaybeSimulateClientChunks(state, sendMeta);
    if (this.#sseFinalizeAssistantMessage(state, sendMeta)) {
      if (sendMeta) this.#finishAssistantTurn('stream_continue_done');
      else if (this.#sm.state === 'processing') this.#sm.transition('active');
      this.#loadSuggestions();
    } else {
      if (sendMeta && this.#activeSend !== sendMeta) return;
      this.#startPolling();
    }
  }

  #connectRealtime() {
    if (!this.#conversationId) return;
    this.#realtime = new RealtimeClient({
      url: gatewayWebSocketUrl(this.#apiUrl),
      topics: [`signal:${this.#conversationId}`],
      token: this.#sessionToken || null,
      onEvent: (frame) => {
        // Visitor-safe status event: an operator (or rule) closed the
        // conversation, which is the moment to ask for a satisfaction rating.
        if (frame?.event === 'conversation' && frame.data?.status === 'closed') {
          this.#showCsatPrompt();
          return;
        }
        const legacy = gatewayFrameToWidgetEvent(frame);
        if (legacy) this.#handleRealtimeEvent(legacy);
      },
      onReconnect: () => this.#onRealtimeReconnect(),
    });
    this.#realtime.connect();
  }

  #startPolling() {
    this.#stopPolling();
    this.#markProcessingActivity();
    this.#pollTimer = setInterval(async () => {
      if (this.#sm.state !== 'processing' || !this.#conversationId) {
        this.#stopPolling();
        return;
      }
      try {
        const msgs = await this.#api.get(`conversation/${this.#conversationId}/messages?per_page=100`);
        this.#markProcessingActivity();
        // Find a sent AI message not yet rendered — event_triggered is always true so we ignore it
        const aiMsg = [...(msgs?.items || [])]
          .filter((m) => m.sender_type === 'ai' && m.status === 'sent' && !this.#renderedMsgIds.has(m.id))
          .sort((a, b) => {
            const seqA = Number.isFinite(Number(a?.sequence)) ? Number(a.sequence) : null;
            const seqB = Number.isFinite(Number(b?.sequence)) ? Number(b.sequence) : null;
            if (seqA !== null && seqB !== null && seqA !== seqB) return seqB - seqA;
            return new Date(b?.created_at || 0).getTime() - new Date(a?.created_at || 0).getTime();
          })[0];
        if (aiMsg) {
          if (this.#shouldSuppressAiResponse(aiMsg)) return;
          this.#stopPolling();
          this.#thinkingEl.style.display = 'none';
          this.#thinkingSteps.innerHTML = '';
          if (!this.#renderedMsgIds.has(aiMsg.id)) {
            this.#appendMessage(aiMsg);
            this.#renderedMsgIds.add(aiMsg.id);
            if (this.#nonBlockingSend && this.#activeSend) this.#finishAssistantTurn('polling');
            else if (this.#sm.state === 'processing') this.#sm.transition('active');
            this.#loadSuggestions();
          }
        }
        const errMsg = msgs?.items?.find(m => m.sender_type === 'ai' && m.status === 'error');
        if (errMsg && this.#sm.state === 'processing') {
          this.#stopPolling();
          this.#thinkingEl.style.display = 'none';
          if (this.#nonBlockingSend && this.#activeSend) this.#handleSendError('The AI could not generate a reply. Try again.');
          else {
            this.#showError('The AI could not generate a reply. Try again.');
            this.#sm.transition('active');
          }
        }
      } catch {}
    }, 3000);
  }

  #stopPolling() {
    if (this.#pollTimer) { clearInterval(this.#pollTimer); this.#pollTimer = null; }
  }

  // Animate streaming deltas 2 chars per frame (~120 chars/sec at 60fps) for visible typewriter effect
  #drainDeltaQueue() {
    if (this.#deltaRaf) return;
    const step = () => {
      if (this.#deltaQueue.length === 0) {
        this.#deltaRaf = null;
        if (this.#pendingFinalMsg) {
          this.#finalizeSteamingMsg(this.#pendingFinalMsg);
          this.#pendingFinalMsg = null;
        }
        return;
      }
      // 3 chars per frame = ~180 chars/sec — natural-looking streaming pace
      let batch = '';
      for (let i = 0; i < 3 && this.#deltaQueue.length > 0; i++) {
        batch += this.#deltaQueue.shift();
      }
      if (this.#streamingMsgEl) {
        const bubble = this.#streamingMsgEl.querySelector('.bk-msg-bubble');
        if (bubble) {
          bubble.textContent = (bubble.textContent || '') + batch;
          this.#scrollToBottom();
        }
      }
      this.#deltaRaf = requestAnimationFrame(step);
    };
    this.#deltaRaf = requestAnimationFrame(step);
  }

  // Start a typewriter animation from full message content (used when no WebSocket streaming)
  #animateAsStream(obj) {
    if (this.#renderedMsgIds.has(obj.id)) return;
    this.#thinkingEl.style.display = 'none';
    this.#thinkingSteps.innerHTML = '';
    const el = document.createElement('div');
    el.className = 'bk-msg bk-msg--ai bk-msg--streaming';
    const createdAt = obj.created_at || new Date().toISOString();
    el.innerHTML = `<div class="bk-msg-bubble"></div><div class="bk-msg-time">${formatTime(createdAt)}</div>`;
    el.dataset.createdAt = String(createdAt);
    el.dataset.createdAtMs = String(this.#toEpochMs(createdAt) ?? Date.now());
    el.dataset.senderGroup = 'ai';
    this.#messageList.appendChild(el);
    this.#streamingMsgEl = el;
    this.#streamingMsgId = obj.id;
    // Split content into individual chars and queue them all at once
    const chars = [...(obj.message_content || '')];
    this.#deltaQueue.push(...chars);
    this.#pendingFinalMsg = obj;
    this.#drainDeltaQueue();
    this.#recomputeDaySeparators();
    this.#recomputeMessageTimestampVisibility();
    this.#scrollToBottom();
  }

  #finalizeSteamingMsg(obj) {
    this.#renderedMsgIds.add(obj.id);
    if (this.#streamingMsgEl) {
      const bubble = this.#streamingMsgEl.querySelector('.bk-msg-bubble');
      if (bubble) bubble.innerHTML = MarkdownRenderer.render(obj.message_content);
      const finalizedAt = obj.created_at || new Date().toISOString();
      this.#streamingMsgEl.dataset.createdAt = String(finalizedAt);
      this.#streamingMsgEl.dataset.createdAtMs = String(this.#toEpochMs(finalizedAt) ?? Date.now());
      this.#streamingMsgEl.dataset.senderGroup = 'ai';
      this.#streamingMsgEl.classList.remove('bk-msg--streaming');
      this.#streamingMsgEl = null;
      this.#streamingMsgId = null;
    }
    if (this.#deltaRaf) { cancelAnimationFrame(this.#deltaRaf); this.#deltaRaf = null; }
    this.#deltaQueue = [];
    if (this.#nonBlockingSend && this.#activeSend) this.#finishAssistantTurn('streaming_delta');
    else if (this.#sm.state === 'processing') this.#sm.transition('active');
    this.#recomputeDaySeparators();
    this.#recomputeMessageTimestampVisibility();
    this.#loadSuggestions();
  }

  async #onRealtimeReconnect() {
    try {
      const msgs = await this.#api.get(`conversation/${this.#conversationId}/messages?per_page=50`);
      const pending = msgs?.items?.find(m => m.sender_type === 'ai' && (m.status === 'processing' || m.status === 'queued'));
      if (pending && this.#sm.state === 'active' && this.#activeSend) this.#sm.transition('processing');
    } catch {}
  }

  #handleRealtimeEvent(data) {
    const type = data.event_type, obj = data.object || {};
    switch (type) {
      case 'streaming_delta': {
        this.#markProcessingActivity();
        const delta = obj.delta || '';
        if (!delta) break;
        if (!this.#activeSend && (this.#suppressedAiQuota > 0 || (Date.now() - this.#lastAbortAt) <= this.#staleSuppressGraceMs)) break;
        // Ensure streaming bubble exists
        if (!this.#streamingMsgEl) {
          this.#thinkingEl.style.display = 'none';
          this.#thinkingSteps.innerHTML = '';
          const el = document.createElement('div');
          el.className = 'bk-msg bk-msg--ai bk-msg--streaming';
          const createdAt = obj.created_at || new Date().toISOString();
          el.innerHTML = `<div class="bk-msg-bubble"></div><div class="bk-msg-time">${formatTime(createdAt)}</div>`;
          el.dataset.createdAt = String(createdAt);
          el.dataset.createdAtMs = String(this.#toEpochMs(createdAt) ?? Date.now());
          el.dataset.senderGroup = 'ai';
          this.#messageList.appendChild(el);
          this.#streamingMsgEl = el;
          this.#streamingMsgId = obj.message_id;
          this.#recomputeDaySeparators();
          this.#recomputeMessageTimestampVisibility();
        }
        // Queue the delta and animate via rAF for smooth streaming effect
        this.#deltaQueue.push(delta);
        this.#drainDeltaQueue();
        break;
      }
      case 'message':
        if (obj.sender_type === 'ai' && obj.status === 'sent') {
          this.#markProcessingActivity();
          if (this.#shouldSuppressAiResponse(obj)) break;
          this.#stopPolling();
          this.#thinkingEl.style.display = 'none';
          this.#thinkingSteps.innerHTML = '';
          if (!this.#renderedMsgIds.has(obj.id)) {
            this.#appendMessage(obj);
            this.#renderedMsgIds.add(obj.id);
            if (this.#nonBlockingSend && this.#activeSend) this.#finishAssistantTurn('realtime');
            else if (this.#sm.state === 'processing') this.#sm.transition('active');
            this.#loadSuggestions();
          }
        } else if (obj.sender_type === 'agent' && obj.status === 'sent') {
          // Human support agent reply pushed via the realtime gateway.
          this.#stopPolling();
          this.#thinkingEl.style.display = 'none';
          this.#thinkingSteps.innerHTML = '';
          if (!this.#renderedMsgIds.has(obj.id)) {
            this.#appendMessage(obj);
            this.#renderedMsgIds.add(obj.id);
            if (this.#sm.state === 'processing') this.#sm.transition('active');
          }
        }
        break;
      case 'tool_started':
        this.#markProcessingActivity();
        if (this.#agentConfig?.show_tool_steps !== false) {
          const dn = this._toolDisplayNames?.[obj.tool_name] || obj.tool_name;
          this.#addToolStep(obj.tool_name, dn, 'running');
        }
        break;
      case 'tool_completed':
        this.#markProcessingActivity();
        if (this.#agentConfig?.show_tool_steps !== false) this.#updateToolStep(obj.tool_name, 'done', obj.duration_ms);
        break;
      case 'tool_error':
        this.#updateToolStep(obj.tool_name, 'error');
        break;
      case 'agent_error':
        this.#stopPolling();
        this.#thinkingEl.style.display = 'none';
        if (this.#nonBlockingSend && this.#activeSend) this.#handleSendError('The AI could not generate a reply. Try again.');
        else {
          this.#showError('The AI could not generate a reply. Try again.');
          if (this.#sm.state === 'processing') this.#sm.transition('active');
        }
        break;
      case 'agent_invoked':
      case 'work_log_started':
        if (obj.work_log_id || obj.workLogId) {
          this.#subscribeWorkLog(String(obj.work_log_id || obj.workLogId));
          this.dispatchEvent(new CustomEvent('bokito:agent-invoked', {
            detail: { workLogId: String(obj.work_log_id || obj.workLogId) },
            bubbles: true,
          }));
        }
        break;
      case 'work_log_event':
        this.#handleWorkLogRealtimeEvent(data);
        break;
      case 'transfer_to_agent':
        if (this.#sm.state === 'processing') this.#sm.transition('agent_mode');
        break;
      case 'conversation_title_updated':
        if (obj.title) this.#updateConversationTitle(obj.conversation_id, obj.title);
        break;
    }
  }

  #updateConversationTitle(conversationId, title) {
    // Update any visible conversation list item for this conversation
    const list = this.#root.querySelector('.bk-conv-list');
    if (!list) return;
    const items = list.querySelectorAll('.bk-conv-item');
    items.forEach(item => {
      if (item.dataset.convId === String(conversationId)) {
        const titleEl = item.querySelector('.bk-conv-item-title');
        if (titleEl) titleEl.textContent = title.slice(0, 60);
      }
    });
  }

  #ensureWorkLogStack() {
    if (this.#workLogStackEl?.isConnected) return this.#workLogStackEl;
    this.#workLogStackEl = createWorkLogStackElement();
    if (this.#messageList && this.#thinkingEl) {
      this.#messageList.insertBefore(this.#workLogStackEl, this.#thinkingEl);
    } else if (this.#messageList) {
      this.#messageList.appendChild(this.#workLogStackEl);
    }
    return this.#workLogStackEl;
  }

  #handleWorkLogRealtimeEvent(data) {
    const ev = parseWorkLogRealtimePayload(data);
    if (!ev) return;
    if (ev.type === 'log' && /run finished/i.test(String(ev.title ?? ''))) {
      this.#workLogFinished = true;
      if (this.#workLogStackEl) collapseWorkLogStack(this.#workLogStackEl);
      this.#workLogRealtime?.disconnect?.();
      this.#workLogRealtime = null;
      return;
    }
    if (!isCustomerSafeLogEvent(ev)) return;
    appendWorkLogEvent(this.#ensureWorkLogStack(), ev);
    this.#scrollToBottom();
  }

  #subscribeWorkLog(workLogId) {
    if (!workLogId || !this.#apiUrl) return;
    this.#workLogFinished = false;
    this.#workLogRealtime?.disconnect?.();
    this.#ensureWorkLogStack();
    this.#workLogRealtime = new RealtimeClient({
      url: gatewayWebSocketUrl(this.#apiUrl),
      topics: [`run:${workLogId}`],
      token: this.#hostAuthToken || this.#sessionToken || null,
      onEvent: (frame) => {
        if (frame?.event !== 'agent.run') return;
        const d = frame.data || {};
        const finished = ['completed', 'failed', 'cancelled'].includes(String(d.status || ''));
        this.#handleWorkLogRealtimeEvent({
          type: 'log',
          title: finished ? 'Run finished' : String(d.message || d.type || ''),
        });
      },
      onReconnect: () => {},
    });
    this.#workLogRealtime.connect();
  }

  #showThinking() {
    // Always move to end of message list so it appears below the last message
    this.#messageList.appendChild(this.#thinkingEl);
    this.#thinkingEl.style.display = '';
    this.#markProcessingActivity();
    this.#updateThinkingLabel();
    this.#scrollToBottom();
  }

  #addToolStep(toolName, displayName, status) {
    const el = document.createElement('div');
    el.className = 'bk-thinking-step';
    el.dataset.tool = toolName;
    el.innerHTML = `
      <div class="bk-step-icon">
        <div class="bk-step-spinner"></div>
      </div>
      <span class="bk-step-name">${displayName}</span>
      <span class="bk-step-time"></span>
    `;
    this.#thinkingSteps.appendChild(el);
    this.#scrollToBottom();
  }

  #updateToolStep(toolName, status, durationMs) {
    const el = this.#thinkingSteps.querySelector(`[data-tool="${toolName}"]`);
    if (!el) return;
    const icon = el.querySelector('.bk-step-icon');
    if (status === 'done') {
      icon.innerHTML = `<div class="bk-step-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>`;
      if (durationMs) el.querySelector('.bk-step-time').textContent = `${durationMs}ms`;
    } else if (status === 'error') {
      icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/></svg>`;
    }
  }

  #appendMessage(msg, opts = {}) {
    if (msg.id) this.#renderedMsgIds.add(msg.id);
    const isAI = msg.sender_type === 'ai' || msg.sender_type === 'agent';
    const rawText = (msg.message_content || '').trim();
    const hasAttachments = Array.isArray(msg.attachments) && msg.attachments.length > 0;
    if (isAI && !rawText && !hasAttachments) return;
    if (!opts.silent) this.#playSound(isAI ? 'incoming' : 'outgoing');
    const el = document.createElement('div');
    el.className = `bk-msg bk-msg--${isAI ? 'ai' : 'user'}`;

    // Build image grid if the message has attachments
    const attachments = msg.attachments ?? [];
    const imagesHtml = attachments.length
      ? `<div class="bk-msg-images">${attachments.map(a =>
          `<img class="bk-msg-img" src="${this.#attachmentSrc(a.url).replace(/"/g, '')}" loading="lazy" alt="Bijlage">`
        ).join('')}</div>`
      : '';

    const textContent = rawText;
    const bubbleContent = isAI
      ? MarkdownRenderer.render(textContent)
      : textContent ? `<p>${textContent.replace(/</g,'&lt;')}</p>` : '';

    el.innerHTML = `
      <div class="bk-msg-bubble">${imagesHtml}${bubbleContent}</div>
      <div class="bk-msg-time">${formatTime(msg.created_at)}</div>
    `;
    const createdAtValue = msg.created_at || new Date().toISOString();
    const createdAtMs = this.#toEpochMs(createdAtValue) ?? Date.now();
    el.dataset.createdAt = String(createdAtValue);
    el.dataset.createdAtMs = String(createdAtMs);
    el.dataset.senderGroup = this.#normalizeSenderType(msg.sender_type);

    // Wire click-to-open for images
    el.querySelectorAll('.bk-msg-img').forEach((img, i) => {
      img.addEventListener('click', () => this.#openImageViewer(attachments[i]?.url));
    });

    this.#messageList.appendChild(el);
    this.#recomputeDaySeparators();
    this.#recomputeMessageTimestampVisibility();
    this.#scrollToBottom();
  }

  #scrollToBottom() {
    requestAnimationFrame(() => { this.#messageList.scrollTop = this.#messageList.scrollHeight; });
  }

  /* ── CSAT (conversation rating) ─────────────────────────────── */

  #getCsatRatedIds() {
    try {
      const parsed = JSON.parse(this.#storGet(LS_CSAT_RATED_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }

  #markCsatRated(conversationId) {
    const list = this.#getCsatRatedIds();
    if (!list.includes(conversationId)) list.push(conversationId);
    this.#storSet(LS_CSAT_RATED_KEY, JSON.stringify(list.slice(-50)));
  }

  /** Inline 1-5 star rating card, shown once per conversation when it closes. */
  #showCsatPrompt() {
    const convId = this.#conversationId;
    if (!convId || !this.#messageList) return;
    if (this.#getCsatRatedIds().includes(convId)) return;
    if (this.#messageList.querySelector('.bk-csat')) return;

    const starSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
    const card = document.createElement('div');
    card.className = 'bk-csat';
    card.innerHTML = `
      <div class="bk-csat-title">How was this conversation?</div>
      <div class="bk-csat-stars" role="radiogroup" aria-label="Rate this conversation">
        ${[1, 2, 3, 4, 5].map(v => `<button type="button" class="bk-csat-star" data-score="${v}" aria-label="${v} of 5">${starSvg}</button>`).join('')}
      </div>
    `;
    const stars = [...card.querySelectorAll('.bk-csat-star')];
    const paint = (score) => stars.forEach((btn, i) => btn.classList.toggle('is-active', i < score));

    const submit = async (score) => {
      paint(score);
      stars.forEach(b => { b.disabled = true; });
      try {
        await this.#api.post(`conversation/${convId}/csat`, { score, comment: '' });
        this.#markCsatRated(convId);
        card.innerHTML = `
          <div class="bk-csat-title">Thanks for your feedback</div>
          <textarea class="bk-csat-comment" placeholder="Anything we could do better? (optional)" rows="2" maxlength="1000"></textarea>
          <button type="button" class="bk-csat-send">Send</button>
        `;
        const commentEl = card.querySelector('.bk-csat-comment');
        card.querySelector('.bk-csat-send').addEventListener('click', async () => {
          const comment = (commentEl?.value || '').trim();
          try {
            if (comment) await this.#api.post(`conversation/${convId}/csat`, { score, comment });
          } catch {}
          card.innerHTML = '<div class="bk-csat-title">Thanks for your feedback</div>';
        });
        this.#scrollToBottom();
      } catch {
        stars.forEach(b => { b.disabled = false; });
      }
    };

    stars.forEach((btn) => {
      btn.addEventListener('mouseenter', () => paint(Number(btn.dataset.score)));
      btn.addEventListener('mouseleave', () => paint(0));
      btn.addEventListener('click', () => { void submit(Number(btn.dataset.score)); });
    });
    this.#messageList.appendChild(card);
    this.#scrollToBottom();
  }

  async #loadSuggestions() {
    if (!this.#conversationId) return;
    // Hide suggestions once the conversation has started
    if (this.#messageList.querySelectorAll('.bk-msg').length > 0) {
      this.#suggChips.innerHTML = '';
      return;
    }
    this.#suggChips.innerHTML = '';
    try {
      const snap = this.#pageCtx?.getMessageSnapshot();
      const data = await this.#api.get(`conversation/${this.#conversationId}/suggestions?page_url=${encodeURIComponent(snap?.url || '')}&page_title=${encodeURIComponent(snap?.title || '')}`);
      (data?.suggestions || []).forEach(s => {
        const btn = document.createElement('button');
        btn.className = 'bk-chip';
        btn.textContent = s;
        btn.addEventListener('click', () => {
          this.#textarea.value = s;
          this.#sendBtn.disabled = false;
          this.#textarea.dispatchEvent(new Event('input'));
          this.#sendMessage();
        });
        this.#suggChips.appendChild(btn);
      });
    } catch {}
  }

  // ── Proactive suggestions (idle-triggered bubbles) ───────────────────────

  #buildProactiveContext() {
    const headings = Array.from(document.querySelectorAll('h1,h2,h3'))
      .slice(0, 10).map(h => ({ level: h.tagName, text: h.textContent.trim().slice(0, 120) }));
    const scrollY = window.scrollY || 0;
    const docH = Math.max(document.documentElement.scrollHeight, 1);
    const scrollPct = Math.round((scrollY / (docH - window.innerHeight)) * 100) || 0;
    const viewMid = scrollY + window.innerHeight / 2;
    let visibleSection = '';
    for (const h of Array.from(document.querySelectorAll('h1,h2,h3')).reverse()) {
      if (h.getBoundingClientRect().top + scrollY <= viewMid) {
        visibleSection = h.textContent.trim().slice(0, 120);
        break;
      }
    }
    return {
      agent_slug: this.#agentSlug,
      page_url: window.location.href,
      page_title: document.title,
      page_headings: headings,
      scroll_position: Math.min(100, Math.max(0, scrollPct)),
      visible_section: visibleSection,
      previous_suggestions: this.#shownProactiveSuggestions,
    };
  }

  async #onUserIdle() {
    if (this.#sm.state !== 'idle') return;
    if (this.#proactivePending) return;
    this.#proactivePending = true;
    try {
      const ctx = this.#buildProactiveContext();
      const data = await this.#api.post('proactive-suggestions', ctx);
      const suggestions = (data?.suggestions || []).filter(s => typeof s === 'string' && s.trim()).slice(0, 3);
      if (!suggestions.length) return;
      this.#shownProactiveSuggestions.push(...suggestions);
      if (this.#sm.state === 'idle') this.#renderProactiveBubbles(suggestions);
    } catch (e) {
      console.warn('[Bokito] Proactive suggestions failed:', e.message);
    } finally {
      this.#proactivePending = false;
    }
  }

  // ── Debug panel (dev builds only, when data-debug="true") ─────────────────

  #setupDebugPanel() {
    if (import.meta.env.MODE === 'production') return;
    const panel = document.createElement('div');
    panel.id = 'bk-debug-panel';
    panel.innerHTML = `
      <style>
        #bk-debug-panel{
          position:fixed;top:12px;right:12px;z-index:2147483646;
          display:flex;flex-direction:column;gap:6px;align-items:flex-end;
          font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
        }
        #bk-debug-panel .bk-dbg-label{
          font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;
          color:rgba(255,255,255,.5);padding:0 4px;
        }
        #bk-debug-panel .bk-dbg-row{display:flex;gap:6px;}
        #bk-debug-panel button{
          display:flex;align-items:center;gap:5px;
          padding:6px 11px;border-radius:8px;border:1px solid rgba(255,255,255,.15);
          background:rgba(15,30,25,.82);backdrop-filter:blur(10px);
          color:var(--bk-primary);font-size:12px;font-weight:600;cursor:pointer;
          box-shadow:0 2px 8px rgba(0,0,0,.35);transition:background .15s,transform .1s;
          white-space:nowrap;
        }
        #bk-debug-panel button:hover{background:color-mix(in srgb,var(--bk-primary) 18%,transparent);transform:translateY(-1px);}
        #bk-debug-panel button:active{transform:scale(.96);}
        #bk-debug-panel .bk-dbg-reset{color:rgba(255,200,100,.9);}
        #bk-debug-panel .bk-dbg-status{
          font-size:10px;padding:3px 8px;border-radius:6px;
          background:rgba(0,0,0,.5);color:rgba(255,255,255,.6);
          border:1px solid rgba(255,255,255,.08);display:none;
        }
        #bk-debug-panel .bk-dbg-status.visible{display:block;}
      </style>
      <div class="bk-dbg-label">Bokito debug</div>
      <div class="bk-dbg-row">
        <button class="bk-dbg-proactive" title="Send a contextual proactive question">▶ Proactive</button>
        <button class="bk-dbg-reset" title="Reset trigger-teller en verberg wolkjes">↺ Reset</button>
      </div>
      <div class="bk-dbg-status"></div>
    `;
    document.body.appendChild(panel);
    this.#debugPanel = panel;

    panel.querySelector('.bk-dbg-proactive').addEventListener('click', () => this.#triggerProactiveForce());
    panel.querySelector('.bk-dbg-reset').addEventListener('click', () => this.#resetProactiveTriggers());
  }

  #debugStatus(msg, durationMs = 2500) {
    if (!this.#debugPanel) return;
    const el = this.#debugPanel.querySelector('.bk-dbg-status');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('visible');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('visible'), durationMs);
  }

  async #triggerProactiveForce() {
    if (this.#proactivePending) { this.#debugStatus('Working…'); return; }
    this.#debugStatus('Ophalen…');
    this.#proactivePending = true;
    try {
      const ctx = this.#buildProactiveContext();
      const data = await this.#api.post('proactive-suggestions', ctx);
      const suggestions = (data?.suggestions || []).filter(s => typeof s === 'string' && s.trim()).slice(0, 3);
      if (!suggestions.length) { this.#debugStatus('No suggestions returned'); return; }
      this.#shownProactiveSuggestions.push(...suggestions);
      this.#renderProactiveBubbles(suggestions);
      this.#debugStatus(`${suggestions.length} wolkje(s) getoond`);
    } catch (e) {
      this.#debugStatus('Fout: ' + e.message);
      console.warn('[Bokito debug] Proactive trigger failed:', e.message);
    } finally {
      this.#proactivePending = false;
    }
  }

  #resetProactiveTriggers() {
    sessionStorage.removeItem('bokito_proactive_count');
    this.#shownProactiveSuggestions = [];
    this.#dismissProactiveBubbles();
    this.#idleWatcher?.resume();
    this.#debugStatus('Triggers gereset');
  }

  #renderProactiveBubbles(suggestions) {
    if (!this.#proactiveBubbles) return;
    this.#proactiveBubbles.innerHTML = '';
    this.#proactiveBubbles.classList.remove('is-dismissing');
    suggestions.forEach(text => {
      const btn = document.createElement('button');
      btn.className = 'bk-proactive-bubble';
      btn.textContent = text;
      btn.addEventListener('click', () => this.#onProactiveBubbleClick(text));
      this.#proactiveBubbles.appendChild(btn);
    });
    this.#proactiveBubbles.hidden = false;
    clearTimeout(this.#proactiveDismissTimer);
    this.#proactiveDismissTimer = setTimeout(() => this.#dismissProactiveBubbles({ resumeWatcher: true }), 15000);
  }

  #dismissProactiveBubbles({ resumeWatcher = false } = {}) {
    clearTimeout(this.#proactiveDismissTimer);
    if (!this.#proactiveBubbles || this.#proactiveBubbles.hidden) return;
    this.#proactiveBubbles.classList.add('is-dismissing');
    setTimeout(() => {
      this.#proactiveBubbles.hidden = true;
      this.#proactiveBubbles.classList.remove('is-dismissing');
      this.#proactiveBubbles.innerHTML = '';
      if (resumeWatcher) this.#idleWatcher?.resume();
    }, 300);
  }

  async #onProactiveBubbleClick(text) {
    this.#dismissProactiveBubbles();
    this.#idleWatcher?.pause();
    await this.#openWidget();
    await new Promise(r => setTimeout(r, 100));
    if (this.#sm.state === 'home') {
      await this.#startNewConversation();
      await new Promise(r => setTimeout(r, 100));
    }
    if (this.#conversationId && this.#textarea) {
      this.#textarea.value = text;
      this.#sendBtn.disabled = false;
      this.#textarea.dispatchEvent(new Event('input'));
      this.#sendMessage();
    }
  }

  // ── Attachment helpers ────────────────────────────────────────────────────

  #updateSendBtnState() {
    const hasText = !!this.#textarea.value.trim();
    const hasReady = this.#pendingAttachments.some(a => !a.uploading);
    this.#sendBtn.disabled = !hasText && !hasReady;
  }

  async #handleFileSelect(files) {
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      if (file.size > 10 * 1024 * 1024) { this.#showError('Images can be up to 10 MB.'); continue; }

      const localUrl = URL.createObjectURL(file);
      const entry = { localUrl, id: null, url: null, mime: null, name: null, size: null, uploading: true };
      this.#pendingAttachments.push(entry);
      this.#renderPreviewStrip();
      this.#updateSendBtnState();

      try {
        const fd = new FormData();
        fd.append('session_token', this.#sessionToken);
        fd.append('file', file);
        const res = await fetch(livechatHttpUrl(this.#apiUrl, livechatRoutes.attachment), {
          method: 'POST',
          headers: this.#sessionToken ? { Authorization: `Bearer ${this.#sessionToken}` } : {},
          body: fd,
        });
        if (!res.ok) throw new Error('Upload failed');
        const data = await res.json();
        entry.id = data.id;
        entry.url = data.url;
        entry.mime = data.mime || file.type || null;
        entry.name = data.name || file.name || null;
        entry.size = data.size ?? file.size ?? null;
        entry.uploading = false;
      } catch {
        // Remove failed upload from list
        const idx = this.#pendingAttachments.indexOf(entry);
        if (idx !== -1) this.#pendingAttachments.splice(idx, 1);
        URL.revokeObjectURL(localUrl);
        this.#showError('Upload failed. Try again.');
      }
      this.#renderPreviewStrip();
      this.#updateSendBtnState();
    }
  }

  #handlePaste(e) {
    const items = Array.from(e.clipboardData?.items ?? []);
    const imageItems = items.filter(it => it.type.startsWith('image/'));
    if (!imageItems.length) return;
    e.preventDefault();
    const files = imageItems.map(it => it.getAsFile()).filter(Boolean);
    this.#handleFileSelect(files);
  }

  #renderPreviewStrip() {
    if (!this.#pendingAttachments.length) {
      this.#previewStrip.style.display = 'none';
      this.#previewStrip.innerHTML = '';
      return;
    }
    this.#previewStrip.style.display = 'flex';
    this.#previewStrip.innerHTML = '';
    this.#pendingAttachments.forEach((att, idx) => {
      const item = document.createElement('div');
      item.className = 'bk-preview-item';

      const img = document.createElement('img');
      img.src = att.localUrl;
      img.alt = '';
      item.appendChild(img);

      if (att.uploading) {
        const spinner = document.createElement('div');
        spinner.className = 'bk-preview-spinner';
        spinner.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10" stroke-opacity=".25"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>`;
        item.appendChild(spinner);
      } else {
        const rm = document.createElement('button');
        rm.className = 'bk-preview-remove';
        rm.setAttribute('aria-label', 'Remove image');
        rm.textContent = '×';
        rm.addEventListener('click', () => {
          URL.revokeObjectURL(att.localUrl);
          this.#pendingAttachments.splice(idx, 1);
          this.#renderPreviewStrip();
          this.#updateSendBtnState();
        });
        item.appendChild(rm);
      }
      this.#previewStrip.appendChild(item);
    });
  }

  // ── End attachment helpers ─────────────────────────────────────────────────

  #showHome() {
    this.#sm.transition('home');
    if (!this.#activeHomeTab) this.#switchHomeTab('home');
  }

  #switchHomeTab(tab) {
    if (tab !== 'home' && tab !== 'messages' && tab !== 'tools' && tab !== 'help') tab = 'home';
    this.#activeHomeTab = tab;
    this.#root.querySelectorAll('.bk-home-tab').forEach((el) => {
      el.hidden = el.dataset.tab !== tab;
    });
    this.#root.querySelectorAll('.bk-tab-btn').forEach((btn) => {
      const isActive = btn.dataset.tab === tab;
      btn.classList.toggle('is-active', isActive);
      // The hidden state of the Help button is data-driven (published
      // articles exist); toggling classes must not reveal it.
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    if (tab === 'messages') this.#loadConversationHistory();
    if (tab === 'tools') this.#renderToolbox();
    if (tab === 'help') this.#renderHelpList();
  }

  /* ── Help center (published knowledge-base articles) ────────── */

  #helpTenantSlug() {
    return this.#sessionTenant?.slug || this.#tenantSubdomain || null;
  }

  /** Fetch the public article index once per session; the Help tab only
   * appears when the tenant actually published articles. */
  async #maybeLoadHelpArticles() {
    const slug = this.#helpTenantSlug();
    if (!slug || this.#helpArticles !== null) return;
    try {
      const r = await fetch(apiGroupUrl(this.#apiUrl, 'help', `/${encodeURIComponent(slug)}`));
      const data = r.ok ? await r.json() : null;
      this.#helpArticles = Array.isArray(data?.articles) ? data.articles : [];
    } catch {
      this.#helpArticles = [];
    }
    const btn = this.#root.querySelector('.bk-tab-btn[data-tab="help"]');
    if (btn) btn.hidden = !this.#helpModuleEnabled || this.#helpArticles.length === 0;
  }

  #renderHelpList() {
    const listView = this.#root.querySelector('.bk-help-list-view');
    const articleView = this.#root.querySelector('.bk-help-article');
    const list = this.#root.querySelector('.bk-help-list');
    if (!listView || !articleView || !list) return;
    listView.hidden = false;
    articleView.hidden = true;
    const query = (this.#root.querySelector('.bk-help-search')?.value || '').trim().toLowerCase();
    const articles = (this.#helpArticles || []).filter((a) => {
      if (!query) return true;
      return (a.title || '').toLowerCase().includes(query)
        || (a.description || '').toLowerCase().includes(query);
    });
    list.innerHTML = '';
    if (!articles.length) {
      const empty = document.createElement('div');
      empty.className = 'bk-help-empty';
      empty.textContent = query ? 'No articles match your search.' : 'No articles yet.';
      list.appendChild(empty);
      return;
    }
    articles.forEach((article) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'bk-help-item';
      const title = document.createElement('div');
      title.className = 'bk-help-item-title';
      title.textContent = article.title || 'Untitled';
      el.appendChild(title);
      if (article.description) {
        const desc = document.createElement('div');
        desc.className = 'bk-help-item-desc';
        desc.textContent = article.description;
        el.appendChild(desc);
      }
      el.addEventListener('click', () => { void this.#openHelpArticle(article.slug); });
      list.appendChild(el);
    });
  }

  async #openHelpArticle(slug) {
    const tenantSlug = this.#helpTenantSlug();
    if (!tenantSlug || !slug) return;
    const listView = this.#root.querySelector('.bk-help-list-view');
    const articleView = this.#root.querySelector('.bk-help-article');
    const titleEl = this.#root.querySelector('.bk-help-article-title');
    const bodyEl = this.#root.querySelector('.bk-help-article-body');
    if (!listView || !articleView || !titleEl || !bodyEl) return;
    try {
      const r = await fetch(apiGroupUrl(
        this.#apiUrl, 'help',
        `/${encodeURIComponent(tenantSlug)}/${encodeURIComponent(slug)}`,
      ));
      if (!r.ok) return;
      const article = await r.json();
      titleEl.textContent = article.title || 'Untitled';
      // MarkdownRenderer escapes HTML before converting, so this is safe.
      bodyEl.innerHTML = MarkdownRenderer.render(article.content || '');
      listView.hidden = true;
      articleView.hidden = false;
      const section = articleView.closest('.bk-home-section');
      if (section) section.scrollTop = 0;
    } catch {
      // Keep the list visible when the article fails to load.
    }
  }
  #closeWindow() {
    if (this.#settingsView && this.#settingsView.style.display !== 'none') this.#hideSettings();
    this.#closeImageViewer();
    if (this.#isPreviewEmbedded()) return;
    this.#playSound('close');
    this.#sm.transition('idle');
  }

  #showSettings() {
    this.#preSettingsView = this.#computeActiveViewName();
    if (this.#homeView) this.#homeView.style.display = 'none';
    if (this.#chatView) this.#chatView.style.display = 'none';
    if (this.#loginRequiredView) this.#loginRequiredView.style.display = 'none';
    if (this.#settingsView) this.#settingsView.style.display = '';
    if (this.#backBtn) this.#backBtn.hidden = false;
    this.#updateHeaderActionButtons(this.#sm?.state ?? 'home');
    this.#syncWindowPowered();
    this.#syncSettingsForm();
  }

  #hideSettings() {
    if (this.#settingsView) this.#settingsView.style.display = 'none';
    const restore = this.#preSettingsView || 'home';
    this.#preSettingsView = null;
    this.#showView(restore);
    this.#updateHeaderActionButtons(this.#sm?.state ?? 'home');
  }

  #computeActiveViewName() {
    if (this.#chatView && this.#chatView.style.display !== 'none') return 'chat';
    if (this.#loginRequiredView && this.#loginRequiredView.style.display !== 'none') return 'login';
    return 'home';
  }

  #syncSettingsForm() {
    const theme = this.#storGet(LS_THEME_KEY) || 'system';
    this.#settingsView?.querySelectorAll('input[name="bk-theme"]').forEach((radio) => {
      radio.checked = radio.value === theme;
    });
    const effectsEl = this.#root.querySelector('#bk-sound-effects-pref');
    const notifEl = this.#root.querySelector('#bk-sound-notifications-pref');
    if (effectsEl) effectsEl.checked = this.#soundEffectsEnabled;
    if (notifEl) notifEl.checked = this.#soundNotificationsEnabled;
  }

  #hydrateUserPreferences(preferences = {}) {
    if (!preferences || typeof preferences !== 'object') return;
    const theme = preferences.theme;
    if (theme === 'light' || theme === 'dark' || theme === 'system') {
      this.#storSet(LS_THEME_KEY, theme);
    }
    if (typeof preferences.sound_effects === 'boolean') {
      this.#storSet(LS_SOUND_EFFECTS_KEY, preferences.sound_effects ? 'on' : 'off');
    }
    if (typeof preferences.sound_notifications === 'boolean') {
      this.#storSet(LS_SOUND_NOTIFICATIONS_KEY, preferences.sound_notifications ? 'on' : 'off');
    }
    if (Array.isArray(preferences.hidden_conversations)) {
      this.#storSet(LS_HIDDEN_CONVERSATIONS_KEY, JSON.stringify(preferences.hidden_conversations));
    }
    this.#storSet(LS_PREFERENCES_CACHE_KEY, JSON.stringify(preferences));
    this.#isPreferencesHydrated = true;
    this.#soundEffectsEnabled = this.#storGet(LS_SOUND_EFFECTS_KEY) !== 'off';
    this.#soundNotificationsEnabled = this.#storGet(LS_SOUND_NOTIFICATIONS_KEY) !== 'off';
    this.#refreshChromeFromThemeAndPreview();
    this.#syncSettingsForm();
  }

  async #fetchRemotePreferences() {
    if (!this.#sessionToken) return null;
    try {
      const data = await this.#api.get('user/preferences');
      if (!data) return null;
      const prefs = data.preferences || data;
      this.#hydrateUserPreferences(prefs);
      return prefs;
    } catch {
      return null;
    }
  }

  async #persistPreferencePatch(patch = {}) {
    if (!patch || typeof patch !== 'object') return;
    const cachedRaw = this.#storGet(LS_PREFERENCES_CACHE_KEY);
    let cached = {};
    if (cachedRaw) {
      try { cached = JSON.parse(cachedRaw); } catch {}
    }
    const next = { ...cached, ...patch };
    this.#storSet(LS_PREFERENCES_CACHE_KEY, JSON.stringify(next));
    if (!this.#sessionToken) return;
    try {
      await this.#api.patch('user/preferences', { preferences: patch });
    } catch {}
  }

  #loadUserPreferences() {
    const cachedRaw = this.#storGet(LS_PREFERENCES_CACHE_KEY);
    if (cachedRaw) {
      try { this.#hydrateUserPreferences(JSON.parse(cachedRaw)); } catch {}
    }
    this.#soundEffectsEnabled = this.#storGet(LS_SOUND_EFFECTS_KEY) !== 'off';
    this.#soundNotificationsEnabled = this.#storGet(LS_SOUND_NOTIFICATIONS_KEY) !== 'off';
    this.#refreshChromeFromThemeAndPreview();
    this.#syncSettingsForm();
    if (this.#sessionToken) this.#fetchRemotePreferences();
    this.#ensureThemeSchemeListener();
  }

  #ensureThemeSchemeListener() {
    if (this.#themeSchemeListenerBound) return;
    this.#themeSchemeListenerBound = true;
    this.#themeSchemeMedia = window.matchMedia('(prefers-color-scheme: dark)');
    this.#themeSchemeMedia.addEventListener('change', () => {
      const stored = this.#storGet(LS_THEME_KEY) || 'system';
      if (stored === 'light' || stored === 'dark') return;
      this.#syncUserPopoverThemeToggle();
      this.#syncAgentWindowAtmosphere();
    });
  }

  #effectiveUserThemeIsDark() {
    const stored = this.#storGet(LS_THEME_KEY) || 'system';
    if (stored === 'dark') return true;
    if (stored === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  #syncUserPopoverThemeToggle() {
    const btn = this.#root?.querySelector?.('.bk-user-popover-theme-btn');
    if (!btn) return;
    const icon = btn.querySelector('.bk-user-popover-theme-icon');
    const cap = btn.querySelector('.bk-user-popover-theme-caption');
    if (!icon || !cap) return;
    const dark = this.#effectiveUserThemeIsDark();
    if (dark) {
      icon.innerHTML = ICONS.sun;
      cap.textContent = 'Light mode';
      btn.setAttribute('aria-label', 'Switch to light theme');
    } else {
      icon.innerHTML = ICONS.moon;
      cap.textContent = 'Dark mode';
      btn.setAttribute('aria-label', 'Switch to dark theme');
    }
  }

  #applyUserThemeOverride() {
    if (!this.#isPreviewEmbedded()) {
      const theme = this.#storGet(LS_THEME_KEY) || 'system';
      if (theme === 'light' || theme === 'dark') this.setAttribute('data-theme', theme);
      else this.removeAttribute('data-theme');
    }
    this.#syncUserPopoverThemeToggle();
  }

  #setUserTheme(value) {
    this.#storSet(LS_THEME_KEY, value);
    this.#refreshChromeFromThemeAndPreview();
    this.#syncSettingsForm();
    this.#persistPreferencePatch({ theme: value });
  }

  #setUserSoundEffects(checked) {
    this.#soundEffectsEnabled = checked;
    this.#storSet(LS_SOUND_EFFECTS_KEY, checked ? 'on' : 'off');
    this.#persistPreferencePatch({ sound_effects: !!checked });
  }

  #setUserSoundNotifications(checked) {
    this.#soundNotificationsEnabled = checked;
    this.#storSet(LS_SOUND_NOTIFICATIONS_KEY, checked ? 'on' : 'off');
    this.#persistPreferencePatch({ sound_notifications: !!checked });
  }

  #updateUnreadBadge(total) {
    this.#unreadTotal = total;
    if (!this.#badge) return;
    if (total > 0) {
      this.#badge.textContent = total > 99 ? '99+' : String(total);
      this.#badge.style.display = '';
    } else {
      this.#badge.style.display = 'none';
    }
  }

  async #startRecording() {
    try {
      this.#recordStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.#recordedTranscript = '';
      this.#recordChunks = [];
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        this.#speechRecognition = new SpeechRecognition();
        this.#speechRecognition.continuous = true;
        this.#speechRecognition.interimResults = true;
        this.#speechRecognition.lang = document.documentElement.lang || 'en-US';
        this.#speechRecognition.onresult = (e) => {
          const last = e.results.length - 1;
          const transcript = e.results[last][0].transcript;
          if (e.results[last].isFinal) this.#recordedTranscript += (this.#recordedTranscript ? ' ' : '') + transcript;
        };
        this.#speechRecognition.start();
      }
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      this.#recordMimeType = mimeType;
      try {
        this.#mediaRecorder = new MediaRecorder(this.#recordStream, { mimeType });
      } catch {
        this.#mediaRecorder = new MediaRecorder(this.#recordStream);
        this.#recordMimeType = this.#mediaRecorder.mimeType || mimeType;
      }
      this.#mediaRecorder.ondataavailable = (e) => { if (e.data.size) this.#recordChunks.push(e.data); };
      this.#mediaRecorder.start(200);
      this.#recordStartBtn.hidden = true;
      this.#recordActionsWrap.hidden = false;
    } catch (err) {
      console.warn('[Bokito] Microphone unavailable:', err);
      this.#showError('Microphone unavailable. Check the browser permission.');
    }
  }

  #stopRecording() {
    if (this.#mediaRecorder && this.#mediaRecorder.state !== 'inactive') {
      this.#mediaRecorder.stop();
      this.#mediaRecorder = null;
    }
    if (this.#speechRecognition) {
      try { this.#speechRecognition.stop(); } catch {}
      this.#speechRecognition = null;
    }
    if (this.#recordStream) {
      this.#recordStream.getTracks().forEach((t) => t.stop());
      this.#recordStream = null;
    }
    this.#recordStartBtn.hidden = false;
    this.#recordActionsWrap.hidden = true;
  }

  /** Stop mic + MediaRecorder and return audio Blob (waits for final MediaRecorder chunk). */
  async #finalizeVoiceRecording() {
    const mimeType = this.#recordMimeType || 'audio/webm';
    if (this.#speechRecognition) {
      try { this.#speechRecognition.stop(); } catch {}
      this.#speechRecognition = null;
    }
    const mr = this.#mediaRecorder;
    if (mr && mr.state !== 'inactive') {
      await new Promise((resolve) => {
        mr.addEventListener('stop', () => resolve(), { once: true });
        mr.stop();
      });
    }
    this.#mediaRecorder = null;
    if (this.#recordStream) {
      this.#recordStream.getTracks().forEach((t) => t.stop());
      this.#recordStream = null;
    }
    const chunks = this.#recordChunks;
    this.#recordChunks = [];
    if (!chunks.length) return null;
    const blob = new Blob(chunks, { type: mimeType });
    return blob.size > 0 ? blob : null;
  }

  async #postTranscribe(blob) {
    const path = this.#transcribePath();
    if (!path) return null;
    const url = livechatHttpUrl(this.#apiUrl, path);
    const buildFd = () => {
      const fd = new FormData();
      if (this.#sessionToken) fd.append('session_token', this.#sessionToken);
      fd.append('audio', blob, 'recording.webm');
      fd.append('language', (document.documentElement.lang || 'en').slice(0, 2));
      return fd;
    };
    if (!this.#sessionToken) await this.#initSession();
    if (!this.#sessionToken) return null;
    const headers = { Authorization: `Bearer ${this.#sessionToken}` };
    let r = await fetch(url, { method: 'POST', body: buildFd(), headers });
    if (r.status === 401) {
      await this.#initSession();
      if (!this.#sessionToken) return null;
      r = await fetch(url, { method: 'POST', body: buildFd(), headers: { Authorization: `Bearer ${this.#sessionToken}` } });
    }
    return r;
  }

  #cancelRecording() {
    this.#stopRecording();
    this.#recordedTranscript = '';
    this.#recordChunks = [];
  }

  async #confirmRecording() {
    const speechFallback = this.#recordedTranscript.trim();
    this.#recordedTranscript = '';
    this.#recordStartBtn.hidden = false;
    this.#recordActionsWrap.hidden = true;

    const prevPh = this.#textarea ? this.#textarea.placeholder : '';
    if (this.#textarea) this.#textarea.placeholder = 'Transcribing…';
    if (this.#recordConfirmBtn) this.#recordConfirmBtn.disabled = true;
    if (this.#recordCancelBtn) this.#recordCancelBtn.disabled = true;

    let blob = null;
    try {
      blob = await this.#finalizeVoiceRecording();
    } finally {
      if (this.#textarea) this.#textarea.placeholder = prevPh;
      if (this.#recordConfirmBtn) this.#recordConfirmBtn.disabled = false;
      if (this.#recordCancelBtn) this.#recordCancelBtn.disabled = false;
    }

    let text = '';
    if (blob && this.#apiUrl) {
      try {
        const res = await this.#postTranscribe(blob);
        if (res && res.ok) {
          const data = await res.json().catch(() => ({}));
          text = (data.text || '').trim();
        }
      } catch (e) {
        console.warn('[Bokito] Transcribe failed:', e);
      }
    }
    if (!text) text = speechFallback;
    if (text) this.#sendMessageWithContent(text, []);
    else this.#showError('No speech recognized. Try again.');
  }

  #initSounds() {
    // Sounds generated via Web Audio API — no external files needed.
    // AudioContext is lazy-initialised on first play to respect autoplay policy.
  }

  #playSound(key) {
    const isEffect = key === 'open' || key === 'close';
    if (isEffect && !this.#soundEffectsEnabled) return;
    if (!isEffect && !this.#soundNotificationsEnabled) return;
    try {
      if (!this.#audioCtx) {
        this.#audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      const ctx = this.#audioCtx;

      // Helper: play a tone burst with fade-in/out
      const tone = (freq, duration, gain = 0.25, delay = 0, type = 'sine') => {
        const osc = ctx.createOscillator();
        const vol = ctx.createGain();
        osc.connect(vol);
        vol.connect(ctx.destination);
        osc.type = type;
        osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
        vol.gain.setValueAtTime(0, ctx.currentTime + delay);
        vol.gain.linearRampToValueAtTime(gain, ctx.currentTime + delay + 0.01);
        vol.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + duration);
        osc.start(ctx.currentTime + delay);
        osc.stop(ctx.currentTime + delay + duration + 0.01);
      };

      switch (key) {
        case 'open':     tone(440, 0.14, 0.18); tone(554, 0.2, 0.14, 0.12); break;
        case 'close':    tone(370, 0.18, 0.15); tone(294, 0.16, 0.12, 0.13); break;
        case 'incoming': tone(523, 0.12, 0.15); tone(659, 0.22, 0.12, 0.11); break;
        case 'outgoing': tone(440, 0.09, 0.12); break;
      }
    } catch {}
  }

  #showError(msg) {
    const el = document.createElement('div');
    el.className = 'bk-error-msg';
    el.style.cssText = 'position:absolute;bottom:70px;left:8px;right:8px;z-index:10;';
    el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><span>${msg}</span>`;
    this.#window.appendChild(el);
    setTimeout(() => el.remove(), 6000);
  }
}

/* ── Register & auto-mount ──────────────────────────────────── */
if (!customElements.get('bokito-chat')) {
  customElements.define('bokito-chat', BokitoChatWidget);
}

(function autoMount() {
  // Read config from <script data-agent-slug="..."> or window.BokitoConfig
  const scriptEl = document.currentScript
    || document.querySelector('script[data-agent-slug]')
    || document.querySelector('script[src*="bokito-chat"]');

  const cfg = window.BokitoConfig || {};
  const scriptSrc = scriptEl?.src || '';
  const apiFromSrc = (() => {
    for (const marker of ['/api/livechat', '/api/livechat', '/chat-widget/']) {
      const idx = scriptSrc.indexOf(marker);
      if (idx > 0) return scriptSrc.slice(0, idx);
    }
    return '';
  })();
  const slug    = scriptEl?.dataset?.agentSlug || cfg.agentSlug || '';
  const apiUrl  = normalizeLivechatApiBase(scriptEl?.dataset?.apiUrl || cfg.apiUrl || apiFromSrc || '');
  const idToken = scriptEl?.dataset?.identityToken || cfg.identityToken || null;
  const authToken = scriptEl?.dataset?.authToken || cfg.authToken || null;
  const authCookieName = scriptEl?.dataset?.authCookieName || cfg.authCookieName || '';
  const authMode = scriptEl?.dataset?.authMode || cfg.authMode || '';
  const tenant = scriptEl?.dataset?.tenant || cfg.tenant || '';
  const signinUrl = scriptEl?.dataset?.signinUrl || cfg.signinUrl || '';
  const csrfToken = scriptEl?.dataset?.csrfToken || cfg.csrfToken || '';
  const qp = new URLSearchParams(window.location.search);
  const debug   = scriptEl?.dataset?.debug === 'true' || cfg.debug === true
    || qp.get('bk_debug') === '1';

  if (!slug) return;

  function mount() {
    if (document.querySelector('bokito-chat')) return;
    const widget = document.createElement('bokito-chat');
    widget.dataset.agentSlug = slug;
    widget.dataset.apiUrl    = apiUrl;
    if (idToken) widget.dataset.identityToken = idToken;
    if (authToken) widget.dataset.authToken = String(authToken);
    if (authCookieName) widget.dataset.authCookieName = String(authCookieName);
    if (authMode) widget.dataset.authMode = String(authMode);
    if (tenant) widget.dataset.tenant = String(tenant);
    if (signinUrl) widget.dataset.signinUrl = String(signinUrl);
    if (csrfToken) widget.dataset.csrfToken = String(csrfToken);
    if (debug)   widget.dataset.debug = 'true';
    if (cfg.clientSimulateStream === false || qp.get('bk_sse_smooth') === '0') {
      widget.dataset.clientSimulateStream = 'false';
    }
    if (cfg.clientSimulateMinChars != null) {
      widget.dataset.clientSimulateMinChars = String(cfg.clientSimulateMinChars);
    }
    if (cfg.clientSimulateChunk != null) {
      widget.dataset.clientSimulateChunk = String(cfg.clientSimulateChunk);
    }
    if (cfg.clientSimulateMs != null) {
      widget.dataset.clientSimulateMs = String(cfg.clientSimulateMs);
    }
    document.body.appendChild(widget);
    window.bokitoChat = widget;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
