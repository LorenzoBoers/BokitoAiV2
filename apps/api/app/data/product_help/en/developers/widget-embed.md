---
title: Widget embed
intro: The technical contract of the embeddable chat widget script.
description: Embed the Bokito chat widget with one script tag. Reference for the data attributes, anonymous and authenticated modes, and how widget traffic reaches your inbox.
keywords: widget, embed, script, livechat, chat widget
sort: 60
related: widget,api-overview,channels
---

# Widget embed

The chat widget is a single script tag. It renders a launcher on your site, and every visitor conversation lands as a thread in Communication. This page is the technical contract; the operator-facing setup lives in [Install the website widget](/docs/inbox/widget).

## The snippet

Copy the exact snippet from **Settings, then AI Assistant, then Installation** - it is pre-filled for your workspace. The shape:

```html
<script
  src="https://your-bokito-host/chat-widget/bokito-chat.js"
  data-bokito-chat-widget
  data-agent-slug="your-agent"
  data-api-url="https://your-bokito-host"
  data-auth-mode="anonymous"
  defer
></script>
```

## Attributes

- `data-bokito-chat-widget` - marks the tag; the script only boots when present.
- `data-agent-slug` - which configured assistant answers this widget.
- `data-api-url` - the Bokito API origin the widget talks to.
- `data-auth-mode` - `anonymous` for public website visitors, `required` for logged-in users of your own product.
- `defer` - load without blocking your page.

## Authenticated mode

With `data-auth-mode="required"` the widget identifies the visitor through a token your page supplies:

```html
<script>
  window.BokitoConfig = { getAuthToken: () => yourAccessToken }
</script>
```

Use this when embedding the assistant inside your own product, so conversations attach to the right user.

## How it connects

The widget API is open cross-origin by design (your customers' domains are arbitrary) and authenticates with short-lived session tokens - never cookies, never `bok_` API tokens. Nothing about your workspace is exposed beyond what the assistant is configured to say.

## Checklist before production

1. Install on a staging page and send a test message.
2. Confirm the thread appears in Communication on the chat channel.
3. Check branding and welcome text under widget settings.
4. Then add the snippet to your production template.
