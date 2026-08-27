---
title: Signals-API
intro: Lees gesprekken en duw externe events de inbox in via REST.
description: Referentiegids voor de Bokito Signals REST-API: signals oplijsten, een signal met berichten ophalen en inkomende signals aanmaken vanuit externe systemen.
keywords: signals, rest-api, endpoints, curl, inbox-api
sort: 30
related: api-overview,authentication,webhooks
---

# Signals-API

Een signal is een gesprek in de inbox. Met de REST-API kunnen externe systemen ze lezen en nieuwe aanmaken. Basispad: `/api/public/v1`. Alle voorbeelden gaan uit van een token met de juiste scope (zie [Authenticatie](/docs/developers/authentication)).

Het volledige request/response-schema per endpoint staat in de [interactieve API-reference](/docs/api).

## Signals oplijsten

```bash
curl -H "Authorization: Bearer bok_..." \
  "https://jouw-bokito-host/api/public/v1/signals?status=open&limit=50"
```

Vereist `signals:read`. Queryparameters:

- `status` - een van `open`, `pending`, `closed`, `spam`
- `channel` - filter op kanaal (bijvoorbeeld `email`, `chat`, `api`)
- `limit` (1-200, standaard 50) en `offset` voor paginering

Geeft `items` (signal-samenvattingen), `total`, `limit` en `offset` terug. Signals zijn gesorteerd op recentste activiteit.

## Een signal met berichten ophalen

```bash
curl -H "Authorization: Bearer bok_..." \
  "https://jouw-bokito-host/api/public/v1/signals/SIGNAL_ID"
```

Vereist `signals:read`. Geeft de signalvelden plus `messages`: maximaal 200 berichten in chronologische volgorde, elk met `kind`, `direction`, `role`, `from_address`, `subject`, `body_text` en `created_at`.

## Een signal aanmaken

```bash
curl -X POST -H "Authorization: Bearer bok_..." -H "Content-Type: application/json" \
  -d '{
    "subject": "Order 1042 vertraagd",
    "body": "Vervoerder meldt twee dagen vertraging op order 1042.",
    "contact_name": "Magazijnsysteem",
    "contact_email": "ops@example.com",
    "priority": "high",
    "tags": ["logistiek"]
  }' \
  "https://jouw-bokito-host/api/public/v1/signals"
```

Vereist `signals:write`. `subject` (maximaal 200 tekens) en `body` zijn verplicht; `priority` is een van `low`, `normal`, `high`, `urgent` (standaard `normal`); maximaal 10 `tags` (die worden Labels in Communicatie). Optionele `contact_name` en `contact_email` maken of matchen een [contact](/docs/inbox/contacts).

Het signal landt in de inbox op het `api`-kanaal. Je kunt hier geen ander kanaal kiezen. Agents en routeringsregels behandelen het als elk ander inkomend bericht, en er vuurt een `signal.created`-webhook. Dit is de standaardmanier om alerts, formulierinzendingen of events uit andere systemen in dezelfde flow als klantmail te krijgen.

## Fouten

- `400` - validatieprobleem, detail in de body
- `401` - ontbrekend of ongeldig token
- `403` - token mist de vereiste scope
- `404` - signal niet gevonden in deze workspace
- `429` - rate-limited; zie [Rate limits](/docs/developers/rate-limits)
