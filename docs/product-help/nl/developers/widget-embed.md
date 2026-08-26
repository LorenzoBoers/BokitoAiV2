---
title: Widget embedden
intro: Het technische contract van het embedbare chatwidgetscript.
description: Embed de Bokito-chatwidget met een scripttag. Referentie voor de data-attributen, anonieme en geauthenticeerde modus, en hoe widgetverkeer je inbox bereikt.
keywords: widget, embed, script, livechat, chatwidget
sort: 60
related: widget,api-overview,channels
---

# Widget embedden

De chatwidget is een enkele scripttag. Hij toont een launcher op je site, en elk bezoekersgesprek landt als gesprek in Communication. Deze pagina is het technische contract; de operatorgerichte setup staat in [De websitewidget installeren](/docs/inbox/widget).

## Het snippet

Kopieer het exacte snippet onder **Instellingen, dan AI-assistent, dan Installatie** - het is voorgevuld voor jouw workspace. De vorm:

```html
<script
  src="https://jouw-bokito-host/chat-widget/bokito-chat.js"
  data-bokito-chat-widget
  data-agent-slug="jouw-agent"
  data-api-url="https://jouw-bokito-host"
  data-auth-mode="anonymous"
  defer
></script>
```

## Attributen

- `data-bokito-chat-widget` - markeert de tag; het script start alleen als dit aanwezig is.
- `data-agent-slug` - welke geconfigureerde assistent deze widget beantwoordt.
- `data-api-url` - de Bokito-API-origin waarmee de widget praat.
- `data-auth-mode` - `anonymous` voor publieke websitebezoekers, `required` voor ingelogde gebruikers van je eigen product.
- `defer` - laden zonder je pagina te blokkeren.

## Geauthenticeerde modus

Met `data-auth-mode="required"` identificeert de widget de bezoeker via een token dat jouw pagina aanlevert:

```html
<script>
  window.BokitoConfig = { getAuthToken: () => jouwAccessToken }
</script>
```

Gebruik dit wanneer je de assistent in je eigen product embedt, zodat gesprekken aan de juiste gebruiker hangen.

## Hoe het verbindt

De widget-API staat bewust cross-origin open (de domeinen van jouw klanten zijn willekeurig) en authenticeert met kortlevende sessietokens - nooit cookies, nooit `bok_`-API-tokens. Er wordt niets over je workspace blootgelegd buiten wat de assistent mag zeggen.

## Checklist voor productie

1. Installeer op een stagingpagina en stuur een testbericht.
2. Controleer dat het gesprek in Communication verschijnt op het chatkanaal.
3. Check branding en welkomsttekst onder de widgetinstellingen.
4. Voeg daarna het snippet toe aan je productietemplate.
