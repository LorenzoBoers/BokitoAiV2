# Inbox and communication

Last updated: May 2026

Bokito combines a **team inbox** for human collaboration with **workforce messaging** for AI agent communication across projects.

## Team inbox

### Routes

| Route | Purpose |
|-------|---------|
| `/support/inbox/:queue` | Queue view (all, mine, unassigned, etc.) |
| `/support/inbox/:queue/t/:threadId` | Thread detail |
| Channel variants | `/support/inbox/ch/:channelId/:queue` |

Legacy `/communication` and `/messages` may redirect or alias to inbox routes.

### Sidebar

`InboxSidebarNav` renders queue links with badge counts from `NavBadgeProvider`:

- Unread threads assigned to me
- Unassigned open threads
- Rail badge on Inbox icon

Footer **Configure** links to assistant and `/settings/inbox`.

### Features

- Thread list with read/unread state
- Assignment to users
- Labels (comma-separated in UI)
- Signature editor for outbound email
- Real-time or polled updates; mark read/unread refreshes badges

## Email integration

Outlook and Gmail connect via OAuth (see [06 – Integrations](06-integrations.md)).

| Table | Purpose |
|-------|---------|
| `email_oauth_connection` | Tokens, mailbox, sync state per account |
| `email_synced_message` | Stored inbox messages from Graph sync |
| `email_outlook_oauth_state` | Short-lived OAuth state + `return_url` |

Settings: `/settings/inbox` and `/settings/communication-email` (legacy paths may redirect).

SMTP/IMAP is concept-only in the UI (no Xano storage in current release).

## Workforce communication

### Hub level

`/projects/communication` – cross-project agent messages awaiting human action.

### Project level

`/project/:id/communication` – project-scoped updates, decisions, resolved items.

Message types include `decision_request`, `status_update`, `task_result`. Status drives worker attention badges on project hub nav.

### Workforce API

`GET /messages` with filters (project, type, status). Workers write via `POST /messages/worker` with optional `message_type`, `channel`, `to_type`, `to_id`.

## Assistant and messenger settings

Routes under `/ai/assistent/:audience/:section`:

| Section | Purpose |
|---------|---------|
| `customization` | Widget theme, content, styling preview |
| `agent` | Agent model, replies, context, handoff (UI state; save not fully wired) |
| `installation` | Embed snippets for team vs public widget |

Default: `/ai/assistent/internal/customization`.

**Preview widget:** `<bokito-chat data-preview-mode="true">` embedded in customization/installation panels. Draft styling via `data-preview-overrides`; separate preview localStorage namespace.

**Audiences:**

- **internal** – logged-in team widget
- **external** – public visitor widget

Scripts served from `/chat-widget/internal/` and `/chat-widget/external/` in dashboard dev (from `apps/chat-widget/dist`).

## Navigation badges

`NavBadgeProvider` polls inbox and workforce endpoints for:

- Inbox unread / unassigned counts
- `agentsAttention` – workforce messages with `awaiting_human` (admins)
- Project hub communication tab badge

Refresh triggered after mark-read/unread in Communication components.

## Related docs

- [06 – Integrations](06-integrations.md)
- [08 – Chat widget and mobile](08-chat-widget-and-mobile.md)
- [04 – Workspace and projects](04-workspace-and-projects.md)
- [README](README.md)
