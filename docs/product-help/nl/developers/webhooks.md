---
title: Webhooks
intro: Ontvang een HTTP POST wanneer signals of beslissingen in de workspace wijzigen.
description: Abonneer je op Bokito-webhookevents, verifieer de X-Bokito-Signature-HMAC-header en ga goed om met retries.
keywords: webhooks, events, hmac, signature, callbacks
sort: 40
related: api-overview,api-signals,authentication
---

# Webhooks

Webhooks duwen events naar jouw endpoint op het moment dat ze gebeuren, zodat je de REST-API niet hoeft te pollen.

## Abonneren

Maak een webhookendpoint aan onder **Instellingen, dan Developers**: jouw HTTPS-URL plus de events die je wilt. Elk endpoint krijgt een signing-secret - bewaar het als een wachtwoord; je hebt het nodig om leveringen te verifieren.

## Events

| Event | Vuurt wanneer |
| --- | --- |
| `signal.created` | Een nieuw gesprek in de inbox landt (elk kanaal, ook de REST-API) |
| `signal.closed` | Een gesprek wordt gesloten door een persoon, agent of automatisering |
| `decision.created` | Een agent een beslisverzoek indient dat menselijke goedkeuring vraagt |

De payload bevat de eventnaam en de data van het onderwerp (signal- of beslissingsvelden).

## Leveringsformaat

Elke levering is een JSON-POST met deze headers:

```
Content-Type: application/json
User-Agent: Bokito-Webhooks/1.0
X-Bokito-Event: signal.created
X-Bokito-Delivery: <uniek leverings-id>
X-Bokito-Timestamp: <unix-timestamp>
X-Bokito-Signature: v1=<hex hmac>
```

## Signature verifieren

Verifieer altijd voordat je een payload vertrouwt. De signature is HMAC-SHA256 over `"{timestamp}.{raw_body}"` met jouw endpointsecret:

```python
import hashlib, hmac

def verify(secret: str, timestamp: str, raw_body: bytes, header: str) -> bool:
    signed = f"{timestamp}.".encode() + raw_body
    expected = "v1=" + hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header)
```

Wijs leveringen af met een foute signature of een timestamp ouder dan een paar minuten (replaybescherming). Bereken de HMAC over de rauwe requestbody, voor JSON-parsing.

## Snel antwoorden, retry-veilig

Geef binnen enkele seconden een `2xx`-status terug; doe zwaar werk asynchroon na de bevestiging. Non-2xx-antwoorden en timeouts worden opnieuw geprobeerd met korte backoff, dus maak je handler idempotent - gebruik `X-Bokito-Delivery` om te dedupliceren.
