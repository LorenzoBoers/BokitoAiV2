---
title: API-overzicht
intro: De developer-oppervlakken die Bokito aanbiedt en welk je waarvoor gebruikt.
description: Overzicht van het Bokito-developerplatform: de publieke REST-API, webhooks, het MCP-endpoint en de embedbare chatwidget, met links naar elke gids.
keywords: api, rest, developers, overzicht, integratie
sort: 10
related: authentication,api-signals,webhooks,mcp-endpoint
---

# API-overzicht

Bokito biedt vier developer-oppervlakken. Allemaal vallen ze onder dezelfde tenant-isolatie en hetzelfde tokenmodel.

| Oppervlak | Gebruik het om | Gids |
| --- | --- | --- |
| REST-API v1 | Signals lezen en externe events de inbox in duwen | [Signals-API](/docs/developers/api-signals) |
| Webhooks | Genotificeerd worden wanneer signals of beslissingen wijzigen | [Webhooks](/docs/developers/webhooks) |
| MCP-endpoint | Workspacetools aanroepen vanuit MCP-clients zoals Cursor | [MCP-endpoint](/docs/developers/mcp-endpoint) |
| Chatwidget | Bokito-chat op je eigen site embedden | [Widget embedden](/docs/developers/widget-embed) |

## Basis-URL

Alle HTTP-API's leven onder je Bokito-origin met het `/api`-prefix:

```
https://jouw-bokito-host/api
```

De REST-API is geversioneerd onder `/api/public/v1`. De interactieve reference voor elk publiek endpoint staat op [/docs/api](/docs/api), gegenereerd uit het live OpenAPI-schema op `/api/docs/openapi.json`.

## Authenticatie in een regel

Maak een API-token (prefix `bok_`) onder **Instellingen, dan Developers**, en stuur het als bearer-token:

```bash
curl -H "Authorization: Bearer bok_..." https://jouw-bokito-host/api/public/v1/signals
```

Scopes beperken wat een token mag. Details in [Authenticatie](/docs/developers/authentication).

## Ontwerpnotities

- Het REST-oppervlak is bewust klein: signals erin, signals eruit. Rijker gedrag (tools draaien, kennis bevragen) loopt via het MCP-endpoint, dat dezelfde governed tools aanbiedt als interne agents gebruiken.
- Alles is tenant-scoped via het token. Cross-tenant-toegang bestaat niet.
- Rate limits gelden per client-IP; zie [Rate limits](/docs/developers/rate-limits).
