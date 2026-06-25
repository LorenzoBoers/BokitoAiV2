# Chat widget and mobile

Last updated: June 2026

Customer-facing chat is delivered via an **embeddable web widget** and a **mobile app**. Both use FastAPI livechat APIs with tenant-aware session start.

Widget backend contract: [`apps/chat-widget/MULTI_TENANT_BACKEND_CONTRACT.md`](../../apps/chat-widget/MULTI_TENANT_BACKEND_CONTRACT.md).

## Chat widget

### Embed

```html
<script
  src="https://<platform-host>/api/livechat/script/main"
  data-agent-slug="demo"
  data-api-url="https://<platform-host>"
  defer>
</script>
```

Or iframe to `/chat/embed?agent=...`.

Built bundle: `apps/chat-widget/dist/bokito-chat.js` (IIFE). Source: `apps/chat-widget/src/widget-main.ts`.

### Tenant awareness

`POST /api/livechat/session/start` accepts optional `tenant_subdomain`. Backend validates the agent belongs to that tenant subdomain; otherwise returns tenant not found.

### Features

- Floating launcher (draggable, position persisted in `localStorage`)
- Featurebase/Intercom-style window chrome, configurable atmosphere via `agent_config.theme`
- Home screen, conversation list, SSE streaming chat
- Markdown rendering on completion; incremental `t` chunks during stream
- Tool step indicators (`tool_started`, `tool_completed`, `tool_error`) on realtime channel
- Image attachments, agent mode banner for human handoff
- Light/dark theme via CSS variables from agent config

### Dual chat pipeline (FastAPI)

| Pipeline | Behavior |
|----------|----------|
| `legacy` (default) | Claude/router stack |
| `bokito_native` | Built-in FastAPI AI Agent |

Selected per agent via `chat_pipeline` and optional `platform_agent_id` in `agent_config` from `session/start`. SSE contract must stay compatible: `{ "t": "..." }` chunks, `{ "type": "done", ... }`, optional `page_context_needed`.

Configurable paths: `stream_chat_path`, `stream_chat_continue_path`, `transcribe_path`.

### Local development

```bash
cd apps/chat-widget
npm install && npm run build && npm run dev
```

Dev server: `http://127.0.0.1:8787`. Dashboard dev proxies `/chat-widget/*` from widget `dist/`.

## Mobile app

Tech: React Native, Expo Router (SDK 55), expo-notifications, expo-secure-store.

Source: [`apps/mobile`](../../apps/mobile). Production API: `https://app.bokito.ai`.

### Screens

| Tab / route | Purpose |
|-------------|---------|
| Assistant | Personal assistant chat via `/api/chat/conversations*` |
| Messages | Unified inbox (`/api/signals`) with Open / Mine / Unassigned / Decisions views |
| Decisions | Pending decisions (`/api/notifications/decisions`) with approve/reject |
| Settings | Account, workspace, API endpoint, sign out |
| `/thread/[id]` | Thread detail: messages, inline decision cards, reply composer |

### Realtime and push

- **Gateway WebSocket** (`/api/ws?device=mobile`): same typed protocol as the dashboard; live refresh on `threads`, `signal:<id>`, `decisions`.
- **Push (standalone APK):** Expo token registered via `POST /api/push/subscribe` (`expo:` endpoint prefix). Backend sends push on inbound thread messages and `awaiting_human` decisions. Tap opens thread or Decisions tab.
- **Firebase:** required for Android FCM on standalone builds — see [`apps/mobile/FIREBASE_SETUP.md`](../../apps/mobile/FIREBASE_SETUP.md).

### Build and install (Android APK)

1. One-time: Expo project + Firebase — see [`apps/mobile/README.md`](../../apps/mobile/README.md).
2. GitHub Actions workflow **Mobile APK** (`workflow_dispatch`) builds via EAS `preview` profile and uploads a downloadable APK artifact.
3. Install on device (unknown sources), log in, allow notifications.

### Auth

- `POST /api/auth/login` → JWT in SecureStore; bootstrap via `GET /api/auth/me`.

## Shared streaming behavior

Clients simulate word-by-word display when backend sends only a final `done` payload (optional client-side chunking; disable with `data-client-simulate-stream="false"` on widget).

## Related docs

- [07 – Inbox and communication](07-inbox-and-communication.md)
- [02 – Tenant and hosting](02-tenant-and-hosting.md)
- [01 – Platform overview](01-platform-overview.md)
- [README](README.md)
