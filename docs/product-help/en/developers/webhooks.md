---
title: Webhooks
intro: Receive an HTTP POST when signals or decisions change in the workspace.
description: Create webhook endpoints in Settings, Developers, verify the HMAC signature, test deliveries and handle retries.
keywords: webhooks, events, hmac, signature, developers, callbacks
sort: 40
related: api-overview,api-signals,authentication
---

# Webhooks

Webhooks push events to your endpoint the moment they happen, so you do not have to poll the REST API. Owners and admins manage them on the same page as tokens.

## Subscribe in Developers

1. Open **Settings**, then **Developers**.
2. Under **Webhooks**, choose **Add endpoint**. Enter an HTTPS URL (or `http://localhost` for local tests) and an optional description.
3. Pick events, or leave **All events**. Choose **Add webhook**.
4. Copy the **Signing secret** once and store it like a password. You need it to verify deliveries.
5. Use **Test** to send a probe. Open **Recent deliveries** to see event, status, attempts and time. **Enable** or **Disable** without deleting.

## Events

| Event | Fires when |
| --- | --- |
| `signal.created` | A new conversation lands in the inbox (any channel, including the REST API) |
| `signal.closed` | A conversation is closed by a person, an agent or an automation |
| `decision.created` | An agent raises a decision request that needs human approval |
| `decision.resolved` | Someone approves or declines that decision |
| `agent.run_failed` | A scheduled or inbound agent run fails |
| `platform_change.applied` | A Govern change is applied (Accept, or a yolo apply) |
| `spend.threshold_reached` | Workspace token or spend use hits the 80% or 100% cap |

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
