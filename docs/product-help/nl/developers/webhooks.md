---
title: Webhooks
intro: Ontvang een HTTP POST wanneer signals of beslissingen in de workspace wijzigen.
description: Maak webhookendpoints aan onder Instellingen, Developers, verifieer de HMAC-signature, test deliveries en ga goed om met retries.
keywords: webhooks, events, hmac, signature, developers, callbacks
sort: 40
related: api-overview,api-signals,authentication
---

# Webhooks

Webhooks duwen events naar jouw endpoint op het moment dat ze gebeuren, zodat je de REST-API niet hoeft te pollen. Owners en admins beheren ze op dezelfde pagina als tokens.

## Abonneren onder Developers

1. Open **Instellingen** en daarna **Developers**.
2. Onder **Webhooks** kies je **Endpoint toevoegen**. Vul een HTTPS-URL in (of `http://localhost` voor lokale tests) en optioneel een beschrijving.
3. Kies events, of laat **Alle events** staan. Kies **Webhook toevoegen**.
4. Kopieer het **Ondertekeningsgeheim** één keer en bewaar het als een wachtwoord. Je hebt het nodig om leveringen te verifieren.
5. Gebruik **Testen** voor een proef. Open **Recente deliveries** voor event, status, pogingen en tijd. **Aanzetten** of **Pauzeren** zonder te verwijderen.

## Events

| Event | Vuurt wanneer |
| --- | --- |
| `signal.created` | Een nieuw gesprek in de inbox landt (elk kanaal, ook de REST-API) |
| `signal.closed` | Een gesprek wordt gesloten door een persoon, agent of automatisering |
| `decision.created` | Een agent een beslisverzoek indient dat menselijke goedkeuring vraagt |
| `decision.resolved` | Iemand die beslissing goedkeurt of afwijst |
| `agent.run_failed` | Een geplande of inbound agent-run faalt |
| `platform_change.applied` | Een Govern-wijziging wordt toegepast (Accepteren, of een yolo-apply) |
| `spend.threshold_reached` | Workspace-tokens of uitgaven de 80%- of 100%-cap raken |

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
