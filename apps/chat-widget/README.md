# Bokito chat embed widget

## Deploy artifact (source of truth)

- **Production script:** [`bokito-chat.js`](./bokito-chat.js) — full-featured embed (stream-chat SSE, attachments, voice, settings, Happy Bokito launcher, etc.). This is what Xano static hosting and `api:livechat/script/main` should serve.
- **Legacy / alternate:** [`js/chat-module.js`](./js/chat-module.js) — smaller, older build. Do **not** use for new integrations unless you explicitly maintain that path. Prefer `bokito-chat.js` for parity with the mobile app and current backend.

## Shared branding

Launcher and header avatar art (with blink animation) are kept in sync with [`../shared_components/Happy bokito.svg`](../shared_components/Happy%20bokito.svg). After editing that file, copy the SVG fragment into the `#render()` template in `bokito-chat.js` (launcher + `.bk-avatar-logo`).

## Local preview (widget files local, chat API on Xano)

Recommended:

```bash
cd apps/chat-widget
npm install
npm run dev
```

This runs **Vite** on `http://127.0.0.1:8787` and opens your **system default browser**. Edit `bokito-chat.js` or HTML here; save and refresh. The widget still talks to your **Xano** instance (`api_url` / `data-api-url`), so you need network access to Xano, not an offline mock. If the port is busy (for example an old `serve` on 8787), stop that process or change `server.port` in [`vite.config.mjs`](./vite.config.mjs).

**Cursor / VS Code Simple Browser:** opening `http://localhost:8787` in the built-in Simple Browser tab often shows a **blank white page** even when the server is fine (webview / localhost quirks). Use the browser window that `npm run dev` opens, or open the same URL manually in Chrome or Edge.

**Alternative:** any static server works (for example `npx serve -l 8787`), then open the root URL in an external browser.

- [`index.html`](./index.html) — hub with links to all local demos.
- [`chat-standalone.html`](./chat-standalone.html) loads `./bokito-chat.js` like a real embed.

## Livechat stream endpoints (optional)

If Xano `session/start` returns `agent_config.stream_chat_path` / `stream_chat_continue_path` (each must match `[a-zA-Z0-9_-]{1,64}`), the widget POSTs to those paths under `/api:livechat/` instead of `stream-chat` / `stream-chat-continue`. Defaults apply when omitted. See `BOKITO_KNOWLEDGE.md` (livechat dual pipeline).

Optional `agent_config.transcribe_path` overrides the default `POST /api:livechat/transcribe` used after voice recording (server-side faster-whisper proxy; see `BOKITO_KNOWLEDGE.md` and `apps/asr-service/`).

## Multi-tenant auth flow

`bokito-chat.js` now supports tenant/user-aware auth bootstrapping:

- **Host auth cookie:** set `data-auth-cookie-name="host_auth_cookie"` and the widget reads `document.cookie` to forward `host_auth_token` in `POST /api:livechat/session/start`.
- **Direct token handoff:** set `data-auth-token` or `window.BokitoConfig.authToken`.
- **Dynamic token handoff:** set `window.BokitoConfig.getAuthToken = async () => token`.
- **Auth mode override:** set `data-auth-mode="anonymous|optional|required"` (fallback to backend `agent_config.auth_mode`).

### Login fallback

When auth is required and no valid token is available, the widget shows an in-widget login form and calls:

- `POST /api:livechat/auth/login` with `{ email, password, agent_slug, session_token? }`
- `POST /api:livechat/auth/logout` to invalidate the current session

The widget emits:

- `bokito:login-required` when host-side auth is needed
- `bokito:authenticated` after a successful login/token handoff

### Preferences sync

If available, preferences are synced via:

- `GET /api:livechat/user/preferences`
- `PATCH /api:livechat/user/preferences` with `{ preferences: { ...partial } }`

Local storage remains as offline/cache fallback.

### Conversation ownership

For authenticated users the widget first requests:

- `GET /api:livechat/user/conversations?per_page=10`

If unavailable, it falls back to:

- `GET /api:livechat/customer/conversations?per_page=10`

### Tenant MCP context

If session payload includes tenant MCP servers (`mcp_servers`, `agent_config.mcp_servers`, or `agent_config.tenant_mcp_servers`), the widget includes `mcp_server_ids` and `tenant_context` in stream payloads. Server-side routing remains authoritative.

## Client-side stream smoothing (when the API does not send `evt.t`)

If the backend only returns SSE `done` with full `content` (common with buffered responses), the widget **replays** the text in short segments so the bubble still appears to stream. Opt out: `data-client-simulate-stream="false"` on `<bokito-chat>`, or URL query `bk_sse_smooth=0` when using auto-mount (`chat-standalone.html`). Tunables: `data-client-simulate-min-chars` (default 20), `data-client-simulate-chunk`, `data-client-simulate-ms`, or `window.BokitoConfig` keys `clientSimulateStream`, `clientSimulateMinChars`, etc.
