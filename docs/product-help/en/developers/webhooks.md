---
title: Webhooks
intro: Receive an HTTP POST when signals or decisions change in the workspace.
description: Subscribe to Bokito webhook events, verify the X-Bokito-Signature HMAC header, and handle retries correctly.
keywords: webhooks, events, hmac, signature, callbacks
sort: 40
related: api-overview,api-signals,authentication
---

# Webhooks

Webhooks push events to your endpoint the moment they happen, so you do not have to poll the REST API.

## Subscribe

Create a webhook endpoint under **Settings, then Developers**: your HTTPS URL plus the events you want. Each endpoint gets a signing secret - store it like a password; you need it to verify deliveries.

## Events

| Event | Fires when |
| --- | --- |
| `signal.created` | A new conversation lands in the inbox (any channel, including the REST API) |
| `signal.closed` | A conversation is closed by a person, an agent or an automation |
| `decision.created` | An agent raises a decision request that needs human approval |

The payload contains the event name and the subject's data (signal or decision fields).

## Delivery format

Each delivery is a JSON POST with these headers:

```
Content-Type: application/json
User-Agent: Bokito-Webhooks/1.0
X-Bokito-Event: signal.created
X-Bokito-Delivery: <unique delivery id>
X-Bokito-Timestamp: <unix timestamp>
X-Bokito-Signature: v1=<hex hmac>
```

## Verify the signature

Always verify before trusting a payload. The signature is HMAC-SHA256 over `"{timestamp}.{raw_body}"` with your endpoint secret:

```python
import hashlib, hmac

def verify(secret: str, timestamp: str, raw_body: bytes, header: str) -> bool:
    signed = f"{timestamp}.".encode() + raw_body
    expected = "v1=" + hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header)
```

Reject deliveries with a bad signature or a timestamp older than a few minutes (replay protection). Compute the HMAC over the raw request body, before any JSON parsing.

## Respond fast, retry-safe

Return a `2xx` status within a few seconds; do heavy work asynchronously after acknowledging. Non-2xx responses and timeouts are retried with short backoff, so make your handler idempotent - use `X-Bokito-Delivery` to deduplicate.
