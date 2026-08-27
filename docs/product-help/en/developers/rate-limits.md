---
title: Rate limits
intro: The request budgets on public endpoints and how to handle 429 responses.
description: Bokito API rate limits per endpoint group, the 429 response format with Retry-After, and patterns for staying under the limits.
keywords: rate limits, 429, retry-after, throttling, quotas
sort: 70
related: api-overview,api-signals,webhooks
---

# Rate limits

Public endpoints are rate limited per client IP over a rolling 60-second window. Limits exist to keep the platform responsive; normal integrations rarely hit them.

## Limits by endpoint group

| Endpoints | Limit |
| --- | --- |
| REST API reads (`GET /api/public/v1/...`) | 120 requests/minute |
| REST API writes (`POST /api/public/v1/signals`) | 30 requests/minute |
| Docs and help content (`/api/docs`, `/api/help`) | 60 requests/minute |
| Agenda incoming triggers (`POST /api/hooks/{id}`) | 60 requests/minute |
| Website widget session start | 30 requests/minute |

## The 429 response

Exceeding a limit returns:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 60

{"detail": "Too many requests. Try again shortly."}
```

Honor `Retry-After`: pause that many seconds before retrying. A retry loop that ignores it just keeps the window full.

## Staying under the limits

- **Prefer webhooks over polling.** A `signal.created` [webhook](/docs/developers/webhooks) replaces a polling loop entirely - this is the single biggest saver.
- **Page with `limit` and `offset`** instead of many small requests; reads return up to 200 items per call.
- **Batch bursts.** If an upstream system emits event spikes, queue and drain at a steady pace rather than forwarding each event instantly.
- **Back off on 429** with the `Retry-After` value plus a little jitter.

Limits are per IP, so traffic from other tenants does not affect your budget.
