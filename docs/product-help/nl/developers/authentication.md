---
title: Authenticatie
intro: API-tokens, scopes en hoe je inloggegevens meestuurt.
description: Hoe je Bokito-API-tokens (bok_-prefix) aanmaakt en gebruikt, wat scopes doen op de REST-API en het MCP-endpoint, en hoe intrekken werkt.
keywords: authenticatie, api-token, bearer, scopes, beveiliging
sort: 20
related: api-overview,api-signals,mcp-endpoint
---

# Authenticatie

Elk developer-oppervlak authenticeert met workspace-API-tokens. Tokens worden aangemaakt en ingetrokken door owners en admins.

## Token aanmaken

Ga naar **Instellingen, dan Developers** en maak een token aan. De platte waarde - hij begint met `bok_` - zie je een keer bij aanmaak. Bewaar hem in een secretmanager; Bokito bewaart alleen een hash.

## Meesturen

Alle API's nemen het token als bearer-credential:

```
Authorization: Bearer bok_jouw_token_hier
```

Verzoeken zonder geldig token krijgen `401 Unauthorized`.

## Scopes

Scopes beperken wat een token mag:

- **REST-API:** `signals:read` staat lezen van signals en berichten toe, `signals:write` staat aanmaken van signals toe.
- **MCP-endpoint:** scopes benoemen toolcategorieen; het token kan alleen tools in die categorieen zien en aanroepen.

Een token met lege scopelijst heeft volledige toegang. Kies liever scoped tokens: een token per integratie, met alleen de scopes die het nodig heeft. Een verzoek buiten de scopes van het token krijgt `403 Forbidden`.

## Intrekken en roteren

Trek een token in onder **Instellingen, dan Developers**; het stopt direct met werken. Roteren doe je door eerst het nieuwe token aan te maken, je integratie om te zetten, en dan het oude in te trekken. Elk token toont wanneer het voor het laatst is gebruikt, wat verouderde tokens zichtbaar maakt.

## Vuistregels

- Zet nooit een `bok_`-token in frontendcode of een publieke repository. De [chatwidget](/docs/developers/widget-embed) is het enige dat in een browser hoort te draaien, en die gebruikt geen API-tokens.
- Gebruik aparte tokens per omgeving (staging, productie) zodat een lek een kleine straal heeft.
