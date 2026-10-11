---
title: MCP-servers koppelen
intro: Geef agents extra tools door externe MCP-servers te koppelen.
description: Koppel MCP-servers via de categorie Tools op Koppelingen; eigen servers verschijnen onder Custom MCP-servers. Houd risicovolle tools op Eerst vragen in Govern.
keywords: mcp, model context protocol, gekoppelde tools, integraties
sort: 20
related: integrations,agents,mcp-endpoint
---

# MCP-servers koppelen

MCP is hoe agents externe tools aanroepen via een standaardprotocol. Die logins staan onder **Custom MCP-servers** op **Koppelingen**.

## Voeg een server toe

![MCP-servers](/api/docs/assets/mcp/servers.png)
*Voeg de server-URL en inloggegevens toe.*

1. Open **Koppelingen** in de zijbalk en kies de chip **Tools**. Kies **Custom MCP**, **Alpaca**, of een andere catalogus-app (Notion, Linear, KING Accountancy); rechts opent het paneel.
2. Rond setup af: voor een eigen server vul je een **Weergavenaam**, **Server-URL** en **Authenticatie** (**API-sleutel** of **Bearer-token**) plus **Geheim / token** in. Voor **Alpaca** plak je je Trading API **API-key** en **Secret key** uit het Alpaca-dashboard (Paper Trading → API Keys — niet een Alpaca Connect-app). Gebruik dezelfde waarden als `ALPACA_API_KEY` / `ALPACA_SECRET_KEY` in de [officiële Alpaca MCP-server](https://github.com/alpacahq/alpaca-mcp-server); laat **Paper trading gebruiken** aan tot je live keys hebt. Zodra Bokito als Alpaca Connect-app beschikbaar is, kan setup overschakelen op **Inloggen met Alpaca** zonder dat agent-tools wijzigen.
3. **Verbinding opslaan**. De rij verschijnt onder **Custom MCP-servers** op **Koppelingen**. Kies **Ontkoppelen** om die te verwijderen.

Catalogus-apps zoals Alpaca, Notion, Linear of KING Accountancy houden na setup hun eigen kaart; alleen servers die niet in de catalogus staan landen onder **Custom MCP-servers**. Remote MCP-apps met een publieke URL kunnen in de platformcatalogus worden gezet zodat ze voor elke workspace onder **Tools** verschijnen. Open een appkaart om het **Tool-endpoint** te zien en, na koppelen, de exacte **Tools** die van de MCP-server zijn ontdekt (vernieuw om discovery opnieuw te draaien). Een verkeerd geconfigureerde server faalt vaak pas bij de aanroep, niet bij het koppelen.

## Test eenmaal

1. Start een chat met een [agent](/docs/ai/agents).
2. Vraag die de nieuwe tool te gebruiken.
3. Als de aanroep een beslissing opwerpt, keur die goed in het gesprek.

## Houd governance aan

Externe tools gebruiken hetzelfde beleid als ingebouwde tools. Houd een risicovolle tool op **Eerst vragen** in [Govern](/docs/govern/govern) **Beleid**. Bokito gebruiken vanuit Cursor is het [MCP-endpoint](/docs/developers/mcp-endpoint).

## Wat nu

Koppel eerst een catalogus-app als je alleen een gewone connector nodig hebt. Zie [Integraties](/docs/integrations/integrations).
