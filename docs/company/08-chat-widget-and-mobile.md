# Chat widget and mobile

Last updated: May 2026

Customer-facing chat is delivered via an **embeddable web widget** and a **mobile app**. Both use Xano livechat APIs with tenant-aware session start.

Widget backend contract: [`apps/chat-widget/MULTI_TENANT_BACKEND_CONTRACT.md`](../../apps/chat-widget/MULTI_TENANT_BACKEND_CONTRACT.md).

## Chat widget

### Embed

```html
<script
  src="https://<xano-host>/api:livechat/script/main"
  data-agent-slug="demo"
  data-api-url="https://<xano-host>"
  defer>
</script>
```

Or iframe to `/chat/embed?agent=...`.

Built bundle: `apps/chat-widget/dist/bokito-chat.js` (IIFE). Source: `apps/chat-widget/src/widget-main.ts`.

### Tenant awareness

`POST /api:livechat/session/start` accepts optional `tenant_subdomain`. Backend validates the agent belongs to that tenant subdomain; otherwise returns tenant not found.

### Features

- Floating launcher (draggable, position persisted in `localStorage`)
- Featurebase/Intercom-style window chrome, configurable atmosphere via `agent_config.theme`
- Home screen, conversation list, SSE streaming chat
- Markdown rendering on completion; incremental `t` chunks during stream
- Tool step indicators (`tool_started`, `tool_completed`, `tool_error`) on realtime channel
- Image attachments, agent mode banner for human handoff
- Light/dark theme via CSS variables from agent config

### Dual chat pipeline (Xano)

| Pipeline | Behavior |
|----------|----------|
| `legacy` (default) | Claude/router stack |
| `xano_native` | Built-in Xano AI Agent |

Selected per agent via `chat_pipeline` and optional `xano_agent_id` in `agent_config` from `session/start`. SSE contract must stay compatible: `{ "t": "..." }` chunks, `{ "type": "done", ... }`, optional `page_context_needed`.

Configurable paths: `stream_chat_path`, `stream_chat_continue_path`, `transcribe_path`.

### Local development

```bash
cd apps/chat-widget
npm install && npm run build && npm run dev
```

Dev server: `http://127.0.0.1:8787`. Dashboard dev proxies `/chat-widget/*` from widget `dist/`.

## Mobile app

Tech: React Native, Expo Router, Gesture Handler, Reanimated.

### Home (two-page pager)

**Page 0 – Conversations**

- Search, pull-to-refresh, FAB for new chat
- `LoginRequiredGate` when unauthenticated

**Page 1 – Cloud agents**

- List and schedule tabs
- Draggable agent order, 24h activity sparklines
- Schedule timeline with draggable blocks

### Chat screen (`/chat`)

- SSE streaming via `parseSseStream`
- Thinking indicator with tool steps
- Suggestion chips on new conversation
- Image attachments via `expo-image-picker`

### Agent detail (`/agent`)

- Stats, activity chart, tools list
- Pause/activate, configuration entry

### State and auth

- `ChatContext` – sessions, messages, streaming, agent mode
- `ApiClient` – GET, POST, SSE, multipart upload
- `customer_id` in AsyncStorage; auto-refresh on 401

## Shared streaming behavior

Clients simulate word-by-word display when backend sends only a final `done` payload (optional client-side chunking; disable with `data-client-simulate-stream="false"` on widget).

## Related docs

- [07 – Inbox and communication](07-inbox-and-communication.md)
- [02 – Tenant and hosting](02-tenant-and-hosting.md)
- [01 – Platform overview](01-platform-overview.md)
- [README](README.md)
