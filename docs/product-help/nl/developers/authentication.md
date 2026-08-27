---
title: Authenticatie
intro: API-tokens, scopes en hoe je inloggegevens meestuurt.
description: Maak Bokito-API-tokens aan onder Instellingen, Developers, kies Workspace-API- en agentscopes, en roteer of trek ze in.
keywords: authenticatie, api-token, bearer, scopes, developers, beveiliging
sort: 20
related: api-overview,api-signals,mcp-endpoint
---

# Authenticatie

Elk developer-oppervlak authenticeert met workspace-API-tokens. Owners en admins maken ze aan en trekken ze in onder **Instellingen**, daarna **Developers**.

## Token aanmaken

1. Open **Instellingen** en daarna **Developers**.
2. Onder **App-tokens** kies je **Nieuwe token**. Vul een **Tokennaam** in (bijvoorbeeld `staging-crm`).
3. Onder **Toegang (leeg = alles)** kies je scopes. Laat ze alleen allemaal uit als de integratie écht **Volledige toegang** nodig heeft.
4. Kies **Token aanmaken**. De platte waarde begint met `bok_` en zie je één keer. Kopieer die, of gebruik **curl-voorbeeld kopiëren** voor `GET /api/public/v1/signals`. Kies **Ik heb hem gekopieerd** als je klaar bent. Bokito bewaart alleen een hash; de lijst toont later een prefix zoals `bok_ab12…` plus **laatst gebruikt** of **nooit gebruikt**. Verberg ingetrokken tokens tenzij je de geschiedenis nodig hebt.

## Meesturen

Alle API's nemen het token als bearer-credential:

```
Authorization: Bearer bok_jouw_token_hier
```

Verzoeken zonder geldig token krijgen `401 Unauthorized`.

## Scopes

Het aanmaakformulier groepeert scopes:

- **Workspace-API:** `signals:read` leest gesprekken en berichten. `signals:write` maakt gesprekken aan.
- **Wat agents en apps mogen doen:** `messaging`, `workspace`, `agents`, `channels`, `triggers`, `integrations`, `govern`. Het token kan alleen tools in de aangevinkte groepen zien en aanroepen.

Een lege scopelijst is volledige toegang. Kies liever één token per integratie met alleen de scopes die het nodig heeft. Een verzoek buiten die scopes krijgt `403 Forbidden`.

## Intrekken en roteren

1. Zoek het token in de Developers-lijst.
2. Roteren: maak eerst het nieuwe token, zet de integratie om, trek daarna het oude in.
3. Intrekken stopt het token direct. Laatst-gebruikt maakt verouderde tokens zichtbaar.

## Vuistregels

- Zet nooit een `bok_`-token in frontendcode of een publieke repository. De [chatwidget](/docs/developers/widget-embed) is het enige dat in een browser hoort te draaien, en die gebruikt geen API-tokens.
- Gebruik aparte tokens per omgeving (staging, productie) zodat een lek een kleine straal heeft.
