---
title: Signals API
intro: Read conversations and push external events into the inbox over REST.
description: Reference guide for the Bokito Signals REST API: list signals, fetch a signal with messages, and create inbound signals from external systems.
keywords: signals, rest api, endpoints, curl, inbox api
sort: 30
related: api-overview,authentication,webhooks
---

# Signals API

A signal is a conversation thread in the inbox. The REST API lets external systems read them and create new ones. Base path: `/api/public/v1`. All examples assume a token with the right scope (see [Authentication](/docs/developers/authentication)).

The full request/response schema for each endpoint is in the [interactive API reference](/docs/api).

## List signals

```bash
curl -H "Authorization: Bearer bok_..." \
  "https://your-bokito-host/api/public/v1/signals?status=open&limit=50"
```

Requires `signals:read`. Query parameters:

- `status` - one of `open`, `pending`, `closed`, `spam`
- `channel` - filter by channel (for example `email`, `chat`, `api`)
- `limit` (1-200, default 50) and `offset` for paging

Returns `items` (signal summaries), `total`, `limit` and `offset`. Signals are ordered by most recent activity.

## Get one signal with messages

```bash
curl -H "Authorization: Bearer bok_..." \
  "https://your-bokito-host/api/public/v1/signals/SIGNAL_ID"
```

Requires `signals:read`. Returns the signal fields plus `messages`: up to 200 messages in chronological order, each with `kind`, `direction`, `role`, `from_address`, `subject`, `body_text` and `created_at`.

## Create a signal

```bash
curl -X POST -H "Authorization: Bearer bok_..." -H "Content-Type: application/json" \
  -d '{
    "subject": "Order 1042 delayed",
    "body": "Carrier reports a two-day delay on order 1042.",
    "contact_name": "Warehouse system",
    "contact_email": "ops@example.com",
    "priority": "high",
    "tags": ["logistics"]
  }' \
  "https://your-bokito-host/api/public/v1/signals"
```

Requires `signals:write`. `subject` (max 200 characters) and `body` are required; `priority` is one of `low`, `normal`, `high`, `urgent` (default `normal`); up to 10 `tags` (those become Labels in Communication). Optional `contact_name` and `contact_email` create or match a [contact](/docs/inbox/contacts).

The signal lands in the inbox on the `api` channel. You cannot pick another channel here. Agents and routing rules treat it like any other inbound message, and a `signal.created` webhook fires. This is the standard way to route alerts, form submissions or events from other systems into the same flow as customer mail.

## Errors

- `400` - validation problem, detail in the body
- `401` - missing or invalid token
- `403` - token lacks the required scope
- `404` - signal not found in this workspace
- `429` - rate limited; see [Rate limits](/docs/developers/rate-limits)
