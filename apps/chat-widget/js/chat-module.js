/**
 * Bokito Chat Widget — chat-module.js
 * ES2022+, Shadow DOM, State Machine, full session management
 * Supports JWT identity tokens for role-based access control
 */

/* ══════════════════════════════════════════════════════════════
   UTILITIES
══════════════════════════════════════════════════════════════ */

/** Minimal Markdown → HTML renderer */
class MarkdownRenderer {
  static render(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/```[\s\S]*?```/g, m => {
        const code = m.slice(3, -3).replace(/^\w+\n/, '');
        return `<pre><code>${code}</code></pre>`;
      })
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/^[-*] (.+)/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`)
      .replace(/\n{2,}/g, '</p><p>')
      .replace(/^(.+)$/gm, (m) => m.startsWith('<') ? m : `<p>${m}</p>`)
      .replace(/<p><\/p>/g, '');
  }
}

/** PII filter for page content before sending to server */
class PIIFilter {
  static #EMAIL_RE  = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Z|a-z]{2,}\b/g;
  static #CREDIT_RE = /\b(?:\d[ -]?){13,16}\b/g;
  static #BSN_RE    = /\b\d{9}\b/g;
  static #PHONE_RE  = /\+?[\d\s\-().]{10,}/g;

  static filter(text) {
    if (!text) return text;
    return text
      .replace(PIIFilter.#EMAIL_RE,  '[email]')
      .replace(PIIFilter.#CREDIT_RE, '[card]')
      .replace(PIIFilter.#BSN_RE,    '[id]')
      .replace(PIIFilter.#PHONE_RE,  '[phone]');
  }
}

/** Format timestamp to relative/absolute */
function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now - d;
  const diffM  = Math.floor(diffMs / 60000);
  const diffH  = Math.floor(diffMs / 3600000);
  const diffD  = Math.floor(diffMs / 86400000);
  if (diffM < 1)  return 'nu';
  if (diffM < 60) return `${diffM}m`;
  if (diffH < 24) return `${diffH}u`;
  if (diffD < 7)  return `${diffD}d`;
  return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
}

const LIVECHAT_PATH_SEGMENT = /^[a-zA-Z0-9_-]{1,64}$/;
function livechatPathSegment(raw, fallback) {
  const s = typeof raw === 'string' ? raw.trim() : '';
  return LIVECHAT_PATH_SEGMENT.test(s) ? s : fallback;
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

/* ══════════════════════════════════════════════════════════════
   API CLIENT
══════════════════════════════════════════════════════════════ */

class ApiClient {
  #baseUrl;
  #token = null;
  #agentSlug;
  #onSessionExpired;
  #stateMachine;
  #identityTokenGetter;

  constructor({ baseUrl, agentSlug, stateMachine, onSessionExpired, identityTokenGetter }) {
    this.#baseUrl             = baseUrl.replace(/\/$/, '');
    this.#agentSlug           = agentSlug;
    this.#stateMachine        = stateMachine;
    this.#onSessionExpired    = onSessionExpired;
    this.#identityTokenGetter = identityTokenGetter;
  }

  setToken(token) { this.#token = token; }

  #authHeaders(extra = {}) {
    return {
      'Content-Type': 'application/json',
      ...(this.#token ? { 'Authorization': `Bearer ${this.#token}` } : {}),
      ...extra,
    };
  }

  async #refreshSession() {
    try {
      const customerId    = localStorage.getItem('bokito_customer_id');
      const identityToken = this.#identityTokenGetter?.();
      const tenantSubdomain = resolveTenantSubdomainFromHost();
      const body          = { agent_slug: this.#agentSlug, customer_id: customerId };
      if (identityToken) body.identity_token = identityToken;
      if (tenantSubdomain) body.tenant_subdomain = tenantSubdomain;

      const res = await fetch(`${this.#baseUrl}/api/livechat/session/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) return false;
      const data = await res.json();
      this.#token = data.session_token;
      if (this.#onSessionExpired) this.#onSessionExpired(data);
      return true;
    } catch { return false; }
  }

  async request(path, options = {}) {
    const url  = `${this.#baseUrl}/api/livechat/${path}`;
    const opts = { ...options, headers: this.#authHeaders(options.headers) };

    let res = await fetch(url, opts);

    if (res.status === 401) {
      const ok = await this.#refreshSession();
      if (!ok) {
        this.#stateMachine.transition('error');
        return null;
      }
      opts.headers = this.#authHeaders(options.headers);
      res = await fetch(url, opts);
    }

    return res;
  }

  async get(path) {
    const sep      = path.includes('?') ? '&' : '?';
    const fullPath = this.#token ? `${path}${sep}session_token=${encodeURIComponent(this.#token)}` : path;
    const res      = await this.request(fullPath, { method: 'GET' });
    if (!res?.ok) return null;
    return res.json();
  }

  async post(path, body) {
    const fullBody = this.#token ? { ...body, session_token: this.#token } : body;
    const res = await this.request(path, {
      method: 'POST',
      body: JSON.stringify(fullBody),
    });
    if (!res?.ok) {
      const err = await res?.json().catch(() => ({}));
      throw new Error(err?.message || `Request failed: ${res?.status}`);
    }
    return res.json();
  }

  async patch(path, body) {
    const fullBody = this.#token ? { ...body, session_token: this.#token } : body;
    const res = await this.request(path, {
      method: 'PATCH',
      body: JSON.stringify(fullBody),
    });
    return res?.ok ? res.json() : null;
  }
}

/* ══════════════════════════════════════════════════════════════
   REALTIME CLIENT
══════════════════════════════════════════════════════════════ */

class RealtimeClient {
  #url;
  #channelName;
  #token;
  #onEvent;
  #socket = null;
  #reconnectAttempts = 0;
  #maxReconnectDelay = 30000;
  #reconnectTimer = null;
  #onReconnect;

  constructor({ url, channelName, token, onEvent, onReconnect }) {
    this.#url         = url;
    this.#channelName = channelName;
    this.#token       = token;
    this.#onEvent     = onEvent;
    this.#onReconnect = onReconnect;
  }

  connect() {
    try {
      this.#socket = new WebSocket(`${this.#url}?token=${this.#token}&channel=${encodeURIComponent(this.#channelName)}`);
      this.#socket.onmessage = (e) => {
        try { this.#onEvent(JSON.parse(e.data)); } catch {}
      };
      this.#socket.onopen = () => {
        const wasReconnect = this.#reconnectAttempts > 0;
        this.#reconnectAttempts = 0;
        if (wasReconnect && this.#onReconnect) this.#onReconnect();
      };
      this.#socket.onclose = () => this.#scheduleReconnect();
      this.#socket.onerror = () => this.#socket?.close();
    } catch { this.#scheduleReconnect(); }
  }

  #scheduleReconnect() {
    const delay = Math.min(1000 * Math.pow(2, this.#reconnectAttempts), this.#maxReconnectDelay);
    this.#reconnectAttempts++;
    clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  disconnect() {
    clearTimeout(this.#reconnectTimer);
    this.#socket?.close();
    this.#socket = null;
  }
}

/* ══════════════════════════════════════════════════════════════
   PAGE CONTEXT MANAGER
══════════════════════════════════════════════════════════════ */

class PageContextManager {
  #conversationId = null;
  #apiClient;
  #debounceTimer = null;

  constructor(apiClient) {
    this.#apiClient = apiClient;
    window.addEventListener('chatContextUpdate', () => this.#pushContext());
    window.addEventListener('popstate', () => this.#pushContext());
  }

  setConversationId(id) {
    this.#conversationId = id;
    this.#pushContext();
  }

  /** Lightweight snapshot for each message (url + title + chatContext) */
  getMessageSnapshot() {
    const ctx = window.chatContext || {};
    return {
      url: window.location.href,
      title: document.title,
      chat_context: PIIFilter.filter(JSON.stringify(ctx)),
    };
  }

  /** Full page context for PATCH /context (cached for get_page_content tool) */
  async #pushContext() {
    if (!this.#conversationId) return;
    clearTimeout(this.#debounceTimer);
    this.#debounceTimer = setTimeout(async () => {
      const ctx = this.#buildFullContext();
      await this.#apiClient.patch(
        `conversation/${this.#conversationId}/context`,
        { page_context: ctx }
      );
    }, 800);
  }

  #buildFullContext() {
    const structured = window.chatContext || null;
    const headings = Array.from(document.querySelectorAll('h1,h2,h3'))
      .slice(0, 10)
      .map(h => ({ level: h.tagName, text: h.textContent.trim().slice(0, 120) }));
    const bodyClone = document.body.cloneNode(true);
    bodyClone.querySelectorAll('script,style,nav,footer,aside,input,textarea').forEach(el => el.remove());
    const rawText      = bodyClone.innerText || bodyClone.textContent || '';
    const filteredText = PIIFilter.filter(rawText.trim().replace(/\s+/g, ' ').slice(0, 3000));
    return {
      url: window.location.href,
      title: document.title,
      headings,
      structured_data: structured,
      text: filteredText,
    };
  }
}

/* ══════════════════════════════════════════════════════════════
   STATE MACHINE
══════════════════════════════════════════════════════════════ */

class StateMachine {
  #state = 'idle';
  #listeners = new Map();
  #validTransitions = {
    idle:          ['home', 'login_required'],
    home:          ['idle', 'connecting', 'active', 'login_required'],
    connecting:    ['active', 'error'],
    active:        ['home', 'processing', 'agent_mode', 'error'],
    processing:    ['active', 'agent_mode', 'error'],
    agent_mode:    ['home', 'active'],
    history:       ['home', 'active'],
    error:         ['home', 'idle'],
    login_required: ['home', 'idle'],
  };

  get state() { return this.#state; }

  transition(next, data) {
    const allowed = this.#validTransitions[this.#state];
    if (!allowed?.includes(next)) {
      console.warn(`[SM] Invalid transition: ${this.#state} → ${next}`);
      return false;
    }
    const prev = this.#state;
    this.#state = next;
    this.#listeners.get('*')?.forEach(fn => fn(next, prev, data));
    this.#listeners.get(next)?.forEach(fn => fn(next, prev, data));
    return true;
  }

  on(state, fn) {
    if (!this.#listeners.has(state)) this.#listeners.set(state, []);
    this.#listeners.get(state).push(fn);
  }
}

/* ══════════════════════════════════════════════════════════════
   CHAT WIDGET COMPONENT
══════════════════════════════════════════════════════════════ */

class BokitoChatWidget extends HTMLElement {
  // Config
  #agentSlug;
  #apiUrl;
  #agentConfig = null;
  #sessionToken = null;
  #identityToken = null;
  #identityType = 'anonymous';
  #conversationId = null;

  // Core
  #sm = new StateMachine();
  #api;
  #realtime = null;
  #pageCtx;
  #root;

  // UI refs
  #launcher;
  #window;
  #homeView;
  #chatView;
  #loginRequiredView;
  #messageList;
  #thinkingEl;
  #textarea;
  #sendBtn;
  #suggChips;
  #badge;
  #headerName;
  #headerStatus;
  #toolboxWrap;
  #toolboxToggle;
  #toolboxMenu;
  #toolboxPills;
  #historyBtn;
  #chatActionsWrap;
  #chatActionsBtn;
  #chatActionsMenu;
  #settingsBtn;
  #nonBlockingSend = true;
  #sendQueue = [];
  #activeSend = null;
  #isResponding = false;
  #bundleIdleMs = 900;
  #processingTimeoutMs = 30000;
  #processingWatchdogTimer = null;
  #lastProcessingActivityAt = 0;
  #typingIdleMs = 700;
  #typingDebounceTimer = null;
  #isUserTyping = false;
  #timestampClusterWindowMs = 300000;
  #staleSuppressGraceMs = 500;
  #bundleTimer = null;
  #pendingBundleTextParts = [];
  #turnCounter = 0;
  #activeTurnId = 0;
  #suppressedAiQuota = 0;
  #lastAbortAt = 0;
  #backBtn;
  #settingsView;

  // User preferences (persisted)
  #soundEffectsEnabled = true;
  #soundNotificationsEnabled = true;

  // Tool steps (post-hoc)
  #toolSteps = [];
  #thinkingSteps;

  // Unread count for badge
  #unreadTotal = 0;
  #sounds = {};
  #windowCloseTimer = null;

  // Voice recording
  #recordActionsWrap = null;
  #recordStartBtn = null;
  #recordCancelBtn = null;
  #recordConfirmBtn = null;
  #mediaRecorder = null;
  #recordChunks = [];
  #speechRecognition = null;
  #recordedTranscript = '';
  #recordStream = null;
  #recordMimeType = 'audio/webm';

  connectedCallback() {
    this.#agentSlug    = this.dataset.agentSlug || '';
    this.#apiUrl       = this.dataset.apiUrl || '';
    this.#identityToken = this.dataset.identityToken || null;
    this.#nonBlockingSend = this.dataset.nonBlockingSend !== 'false';
    this.#processingTimeoutMs = Number(this.dataset.processingTimeoutMs || 30000);
    this.#typingIdleMs = Number(this.dataset.typingIdleMs || 700);
    this.#bundleIdleMs = Number(this.dataset.bundleIdleMs || 900);
    this.#timestampClusterWindowMs = Number(this.dataset.timestampClusterWindowMs || 300000);
    this.#staleSuppressGraceMs = Number(this.dataset.staleSuppressGraceMs || 500);

    this.#root = this.attachShadow({ mode: 'closed' });
    this.#render();
    this.#injectStyles();
    this.#bindEvents();
    this.#setupStateMachine();
    this.#pageCtx = new PageContextManager(this.#api);
    this.#initSounds();
    this.#loadUserPreferences();
  }

  /* ── Public API ──────────────────────────────────────────── */

  /** Set or update the identity token (e.g. after host app login). */
  setIdentityToken(token) {
    this.#identityToken = token;
  }

  /**
   * Elevate the current session's identity after the user logs in on the host app.
   * Calls POST /session/identify and updates the widget's identity state.
   * If no session exists yet, starts one with the token.
   */
  async identify(identityToken) {
    this.#identityToken = identityToken;

    if (this.#sessionToken) {
      try {
        const result = await this.#api.post('session/identify', {
          identity_token: identityToken,
        });
        if (result) {
          this.#identityType = result.identity_type;
          if (result.customer_id) {
            localStorage.setItem('bokito_customer_id', result.customer_id);
          }
          // If we were waiting for login, now proceed to home
          if (this.#sm.state === 'login_required') {
            this.#sm.transition('home');
          }
        }
      } catch (e) {
        console.warn('[Bokito] Identity elevation failed:', e.message);
        }
      } else {
      // No session yet — start one with the identity token
      await this.#initSession();
      if (this.#sessionToken && this.#sm.state === 'login_required') {
        this.#sm.transition('home');
      }
    }
  }

  /* ── Style injection ─────────────────────────────────────── */
  async #injectStyles() {
    // Ensure [hidden] always means display:none even when flex CSS rules exist
    const base = document.createElement('style');
    base.textContent = '[hidden]{display:none!important;}';
    this.#root.prepend(base);

    const fontsLink = document.createElement('link');
    fontsLink.rel = 'stylesheet';
    fontsLink.href = `${this.#apiUrl.replace(/\/$/, '')}/api/livechat/style/fonts`;
    this.#root.prepend(fontsLink);

    const link = document.createElement('link');
    link.rel   = 'stylesheet';
    link.href  = `${this.#apiUrl.replace(/\/$/, '')}/api/livechat/style/main`;
    this.#root.prepend(link);
  }

  /* ── DOM render ──────────────────────────────────────────── */
  #render() {
    this.#root.innerHTML = `
      <!-- Launcher Button -->
      <button class="bk-launcher" aria-label="Open chat">
        <svg class="bk-launcher-icon bk-launcher-icon--chat bk-launcher-icon--monkey" viewBox="0 0 282 315" fill="none" xmlns="http://www.w3.org/2000/svg">
          <style>
            .bk-lid-shape{fill:currentColor;transform-box:fill-box;opacity:0;}
            .bk-lid-top{transform-origin:center bottom;animation:bkLidTop 6s cubic-bezier(.4,0,.2,1) infinite;}
            .bk-lid-bottom{transform-origin:center top;animation:bkLidBottom 6s cubic-bezier(.4,0,.2,1) infinite;}
            @keyframes bkLidTop{0%,84%,100%{transform:scaleY(0);opacity:0;}88%,90%{transform:scaleY(1);opacity:1;}92.5%{transform:scaleY(0);opacity:0;}}
            @keyframes bkLidBottom{0%,84%,100%{transform:scaleY(0);opacity:0;}88%,90%{transform:scaleY(1);opacity:1;}92.5%{transform:scaleY(0);opacity:0;}}
          </style>
          <path d="M43.5252 0.0213853C73.3115 -0.902241 110.654 29.3997 138.222 41.4931C143.984 39.1758 150.023 35.8228 155.45 32.7626C181.266 18.2025 208.798 -4.0985 240.389 1.61709C252.486 3.80581 262.643 10.1682 269.593 20.3329C281.961 38.6186 282.968 63.3034 279.173 84.3466C276.583 98.7179 271.435 111.57 262.942 123.355C259.212 128.533 255.951 133.182 251.115 137.476C246.262 141.784 241.164 145.199 235.84 148.844C237.781 151.129 239.985 154.578 241.596 157.083C254.294 176.813 258.096 199.018 257.988 222.156C257.976 224.807 258.096 235.062 257.561 237.373C256.639 241.326 255.903 242.425 252.897 245.195C249.657 245.475 243.706 244.953 240.44 244.642C233.163 243.909 225.902 243.023 218.662 241.988C205.32 240.136 191.696 237.717 178.427 236.096C166.861 234.652 155.217 233.92 143.562 233.906C131.54 234.022 119.527 234.615 107.552 235.68C100.906 236.216 93.9374 236.659 87.3709 237.654C75.9069 239.385 64.4133 241.919 52.9734 243.67C46.4888 244.663 34.1022 246.995 28.031 245.336C26.0795 242.762 24.2014 238.281 23.3963 235.184C16.4674 208.528 32.0578 172.287 44.991 149.671C39.6632 145.556 32.4664 140.217 27.7517 135.476C16.8417 124.282 9.28713 109.644 4.52908 95.0165C-6.70284 60.4858 2.65324 21.7729 35.991 3.68057C38.2157 2.47332 41.1049 0.77117 43.5252 0.0213853ZM177.968 156.567C177.082 148.239 169.618 142.199 161.285 143.068C152.928 143.94 146.864 151.429 147.754 159.783C148.643 168.138 156.148 174.184 164.502 173.276C172.831 172.371 178.855 164.897 177.968 156.567ZM126.04 156.912C125.386 148.543 118.089 142.275 109.715 142.891C101.286 143.51 94.9667 150.863 95.6248 159.288C96.2831 167.713 103.667 173.996 112.09 173.3C120.458 172.607 126.694 165.283 126.04 156.912ZM44.6697 59.0185C45.2153 65.0651 46.2353 71.6884 47.2625 77.6649C50.1375 94.3935 56.0036 120.971 78.3572 118.339C85.3893 117.53 92.0272 114.538 98.1385 111.093C99.228 110.474 101.474 109.193 102.361 108.448C109.097 100.987 110.732 102.04 112.39 91.87C103.35 73.9643 62.8843 62.1549 44.6697 59.0185ZM230.252 58.3925C219.095 61.8604 205.672 66.4321 195.232 71.3954C183.968 76.7501 170.397 85.2039 160.002 92.4696L176.879 107.796C178.07 108.898 180.95 111.673 182.251 112.448C187.982 115.78 194.946 117.621 201.563 117.435C210.508 117.184 218.563 112.773 224.519 106.25C234.911 94.8679 240.042 76.3093 236.515 61.2226C234.243 59.407 233.357 58.3349 230.252 58.3925Z" fill="currentColor"/>
          <path d="M136.736 249.955C143.174 249.621 152.727 250.012 159.2 250.404C189.687 252.258 220.912 257.862 250.915 263.725C228.469 284.985 209.571 299.814 179.038 307.983C172.815 309.649 166.367 311.505 160.001 312.682C155.528 313.509 150.721 313.937 146.185 314.348C136.215 315.176 126.185 314.948 116.264 313.667C89.3871 310.054 66.8875 298.182 47.4273 279.483C42.7066 274.948 36.8081 268.801 32.8633 263.638C54.8854 257.934 76.6567 254.359 99.3291 252.458C111.874 251.406 124.136 250.193 136.736 249.955Z" fill="currentColor"/>
          <g class="bk-eye-l bk-eye-lids" transform="rotate(-22 86 95)">
            <rect class="bk-lid-shape bk-lid-top" x="46" y="45" width="80" height="50" rx="25"/>
            <rect class="bk-lid-shape bk-lid-bottom" x="46" y="95" width="80" height="50" rx="25"/>
          </g>
          <g class="bk-eye-r bk-eye-lids" transform="rotate(22 196 95)">
            <rect class="bk-lid-shape bk-lid-top" x="156" y="45" width="80" height="50" rx="25"/>
            <rect class="bk-lid-shape bk-lid-bottom" x="156" y="95" width="80" height="50" rx="25"/>
          </g>
        </svg>
        <svg class="bk-launcher-icon bk-launcher-icon--close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
        <span class="bk-badge" hidden></span>
      </button>

      <!-- Chat Window -->
      <div class="bk-window" hidden>
        <!-- Header -->
        <div class="bk-header">
          <div class="bk-header-avatar">
            <svg class="bk-avatar-logo" viewBox="0 0 282 315" fill="none" xmlns="http://www.w3.org/2000/svg">
              <style>
                .bk-lid-shape{fill:currentColor;transform-box:fill-box;opacity:0;}
                .bk-lid-top{transform-origin:center bottom;animation:bkLidTop 6s cubic-bezier(.4,0,.2,1) infinite;}
                .bk-lid-bottom{transform-origin:center top;animation:bkLidBottom 6s cubic-bezier(.4,0,.2,1) infinite;}
                @keyframes bkLidTop{0%,84%,100%{transform:scaleY(0);opacity:0;}88%,90%{transform:scaleY(1);opacity:1;}92.5%{transform:scaleY(0);opacity:0;}}
                @keyframes bkLidBottom{0%,84%,100%{transform:scaleY(0);opacity:0;}88%,90%{transform:scaleY(1);opacity:1;}92.5%{transform:scaleY(0);opacity:0;}}
              </style>
              <path d="M43.5252 0.0213853C73.3115 -0.902241 110.654 29.3997 138.222 41.4931C143.984 39.1758 150.023 35.8228 155.45 32.7626C181.266 18.2025 208.798 -4.0985 240.389 1.61709C252.486 3.80581 262.643 10.1682 269.593 20.3329C281.961 38.6186 282.968 63.3034 279.173 84.3466C276.583 98.7179 271.435 111.57 262.942 123.355C259.212 128.533 255.951 133.182 251.115 137.476C246.262 141.784 241.164 145.199 235.84 148.844C237.781 151.129 239.985 154.578 241.596 157.083C254.294 176.813 258.096 199.018 257.988 222.156C257.976 224.807 258.096 235.062 257.561 237.373C256.639 241.326 255.903 242.425 252.897 245.195C249.657 245.475 243.706 244.953 240.44 244.642C233.163 243.909 225.902 243.023 218.662 241.988C205.32 240.136 191.696 237.717 178.427 236.096C166.861 234.652 155.217 233.92 143.562 233.906C131.54 234.022 119.527 234.615 107.552 235.68C100.906 236.216 93.9374 236.659 87.3709 237.654C75.9069 239.385 64.4133 241.919 52.9734 243.67C46.4888 244.663 34.1022 246.995 28.031 245.336C26.0795 242.762 24.2014 238.281 23.3963 235.184C16.4674 208.528 32.0578 172.287 44.991 149.671C39.6632 145.556 32.4664 140.217 27.7517 135.476C16.8417 124.282 9.28713 109.644 4.52908 95.0165C-6.70284 60.4858 2.65324 21.7729 35.991 3.68057C38.2157 2.47332 41.1049 0.77117 43.5252 0.0213853ZM177.968 156.567C177.082 148.239 169.618 142.199 161.285 143.068C152.928 143.94 146.864 151.429 147.754 159.783C148.643 168.138 156.148 174.184 164.502 173.276C172.831 172.371 178.855 164.897 177.968 156.567ZM126.04 156.912C125.386 148.543 118.089 142.275 109.715 142.891C101.286 143.51 94.9667 150.863 95.6248 159.288C96.2831 167.713 103.667 173.996 112.09 173.3C120.458 172.607 126.694 165.283 126.04 156.912ZM44.6697 59.0185C45.2153 65.0651 46.2353 71.6884 47.2625 77.6649C50.1375 94.3935 56.0036 120.971 78.3572 118.339C85.3893 117.53 92.0272 114.538 98.1385 111.093C99.228 110.474 101.474 109.193 102.361 108.448C109.097 100.987 110.732 102.04 112.39 91.87C103.35 73.9643 62.8843 62.1549 44.6697 59.0185ZM230.252 58.3925C219.095 61.8604 205.672 66.4321 195.232 71.3954C183.968 76.7501 170.397 85.2039 160.002 92.4696L176.879 107.796C178.07 108.898 180.95 111.673 182.251 112.448C187.982 115.78 194.946 117.621 201.563 117.435C210.508 117.184 218.563 112.773 224.519 106.25C234.911 94.8679 240.042 76.3093 236.515 61.2226C234.243 59.407 233.357 58.3349 230.252 58.3925Z" fill="currentColor"/>
              <path d="M136.736 249.955C143.174 249.621 152.727 250.012 159.2 250.404C189.687 252.258 220.912 257.862 250.915 263.725C228.469 284.985 209.571 299.814 179.038 307.983C172.815 309.649 166.367 311.505 160.001 312.682C155.528 313.509 150.721 313.937 146.185 314.348C136.215 315.176 126.185 314.948 116.264 313.667C89.3871 310.054 66.8875 298.182 47.4273 279.483C42.7066 274.948 36.8081 268.801 32.8633 263.638C54.8854 257.934 76.6567 254.359 99.3291 252.458C111.874 251.406 124.136 250.193 136.736 249.955Z" fill="currentColor"/>
              <g class="bk-eye-l bk-eye-lids" transform="rotate(-22 86 95)">
                <rect class="bk-lid-shape bk-lid-top" x="46" y="45" width="80" height="50" rx="25"/>
                <rect class="bk-lid-shape bk-lid-bottom" x="46" y="95" width="80" height="50" rx="25"/>
              </g>
              <g class="bk-eye-r bk-eye-lids" transform="rotate(22 196 95)">
                <rect class="bk-lid-shape bk-lid-top" x="156" y="45" width="80" height="50" rx="25"/>
                <rect class="bk-lid-shape bk-lid-bottom" x="156" y="95" width="80" height="50" rx="25"/>
              </g>
            </svg>
          </div>
          <div class="bk-header-info">
            <div class="bk-header-name">Bokito AI</div>
            <div class="bk-header-status">Online</div>
          </div>
          <div class="bk-header-actions">
            <button class="bk-icon-btn bk-btn-history" title="Gesprekken" aria-label="Gesprekken" hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M3 12h12M3 18h9"/></svg>
            </button>
            <div class="bk-chat-actions">
              <button class="bk-icon-btn bk-btn-more" title="Chat acties" aria-label="Chat acties" aria-expanded="false">
                <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>
              </button>
              <div class="bk-chat-actions-menu" hidden>
                <button class="bk-chat-actions-item" type="button" data-action="stop">Stop generatie</button>
                <button class="bk-chat-actions-item" type="button" data-action="archive">Archiveren</button>
                <button class="bk-chat-actions-item" type="button" data-action="delete">Verwijderen</button>
                <button class="bk-chat-actions-item" type="button" data-action="export">Exporteren</button>
              </div>
            </div>
            <button class="bk-icon-btn bk-btn-back" title="Terug" aria-label="Terug" hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            </button>
            <button class="bk-icon-btn bk-btn-settings" title="Instellingen" aria-label="Instellingen" hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-.4-1 1.7 1.7 0 0 0-1-.6 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1-.4H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1-.4 1.7 1.7 0 0 0 .6-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6c.38 0 .74-.14 1-.4.26-.26.4-.62.4-1V3a2 2 0 1 1 4 0v.1c0 .38.14.74.4 1 .26.26.62.4 1 .4.7 0 1.37-.28 1.87-.78l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c0 .38.14.74.4 1 .26.26.62.4 1 .4h.1a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1 .4c-.26.26-.4.62-.4 1z"/></svg>
            </button>
            <button class="bk-icon-btn bk-btn-close" title="Sluiten" aria-label="Sluiten">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>

        <!-- Login Required View -->
        <div class="bk-login-required" hidden>
          <div class="bk-login-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          </div>
          <div class="bk-login-title">Inloggen vereist</div>
          <div class="bk-login-sub">Log in om met de assistent te praten</div>
        </div>

        <!-- Home Screen -->
        <div class="bk-home" hidden>
          <div class="bk-home-hero">
            <div class="bk-home-hero-title">Hallo!</div>
            <div class="bk-home-hero-sub">Hoe kunnen we je helpen?</div>
          </div>
          <button class="bk-home-new-btn">
            <div class="bk-home-new-btn-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            </div>
            <span>Nieuw gesprek starten</span>
          </button>
          <div class="bk-home-tools" hidden>
            <button class="bk-toolbox-toggle" type="button" aria-expanded="false">
              <span>Toolbox</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <div class="bk-toolbox-menu" hidden>
              <div class="bk-toolbox-pills"></div>
            </div>
          </div>
          <div class="bk-home-section">
            <div class="bk-home-section-title">Eerdere gesprekken</div>
            <div class="bk-conv-list"></div>
          </div>
        </div>

        <!-- Chat View -->
        <div class="bk-chat-view" hidden>
          <!-- Agent banner (shown during agent_mode) -->
          <div class="bk-agent-banner" hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            <span>Je wordt geholpen door een medewerker</span>
          </div>
          <!-- Messages -->
          <div class="bk-messages"></div>
          <!-- Thinking Panel (post-hoc) -->
          <div class="bk-thinking" hidden>
            <div class="bk-thinking-dots">
              <div class="bk-thinking-dot"></div>
              <div class="bk-thinking-dot"></div>
              <div class="bk-thinking-dot"></div>
              <span class="bk-thinking-label">Bezig...</span>
            </div>
            <div class="bk-thinking-steps"></div>
          </div>
          <!-- Suggestions -->
          <div class="bk-suggestions"></div>
          <!-- Input Bar -->
          <div class="bk-inputbar">
            <div class="bk-inputbar-inner">
              <textarea class="bk-textarea" placeholder="Stel een vraag..." rows="1" maxlength="4000"></textarea>
              <div class="bk-record-actions" hidden>
                <button type="button" class="bk-record-btn bk-record-cancel" aria-label="Opname annuleren">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
                <button type="button" class="bk-record-btn bk-record-confirm bk-record-confirm--recording" aria-label="Opname versturen">
                  <svg class="bk-record-wave" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <rect class="bk-wave-bar" x="1" y="16" width="3" height="8" rx="1.5"/>
                    <rect class="bk-wave-bar" x="6" y="8" width="3" height="16" rx="1.5"/>
                    <rect class="bk-wave-bar" x="11" y="4" width="3" height="20" rx="1.5"/>
                    <rect class="bk-wave-bar" x="16" y="12" width="3" height="12" rx="1.5"/>
                    <rect class="bk-wave-bar" x="21" y="18" width="3" height="6" rx="1.5"/>
                  </svg>
                </button>
              </div>
              <button type="button" class="bk-record-btn bk-record-start" aria-label="Spraak opnemen">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
              </button>
              <button class="bk-send-btn" disabled aria-label="Verstuur">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              </button>
            </div>
          </div>
        </div>

        <!-- Settings View -->
        <div class="bk-settings" hidden>
          <div class="bk-settings-inner">
            <h2 class="bk-settings-title">Instellingen</h2>
            <section class="bk-settings-section">
              <h3 class="bk-settings-section-title">Weergave</h3>
              <div class="bk-settings-option">
                <span class="bk-settings-label">Thema</span>
                <div class="bk-settings-options-row" role="radiogroup" aria-label="Thema">
                  <label class="bk-settings-radio"><input type="radio" name="bk-theme" value="light"> Licht</label>
                  <label class="bk-settings-radio"><input type="radio" name="bk-theme" value="dark"> Donker</label>
                  <label class="bk-settings-radio"><input type="radio" name="bk-theme" value="system"> Systeem</label>
                </div>
              </div>
            </section>
            <section class="bk-settings-section">
              <h3 class="bk-settings-section-title">Geluid</h3>
              <div class="bk-settings-option bk-settings-toggle-wrap">
                <span class="bk-settings-label">Geluidseffecten</span>
                <label class="bk-settings-toggle">
                  <input type="checkbox" id="bk-sound-effects-pref" checked>
                  <span class="bk-settings-toggle-slider"></span>
                </label>
              </div>
              <div class="bk-settings-option bk-settings-toggle-wrap">
                <span class="bk-settings-label">Notificatiegeluiden</span>
                <label class="bk-settings-toggle">
                  <input type="checkbox" id="bk-sound-notifications-pref" checked>
                  <span class="bk-settings-toggle-slider"></span>
                </label>
              </div>
            </section>
          </div>
        </div>
      </div>
    `;

    // Cache refs
    this.#launcher          = this.#root.querySelector('.bk-launcher');
    this.#badge             = this.#root.querySelector('.bk-badge');
    this.#window            = this.#root.querySelector('.bk-window');
    this.#homeView          = this.#root.querySelector('.bk-home');
    this.#loginRequiredView = this.#root.querySelector('.bk-login-required');
    this.#chatView          = this.#root.querySelector('.bk-chat-view');
    this.#messageList       = this.#root.querySelector('.bk-messages');
    this.#thinkingEl        = this.#root.querySelector('.bk-thinking');
    this.#thinkingSteps     = this.#root.querySelector('.bk-thinking-steps');
    this.#textarea          = this.#root.querySelector('.bk-textarea');
    this.#sendBtn           = this.#root.querySelector('.bk-send-btn');
    this.#recordActionsWrap = this.#root.querySelector('.bk-record-actions');
    this.#recordStartBtn    = this.#root.querySelector('.bk-record-start');
    this.#recordCancelBtn   = this.#root.querySelector('.bk-record-cancel');
    this.#recordConfirmBtn  = this.#root.querySelector('.bk-record-confirm');
    this.#suggChips         = this.#root.querySelector('.bk-suggestions');
    this.#headerName        = this.#root.querySelector('.bk-header-name');
    this.#headerStatus      = this.#root.querySelector('.bk-header-status');
    this.#toolboxWrap       = this.#root.querySelector('.bk-home-tools');
    this.#toolboxToggle     = this.#root.querySelector('.bk-toolbox-toggle');
    this.#toolboxMenu       = this.#root.querySelector('.bk-toolbox-menu');
    this.#toolboxPills      = this.#root.querySelector('.bk-toolbox-pills');
    this.#historyBtn        = this.#root.querySelector('.bk-btn-history');
    this.#chatActionsWrap   = this.#root.querySelector('.bk-chat-actions');
    this.#chatActionsBtn    = this.#root.querySelector('.bk-btn-more');
    this.#chatActionsMenu   = this.#root.querySelector('.bk-chat-actions-menu');
    this.#settingsBtn       = this.#root.querySelector('.bk-btn-settings');
    this.#backBtn           = this.#root.querySelector('.bk-btn-back');
    this.#settingsView      = this.#root.querySelector('.bk-settings');

    // Init API client
    this.#api = new ApiClient({
      baseUrl: this.#apiUrl,
      agentSlug: this.#agentSlug,
      stateMachine: this.#sm,
      identityTokenGetter: () => this.#identityToken,
      onSessionExpired: (data) => {
        this.#sessionToken  = data.session_token;
        this.#identityType  = data.identity_type || 'anonymous';
        if (this.#api) this.#api.setToken(data.session_token);
      },
    });
  }

  /* ── Event bindings ──────────────────────────────────────── */
  #bindEvents() {
    this.#window.addEventListener('animationend', (e) => {
      if (e.animationName === 'bk-window-in') this.#window.classList.remove('is-opening');
      if (e.animationName === 'bk-window-out') {
        this.#window.classList.remove('is-closing');
        this.#window.hidden = true;
      }
    });

    this.#launcher.addEventListener('click', () => {
      if (this.#sm.state === 'idle') { this.#playSound('open'); this.#sm.transition('home'); }
      else if (this.#sm.state === 'home') { this.#playSound('close'); this.#sm.transition('idle'); }
      else if (this.#sm.state === 'login_required') { this.#playSound('close'); this.#sm.transition('idle'); }
      else this.#closeWindow();
    });

    this.#root.querySelector('.bk-btn-close').addEventListener('click', () => {
      if (this.#conversationId) {
        this.#api.patch(`conversation/${this.#conversationId}/close`, {});
      }
      this.#closeWindow();
    });

    this.#historyBtn?.addEventListener('click', () => {
      this.#closeChatActionsMenu();
      this.#showHome();
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
    this.#settingsBtn?.addEventListener('click', () => this.#showSettings());
    this.#backBtn?.addEventListener('click', () => this.#hideSettings());

    this.#settingsView?.querySelectorAll('input[name="bk-theme"]').forEach((radio) => {
      radio.addEventListener('change', (e) => this.#setUserTheme(e.target.value));
    });
    this.#root.querySelector('#bk-sound-effects-pref')?.addEventListener('change', (e) => {
      this.#setUserSoundEffects(e.target.checked);
    });
    this.#root.querySelector('#bk-sound-notifications-pref')?.addEventListener('change', (e) => {
      this.#setUserSoundNotifications(e.target.checked);
    });

    this.#root.querySelector('.bk-home-new-btn').addEventListener('click', () => {
      this.#startNewConversation();
    });
    this.#toolboxToggle?.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = this.#toolboxMenu.hidden;
      this.#toolboxMenu.hidden = !open;
      this.#toolboxToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    this.#toolboxMenu?.addEventListener('click', (e) => e.stopPropagation());
    this.#root.addEventListener('click', () => {
      if (this.#toolboxMenu && !this.#toolboxMenu.hidden) {
        this.#toolboxMenu.hidden = true;
        this.#toolboxToggle?.setAttribute('aria-expanded', 'false');
      }
      this.#closeChatActionsMenu();
    });

    this.#textarea.addEventListener('input', () => {
      this.#markUserTyping();
      this.#textarea.style.height = 'auto';
      this.#textarea.style.height = Math.min(this.#textarea.scrollHeight, 120) + 'px';
      this.#updateSendBtnState();
    });

    this.#textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.#sendMessage();
      }
    });

    this.#sendBtn.addEventListener('click', () => this.#sendMessage());
    this.#recordStartBtn?.addEventListener('click', () => this.#startRecording());
    this.#recordCancelBtn?.addEventListener('click', () => this.#cancelRecording());
    this.#recordConfirmBtn?.addEventListener('click', () => this.#confirmRecording());
  }

  /* ── State machine setup ─────────────────────────────────── */
  #setupStateMachine() {
    this.#sm.on('*', (state) => this.#onStateChange(state));
  }

  #onStateChange(state) {
    this.#closeChatActionsMenu();
    this.#updateHeaderActionButtons(state);
    switch (state) {
      case 'idle':
        this.#clearProcessingWatchdog();
        clearTimeout(this.#typingDebounceTimer);
        this.#typingDebounceTimer = null;
        this.#isUserTyping = false;
        this.#hideWindowAnimated();
        this.#launcher.classList.remove('is-open');
        clearTimeout(this.#bundleTimer);
        this.#bundleTimer = null;
        this.#pendingBundleTextParts = [];
        this.#activeSend = null;
        this.#isResponding = false;
        this.#sendQueue = [];
        this.#updateQueueTelemetry();
        break;

      case 'login_required':
        this.#clearProcessingWatchdog();
        this.#showWindowAnimated();
        this.#launcher.classList.add('is-open');
        this.#loginRequiredView.hidden = false;
        this.#homeView.hidden = true;
        this.#chatView.hidden = true;
        break;

      case 'home':
        this.#clearProcessingWatchdog();
        clearTimeout(this.#typingDebounceTimer);
        this.#typingDebounceTimer = null;
        this.#isUserTyping = false;
        this.#showWindowAnimated();
        this.#launcher.classList.add('is-open');
        this.#loginRequiredView.hidden = true;
        this.#homeView.hidden = false;
        this.#chatView.hidden = true;
        // Always ensure a session exists before loading history
        if (!this.#sessionToken) {
          this.#initSession().then(() => {
            // Only load history if init didn't redirect to login_required
            if (this.#sm.state === 'home') this.#loadConversationHistory();
          });
        } else {
          this.#loadConversationHistory();
        }
        break;

      case 'connecting':
        this.#loginRequiredView.hidden = true;
        this.#homeView.hidden = true;
        this.#chatView.hidden = false;
        this.#messageList.innerHTML = '';
        break;

      case 'active':
        this.#clearProcessingWatchdog();
        this.#thinkingEl.hidden = true;
        this.#textarea.disabled = false;
        this.#updateSendBtnState();
        this.#textarea.focus();
        break;

      case 'processing':
        this.#markProcessingActivity();
        this.#armProcessingWatchdog();
        this.#textarea.disabled = false;
        this.#updateSendBtnState();
        this.#showThinking();
        break;

      case 'agent_mode':
        this.#clearProcessingWatchdog();
        this.#root.querySelector('.bk-agent-banner').hidden = false;
        this.#thinkingEl.hidden = true;
        this.#textarea.disabled = false;
        this.#updateSendBtnState();
        break;

      case 'error':
        this.#clearProcessingWatchdog();
        this.#showError('Er is iets misgegaan. Probeer het opnieuw.');
        setTimeout(() => this.#sm.transition('home'), 3000);
        break;
    }
  }

  /* ── Session init ────────────────────────────────────────── */
  async #initSession() {
    try {
      const customerId = localStorage.getItem('bokito_customer_id');
      const tenantSubdomain = resolveTenantSubdomainFromHost();
      const body       = { agent_slug: this.#agentSlug, customer_id: customerId || undefined };
      if (this.#identityToken) body.identity_token = this.#identityToken;
      if (tenantSubdomain) body.tenant_subdomain = tenantSubdomain;

      const data = await this.#api.post('session/start', body);

      this.#sessionToken = data.session_token;
      this.#identityType = data.identity_type || 'anonymous';
      this.#agentConfig  = data.agent_config;
      this.#api.setToken(data.session_token);
      this.#applyAgentConfig(data.agent_config);

      // Visibility gate: if agent requires login and we're anonymous, show login prompt
      const config           = data.agent_config || {};
      const isInternal       = config.visibility === 'internal';
      const requiresIdentity = config.min_identity_to_start && config.min_identity_to_start !== 'anonymous';
      const isAnonymous      = this.#identityType === 'anonymous';

      if ((isInternal || requiresIdentity) && isAnonymous && !this.#identityToken) {
        this.#sm.transition('login_required');
        return;
      }
    } catch (e) {
      // AccessDeniedError — agent requires identity the user doesn't have
      if (e.message?.includes('AccessDenied') || e.message?.includes('Insufficient')) {
        this.#sm.transition('login_required');
        return;
      }
      this.#showError('Verbinden mislukt. Controleer je verbinding.');
    }
  }

  #applyAgentConfig(config) {
    if (!config) return;
    const name = config.theme?.chatbot_name || 'Bokito AI';
    this.#headerName.textContent = name;
    this.#root.querySelector('.bk-home-hero-title').textContent = `Hallo!`;
    this.#root.querySelector('.bk-home-hero-sub').textContent  = `Stel je vraag aan ${name}`;

    this.#applyTheme(config.theme);
    this.#applyUserThemeOverride();

    if (config.tool_display_names) {
      this._toolDisplayNames = config.tool_display_names;
    }
    this.#renderToolbox();
  }

  #isValidCssColor(value) {
    return typeof value === 'string' && value.trim() !== '' && CSS.supports('color', value.trim());
  }

  #applyTheme(theme) {
    const host = this;
    if (!theme || typeof theme !== 'object') {
      host.removeAttribute('data-theme');
      return;
    }

    const mainColor = theme.main_color || theme.primary_color;
    if (this.#isValidCssColor(mainColor)) {
      host.style.setProperty('--bk-primary', mainColor.trim());
      host.style.setProperty('--bk-primary-dark', mainColor.trim());
      host.style.setProperty('--bk-primary-light', 'rgba(0,255,153,.14)');
    }

    if (this.#isValidCssColor(theme.text_color)) {
      host.style.setProperty('--bk-text-inverse', theme.text_color.trim());
    }

    if (theme.dark_light_mode === 'dark' || theme.dark_light_mode === 'light') {
      host.setAttribute('data-theme', theme.dark_light_mode);
    } else {
      host.removeAttribute('data-theme');
    }
  }

  /* ── Start new conversation ──────────────────────────────── */
  async #startNewConversation() {
    if (!this.#sessionToken) await this.#initSession();
    if (this.#sm.state === 'login_required') return;
    this.#sm.transition('connecting');
    clearTimeout(this.#bundleTimer);
    this.#bundleTimer = null;
    this.#pendingBundleTextParts = [];
    this.#activeSend = null;
    this.#isResponding = false;
    this.#sendQueue = [];
    this.#updateQueueTelemetry();

    try {
      const data = await this.#api.post('conversation', {});
      this.#conversationId = data.conversation.id;

      if (data.customer_id) {
        localStorage.setItem('bokito_customer_id', data.customer_id);
      }

      this.#pageCtx?.setConversationId(this.#conversationId);
      this.#connectRealtime();

      if (data.greeting_message) {
        this.#appendMessage(data.greeting_message);
      }

      this.#sm.transition('active');
      this.#loadSuggestions();
    } catch {
      this.#sm.transition('error');
    }
  }

  /* ── Load existing conversation ──────────────────────────── */
  async #openConversation(conversationId) {
    this.#conversationId = conversationId;
    clearTimeout(this.#bundleTimer);
    this.#bundleTimer = null;
    this.#pendingBundleTextParts = [];
    this.#activeSend = null;
    this.#isResponding = false;
    this.#sendQueue = [];
    this.#updateQueueTelemetry();
    this.#homeView.hidden = true;
    this.#chatView.hidden = false;
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
    } catch {
      this.#sm.transition('error');
    }
  }

  /* ── Load conversation history ───────────────────────────── */
  async #loadConversationHistory() {
    // Guard: never load history if we're not in home state or have no token
    if (!this.#sessionToken || this.#sm.state === 'login_required') return;

    const list = this.#root.querySelector('.bk-conv-list');
    list.innerHTML = '<div style="padding:12px 16px;font-size:13px;color:var(--bk-text-muted)">Laden...</div>';

    try {
      const data  = await this.#api.get('customer/conversations?per_page=10');
      const hiddenIds = this.#getHiddenConversationIds();
      const items = (data?.items || []).filter((item) => !hiddenIds.includes(item.id));

      if (!items.length) {
        list.innerHTML = '<div style="padding:12px 16px;font-size:13px;color:var(--bk-text-muted)">Nog geen gesprekken</div>';
        this.#updateUnreadBadge(0);
        return;
      }

      const unreadTotal = items.reduce((sum, c) => sum + (c.unread_count || 0), 0);
      this.#updateUnreadBadge(unreadTotal);

      list.innerHTML = '';
      items.forEach(conv => {
        const el = document.createElement('button');
        el.className = 'bk-conv-item';
        el.innerHTML = `
          <div class="bk-conv-item-avatar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>
          <div class="bk-conv-item-body">
            <div class="bk-conv-item-row">
              <span class="bk-conv-item-title">${conv.title || 'Gesprek'}</span>
              <span class="bk-conv-item-time">${formatTime(conv.last_message_at)}</span>
            </div>
          </div>
          ${conv.unread_count > 0 ? `<div class="bk-conv-unread">${conv.unread_count}</div>` : ''}
        `;
        el.addEventListener('click', () => this.#openConversation(conv.id));
        list.appendChild(el);
      });
    } catch {
      list.innerHTML = '<div style="padding:12px 16px;font-size:13px;color:var(--bk-text-muted)">Kan gesprekken niet laden</div>';
    }
  }

  /* ── Send message ────────────────────────────────────────── */
  async #sendMessage() {
    const text = this.#textarea.value.trim();
    if (!text) return;
    this.#sendMessageWithText(text);
    this.#textarea.value = '';
    this.#textarea.style.height = 'auto';
    this.#updateSendBtnState();
    this.#suggChips.innerHTML = '';
  }

  async #sendMessageWithText(text) {
    if (!text || !text.trim()) return;
    const trimmed = text.trim();

    const fakeMsg = { id: Date.now(), sender_type: 'customer', message_content: trimmed, created_at: new Date().toISOString() };
    this.#appendMessage(fakeMsg);

    if (!this.#conversationId) return;
    if (!this.#nonBlockingSend) {
      this.#sm.transition('processing');
      try {
        const pageSnapshot = this.#pageCtx?.getMessageSnapshot();
        await this.#api.post('message', {
          conversation_id: this.#conversationId,
          message_content: trimmed,
          page_context: pageSnapshot,
        });
      } catch {
        this.#sm.transition('active');
        this.#showError('Bericht versturen mislukt.');
      }
      return;
    }

    this.#queueBundledSend(trimmed);
  }

  #transcribePath() {
    return livechatPathSegment(this.#agentConfig?.transcribe_path, 'transcribe');
  }

  /* ── Voice recording ─────────────────────────────────────── */
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
        this.#speechRecognition.lang = 'nl-NL';
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
      console.warn('[Bokito] Microfoon niet beschikbaar:', err);
      this.#showError('Microfoon niet beschikbaar. Controleer de toestemming.');
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
    const base = this.#apiUrl.replace(/\/$/, '');
    const path = this.#transcribePath();
    const url = `${base}/api/livechat/${path}`;
    const buildFd = () => {
      const fd = new FormData();
      if (this.#sessionToken) fd.append('session_token', this.#sessionToken);
      fd.append('audio', blob, 'recording.webm');
      fd.append('language', 'nl');
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
    if (this.#textarea) this.#textarea.placeholder = 'Transcriberen…';
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
    if (text) this.#sendMessageWithText(text);
    else this.#showError('Geen spraak herkend. Probeer opnieuw.');
  }

  /* ── Realtime ────────────────────────────────────────────── */
  #connectRealtime() {
    if (!this.#sessionToken || !this.#conversationId) return;
    const wsUrl = this.#apiUrl.replace(/^http/, 'ws') + '/realtime';

    this.#realtime = new RealtimeClient({
      url: wsUrl,
      channelName: `conversations/${this.#conversationId}`,
      token: this.#sessionToken,
      onEvent: (data) => this.#handleRealtimeEvent(data),
      onReconnect: () => this.#onRealtimeReconnect(),
    });
    this.#realtime.connect();
  }

  async #onRealtimeReconnect() {
    try {
      const msgs    = await this.#api.get(`conversation/${this.#conversationId}/messages?per_page=50`);
      const pending = msgs?.items?.find(m => m.sender_type === 'ai' && (m.status === 'processing' || m.status === 'queued'));
      if (pending && this.#sm.state === 'active' && this.#activeSend) {
        this.#sm.transition('processing');
      }
    } catch {}
  }

  #handleRealtimeEvent(data) {
    const type = data.event_type;
    const obj  = data.object || {};

    switch (type) {
      case 'message':
        if (obj.sender_type === 'ai' && obj.status === 'sent') {
          this.#markProcessingActivity();
          if (this.#shouldSuppressAiResponse(obj)) break;
          this.#thinkingEl.hidden = true;
          this.#toolSteps         = [];
          this.#thinkingSteps.innerHTML = '';
          this.#appendMessage(obj);
          if (this.#nonBlockingSend && this.#activeSend) this.#finishAssistantTurn('realtime');
          else if (this.#sm.state === 'processing') this.#sm.transition('active');
          this.#loadSuggestions();
        }
        break;

      case 'agent_thinking':
        break;

      case 'tool_started':
        this.#markProcessingActivity();
        if (this.#agentConfig?.show_tool_steps !== false) {
          const displayName = this._toolDisplayNames?.[obj.tool_name] || obj.tool_name;
          this.#addToolStep(obj.tool_name, displayName, 'running');
        }
        break;

      case 'tool_completed':
        this.#markProcessingActivity();
        if (this.#agentConfig?.show_tool_steps !== false) {
          this.#updateToolStep(obj.tool_name, 'done', obj.duration_ms);
        }
        break;

      case 'tool_error':
        this.#updateToolStep(obj.tool_name, 'error');
        break;

      case 'agent_done':
        break;

      case 'agent_error':
        this.#thinkingEl.hidden = true;
        if (this.#nonBlockingSend && this.#activeSend) this.#handleSendError('De AI kon geen antwoord genereren. Probeer opnieuw.');
        else {
          this.#showError('De AI kon geen antwoord genereren. Probeer opnieuw.');
          if (this.#sm.state === 'processing') this.#sm.transition('active');
        }
        break;

      case 'transfer_to_agent':
        if (this.#sm.state === 'processing') this.#sm.transition('agent_mode');
        break;
    }
  }

  /* ── ThinkingPanel ───────────────────────────────────────── */
  #showThinking() {
    this.#toolSteps = [];
    this.#thinkingSteps.innerHTML = '';
    this.#thinkingEl.hidden = false;
    this.#markProcessingActivity();
    this.#updateThinkingLabel();
    this.#scrollToBottom();
  }

  #addToolStep(toolName, displayName, state) {
    this.#thinkingEl.hidden = false;
    const el = document.createElement('div');
    el.className = 'bk-thinking-step';
    el.dataset.tool = toolName;
    el.innerHTML = `
      <div class="bk-step-icon"><div class="bk-step-spinner"></div></div>
      <span class="bk-step-name">${displayName}</span>
      <span class="bk-step-time"></span>
    `;
    this.#thinkingSteps.appendChild(el);
    this.#scrollToBottom();
  }

  #updateToolStep(toolName, state, durationMs) {
    const el = this.#thinkingSteps.querySelector(`[data-tool="${toolName}"]`);
    if (!el) return;
    const icon = el.querySelector('.bk-step-icon');
    if (state === 'done') {
      icon.innerHTML = `<div class="bk-step-check"><svg viewBox="0 0 12 10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="1 5 4 8 11 1"/></svg></div>`;
      if (durationMs) el.querySelector('.bk-step-time').textContent = `${durationMs}ms`;
    } else if (state === 'error') {
      icon.innerHTML = `<span style="color:#EF4444">✗</span>`;
    }
  }

  /* ── Message rendering ───────────────────────────────────── */
  #appendMessage(msg, opts = {}) {
    const isAI = msg.sender_type === 'ai' || msg.sender_type === 'agent';
    const rawText = (msg.message_content || '').trim();
    if (isAI && !rawText) return;
    if (!opts.silent) this.#playSound(isAI ? 'incoming' : 'outgoing');
    const el   = document.createElement('div');
    el.className = `bk-msg bk-msg--${isAI ? 'ai' : 'user'}`;

    const html = MarkdownRenderer.render(rawText);
    el.innerHTML = `
      <div class="bk-msg-bubble">${html}</div>
      <div class="bk-msg-time">${formatTime(msg.created_at)}</div>
    `;
    const createdAtValue = msg.created_at || new Date().toISOString();
    const createdAtMs = this.#toEpochMs(createdAtValue) ?? Date.now();
    el.dataset.createdAt = String(createdAtValue);
    el.dataset.createdAtMs = String(createdAtMs);
    el.dataset.senderGroup = this.#normalizeSenderType(msg.sender_type);
    this.#messageList.appendChild(el);
    this.#recomputeDaySeparators();
    this.#recomputeMessageTimestampVisibility();
    this.#scrollToBottom();
  }

  #scrollToBottom() {
    requestAnimationFrame(() => {
      this.#messageList.scrollTop = this.#messageList.scrollHeight;
    });
  }

  /* ── Suggestions ─────────────────────────────────────────── */
  async #loadSuggestions() {
    if (!this.#conversationId) return;
    this.#suggChips.innerHTML = '';

    try {
      const snapshot = this.#pageCtx?.getMessageSnapshot();
      const data = await this.#api.get(
        `conversation/${this.#conversationId}/suggestions?page_url=${encodeURIComponent(snapshot?.url || '')}&page_title=${encodeURIComponent(snapshot?.title || '')}`
      );
      const suggestions = data?.suggestions || [];
      suggestions.forEach(s => {
        const btn = document.createElement('button');
        btn.className   = 'bk-chip';
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

  /* ── Utilities ───────────────────────────────────────────── */
  #closeChatActionsMenu() {
    if (!this.#chatActionsMenu || this.#chatActionsMenu.hidden) return;
    this.#chatActionsMenu.hidden = true;
    this.#chatActionsBtn?.setAttribute('aria-expanded', 'false');
  }

  #updateHeaderActionButtons(state) {
    const isHome = state === 'home';
    const isChat = state === 'connecting' || state === 'active' || state === 'processing' || state === 'agent_mode';
    const isSettingsOpen = this.#settingsView && !this.#settingsView.hidden;
    if (this.#historyBtn) this.#historyBtn.hidden = !isChat;
    if (this.#chatActionsWrap) this.#chatActionsWrap.hidden = !isChat;
    if (this.#settingsBtn) this.#settingsBtn.hidden = !isHome || isSettingsOpen;
    if (this.#backBtn) this.#backBtn.hidden = !isSettingsOpen;
    if (!isChat) this.#closeChatActionsMenu();
  }

  #getHiddenConversationIds() {
    try {
      const parsed = JSON.parse(localStorage.getItem('bokito_hidden_conversations') || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  #hideConversationFromHistory(conversationId) {
    if (!conversationId) return;
    const hidden = new Set(this.#getHiddenConversationIds());
    hidden.add(conversationId);
    localStorage.setItem('bokito_hidden_conversations', JSON.stringify([...hidden]));
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
    const confirmed = window.confirm('Weet je zeker dat je dit gesprek wilt verwijderen uit je overzicht?');
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
      this.#showError('Geen berichten om te exporteren.');
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
      const trimmed = value.trim();
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
    if (diffDays === 0) return 'vandaag';
    if (diffDays === 1) return 'gisteren';
    if (diffDays === 2) return 'eergisteren';
    const parts = new Intl.DateTimeFormat('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' }).formatToParts(d);
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

  #queueBundledSend(text = '') {
    const trimmed = (text || '').trim();
    if (this.#activeSend?.text) this.#pendingBundleTextParts.push(this.#activeSend.text);
    if (this.#sendQueue.length) {
      this.#sendQueue.forEach((item) => { if (item?.text) this.#pendingBundleTextParts.push(item.text); });
      this.#sendQueue = [];
    }
    if (trimmed) this.#pendingBundleTextParts.push(trimmed);
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
      if (this.#pendingBundleTextParts.length && !this.#bundleTimer) {
        this.#bundleTimer = setTimeout(() => this.#flushBundledSend(), this.#typingIdleMs);
      }
    }, this.#typingIdleMs);
    if (this.#nonBlockingSend && this.#activeSend) this.#cancelActiveResponse('typing');
    if (this.#pendingBundleTextParts.length) {
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
      return;
    }
    const text = this.#pendingBundleTextParts.join('\n');
    this.#pendingBundleTextParts = [];
    if (!text) return;
    const turnId = ++this.#turnCounter;
    this.#sendQueue.push({
      turnId,
      text,
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
      if (this.#activeSend) this.#cancelActiveResponse('watchdog_timeout');
      else {
        this.#thinkingEl.hidden = true;
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
    const label = this.#root.querySelector('.bk-thinking-label');
    if (!label) return;
    if (!this.#isResponding) {
      label.textContent = 'Bezig...';
      return;
    }
    label.textContent = this.#sendQueue.length > 0
      ? `Bezig... (+${this.#sendQueue.length} in wachtrij)`
      : 'Bezig...';
  }

  #updateSendBtnState() {
    const hasText = !!this.#textarea?.value.trim();
    this.#sendBtn.disabled = !hasText;
  }

  async #drainSendQueue() {
    if (!this.#nonBlockingSend) return;
    if (this.#isUserTyping) return;
    if (this.#activeSend || !this.#sendQueue.length || !this.#conversationId) return;
    const next = this.#sendQueue.shift();
    this.#activeSend = { ...next, startedAt: performance.now() };
    this.#activeTurnId = next.turnId || this.#activeTurnId;
    this.#isResponding = true;
    if (this.#sm.state !== 'processing') this.#sm.transition('processing');
    this.#markProcessingActivity();
    this.#updateThinkingLabel();
    this.#updateQueueTelemetry();
    try {
      const pageSnapshot = this.#pageCtx?.getMessageSnapshot();
      const result = await this.#api.post('message', {
        conversation_id: this.#conversationId,
        message_content: next.text,
        page_context: pageSnapshot,
        client_message_id: next.clientMessageId,
        idempotency_key: next.idempotencyKey,
        turn_id: next.turnId,
      });
      this.#emitTelemetry('message_dispatched', {
        conversation_id: this.#conversationId,
        idempotency_key: next.idempotencyKey,
      });
      if (result?.idempotency_replayed === true) {
        this.#emitTelemetry('idempotency_replay', {
          conversation_id: this.#conversationId,
          idempotency_key: next.idempotencyKey,
        });
      }
    } catch {
      this.#handleSendError('Bericht versturen mislukt.');
    }
  }

  #finishAssistantTurn(reason = 'done') {
    this.#clearProcessingWatchdog();
    const finished = this.#activeSend;
    const duration = finished?.startedAt ? Math.round(performance.now() - finished.startedAt) : undefined;
    this.#activeSend = null;
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

  #handleSendError(message) {
    this.#clearProcessingWatchdog();
    this.#activeSend = null;
    this.#isResponding = false;
    this.#showError(message);
    this.#emitTelemetry('send_failed', {
      conversation_id: this.#conversationId,
      queue_length: this.#sendQueue.length,
    });
    if (this.#sendQueue.length > 0) {
      this.#isResponding = true;
      this.#drainSendQueue();
      return;
    }
    if (this.#sm.state === 'processing') this.#sm.transition('active');
    this.#updateThinkingLabel();
    this.#updateQueueTelemetry();
  }

  #cancelActiveResponse(reason = 'manual') {
    if (!this.#activeSend) return;
    this.#suppressedAiQuota += 1;
    this.#lastAbortAt = Date.now();
    this.#emitTelemetry('send_aborted', {
      conversation_id: this.#conversationId,
      queue_length: this.#sendQueue.length,
      reason,
    });
    this.#finishAssistantTurn('aborted');
  }

  #showHome() {
    this.#chatView.hidden = true;
    this.#homeView.hidden = false;
    this.#sm.transition('home');
  }

  #closeWindow() {
    if (this.#settingsView && !this.#settingsView.hidden) this.#hideSettings();
    this.#playSound('close');
    this.#sm.transition('idle');
  }

  #showWindowAnimated() {
    clearTimeout(this.#windowCloseTimer);
    this.#window.hidden = false;
    this.#window.classList.remove('is-closing');
    void this.#window.offsetWidth;
    this.#window.classList.add('is-opening');
  }

  #hideWindowAnimated() {
    clearTimeout(this.#windowCloseTimer);
    if (this.#window.hidden) return;
    this.#window.classList.remove('is-opening');
    this.#window.classList.add('is-closing');
    this.#windowCloseTimer = setTimeout(() => {
      this.#window.classList.remove('is-closing');
      this.#window.hidden = true;
    }, 220);
  }

  #initSounds() {
    const base = (this.dataset.soundBaseUrl || this.#apiUrl || '').replace(/\/$/, '');
    const soundMap = {
      open: this.dataset.soundOpen || (base ? `${base}/sounds/open.mp3` : ''),
      close: this.dataset.soundClose || (base ? `${base}/sounds/close.mp3` : ''),
      incoming: this.dataset.soundIncoming || (base ? `${base}/sounds/bot-message.mp3` : ''),
      outgoing: this.dataset.soundOutgoing || (base ? `${base}/sounds/user-message.mp3` : ''),
    };

    Object.entries(soundMap).forEach(([key, src]) => {
      if (!src) return;
      const audio = new Audio(src);
      audio.preload = 'auto';
      audio.volume = 0.6;
      this.#sounds[key] = audio;
    });
  }

  #playSound(key) {
    const isEffect = key === 'open' || key === 'close';
    if (isEffect && !this.#soundEffectsEnabled) return;
    if (!isEffect && !this.#soundNotificationsEnabled) return;
    const audio = this.#sounds[key];
    if (!audio) return;
    try {
      audio.currentTime = 0;
      audio.play().catch(() => {});
    } catch {}
  }

  #showSettings() {
    this.#homeView.hidden = true;
    this.#settingsView.hidden = false;
    if (this.#settingsBtn) this.#settingsBtn.hidden = true;
    if (this.#backBtn) this.#backBtn.hidden = false;
    this.#syncSettingsForm();
  }

  #hideSettings() {
    this.#settingsView.hidden = true;
    this.#homeView.hidden = false;
    if (this.#backBtn) this.#backBtn.hidden = true;
    if (this.#settingsBtn) this.#settingsBtn.hidden = false;
  }

  #syncSettingsForm() {
    const theme = localStorage.getItem('bokito_theme') || 'system';
    this.#settingsView?.querySelectorAll('input[name="bk-theme"]').forEach((radio) => {
      radio.checked = radio.value === theme;
    });
    const effectsEl = this.#root.querySelector('#bk-sound-effects-pref');
    const notifEl = this.#root.querySelector('#bk-sound-notifications-pref');
    if (effectsEl) effectsEl.checked = this.#soundEffectsEnabled;
    if (notifEl) notifEl.checked = this.#soundNotificationsEnabled;
  }

  #loadUserPreferences() {
    const theme = localStorage.getItem('bokito_theme') || 'system';
    this.#soundEffectsEnabled = localStorage.getItem('bokito_sound_effects') !== 'off';
    this.#soundNotificationsEnabled = localStorage.getItem('bokito_sound_notifications') !== 'off';
    this.#applyUserThemeOverride();
    this.#syncSettingsForm();
  }

  #applyUserThemeOverride() {
    const theme = localStorage.getItem('bokito_theme') || 'system';
    if (theme === 'light' || theme === 'dark') {
      this.setAttribute('data-theme', theme);
    } else {
      this.removeAttribute('data-theme');
    }
  }

  #setUserTheme(value) {
    localStorage.setItem('bokito_theme', value);
    this.#applyUserThemeOverride();
  }

  #setUserSoundEffects(checked) {
    this.#soundEffectsEnabled = checked;
    localStorage.setItem('bokito_sound_effects', checked ? 'on' : 'off');
  }

  #setUserSoundNotifications(checked) {
    this.#soundNotificationsEnabled = checked;
    localStorage.setItem('bokito_sound_notifications', checked ? 'on' : 'off');
  }

  #updateUnreadBadge(total) {
    this.#unreadTotal = total;
    if (!this.#badge) return;
    if (total > 0) {
      this.#badge.textContent = total > 99 ? '99+' : String(total);
      this.#badge.hidden = false;
    } else {
      this.#badge.hidden = true;
    }
  }

  #renderToolbox() {
    if (!this.#toolboxWrap || !this.#toolboxPills || !this.#toolboxMenu) return;
    const labels = Object.values(this._toolDisplayNames || {}).filter(Boolean);
    if (!labels.length) {
      this.#toolboxWrap.hidden = true;
      this.#toolboxMenu.hidden = true;
      this.#toolboxToggle?.setAttribute('aria-expanded', 'false');
      return;
    }

    this.#toolboxWrap.hidden = false;
    this.#toolboxPills.innerHTML = '';
    labels.sort((a, b) => String(a).localeCompare(String(b), 'nl', { sensitivity: 'base' }));
    labels.forEach((label) => {
      const el = document.createElement('span');
      el.className = 'bk-tool-pill';
      el.textContent = String(label);
      this.#toolboxPills.appendChild(el);
    });

    this.#toolboxMenu.hidden = true;
    this.#toolboxToggle?.setAttribute('aria-expanded', 'false');
  }

  #showError(msg) {
    const el = document.createElement('div');
    el.className = 'bk-error-msg';
    el.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <span>${msg}</span>
    `;
    this.#messageList.appendChild(el);
    this.#scrollToBottom();
    setTimeout(() => el.remove(), 5000);
  }
}

// Register the custom element
if (!customElements.get('bokito-chat')) {
  customElements.define('bokito-chat', BokitoChatWidget);
}

/* ── Auto-init from script tag ───────────────────────────────── */
(function autoInit() {
  const script = document.currentScript
    || document.querySelector('script[data-agent-slug]');
  if (!script) return;

  const slug          = script.getAttribute('data-agent-slug');
  const apiUrl        = script.getAttribute('data-api-url') || script.src.split('/api/livechat')[0];
  const identityToken = script.getAttribute('data-identity-token') || null;
  if (!slug) return;

  const widget = document.createElement('bokito-chat');
  widget.dataset.agentSlug = slug;
  widget.dataset.apiUrl    = apiUrl;
  if (identityToken) widget.dataset.identityToken = identityToken;
  document.body.appendChild(widget);

  // Expose widget instance globally for host app integration
  window.bokitoChat = widget;
})();
