---
title: MCP-servers koppelen
intro: Geef agents extra tools door externe MCP-servers te koppelen.
description: Koppel MCP-servers via Ontdekken; ze verschijnen in de groep Tools op Koppelingen. Houd risicovolle tools op Eerst vragen in Govern.
keywords: mcp, model context protocol, gekoppelde tools, integraties
sort: 20
related: integrations,agents,mcp-endpoint
---

# MCP-servers koppelen

MCP is hoe agents externe tools aanroepen via een standaardprotocol. Die logins staan in de groep **Tools** op **Koppelingen**.

## Voeg een server toe

![MCP-servers](/api/docs/assets/mcp/servers.png)
*Voeg de server-URL en inloggegevens toe.*

1. Open **Modules** in de zijbalk, daarna **Ontdekken**, en filter **Tools**. Kies **Eigen tool** (of Notion, Linear en andere marketplace-apps).
2. Rond setup af: voor een eigen server vul je een **Weergavenaam**, **Server-URL** en **Authenticatie** (**API-sleutel** of **Bearer-token**) plus **Geheim / token** in.
3. **Verbinding opslaan**. De rij verschijnt onder **Koppelingen** in de groep **Tools**. Kies **Ontkoppelen** om die te verwijderen.

Marketplace-apps zoals Notion of Linear landen hier ook na inloggen in de browser. Een verkeerd geconfigureerde server faalt vaak pas bij de aanroep, niet bij het koppelen.

## Test eenmaal

1. Start een chat met een [agent](/docs/ai/agents).
2. Vraag die de nieuwe tool te gebruiken.
3. Als de aanroep een beslissing opwerpt, keur die goed in het gesprek.

## Houd governance aan

Externe tools gebruiken hetzelfde beleid als ingebouwde tools. Houd een risicovolle tool op **Eerst vragen** in [Govern](/docs/govern/govern) **Beleid**. Bokito gebruiken vanuit Cursor is het [MCP-endpoint](/docs/developers/mcp-endpoint).

## Wat nu

Installeer eerst een marketplace-app als je alleen een gewone connector nodig hebt. Zie [Integraties](/docs/integrations/integrations).
