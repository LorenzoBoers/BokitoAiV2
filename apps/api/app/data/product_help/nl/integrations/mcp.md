---
title: MCP-servers koppelen
intro: Geef agents extra tools door externe MCP-servers aan de workspace te koppelen.
description: Koppel externe MCP-servers (Model Context Protocol) aan Bokito zodat agents hun tools kunnen gebruiken, en lees hoe Bokito zelf een MCP-endpoint aanbiedt.
keywords: mcp, model context protocol, tools, externe tools, integraties
sort: 20
related: integrations,agents,mcp-endpoint
---

# MCP-servers koppelen

MCP (Model Context Protocol) is een open standaard om AI-agents tools te geven. Bokito spreekt het in beide richtingen: je kunt externe MCP-servers in je workspace pluggen, en Bokito stelt zijn eigen tools beschikbaar als MCP-server voor externe clients.

## Externe server toevoegen

Open **Instellingen, dan Integraties** en voeg een MCP-server toe met URL en inloggegevens. Na het koppelen zijn de tools van die server beschikbaar voor je agents, naast de ingebouwde. Een database-MCP-server laat een agent bijvoorbeeld een orderstatus opzoeken tijdens het beantwoorden van een klant.

## Governance geldt ook hier

Externe tools lopen door dezelfde policy-engine als ingebouwde tools. Apply modes en autonomy posture bepalen of een agent een tool direct mag aanroepen of eerst een beslisverzoek moet indienen. Je kunt een risicovolle externe tool op `decision` houden terwijl de rest vrij draait.

## Test voordat je erop leunt

Draai na het koppelen de tool een keer vanuit een agentgesprek en controleer het resultaat. Een verkeerd geconfigureerde server faalt pas bij de aanroep, niet bij het koppelen, dus een snelle test voorkomt verwarring.

## Bokito als MCP-server

De omgekeerde richting - Bokito's tools gebruiken vanuit Cursor of een andere MCP-client - is een developerfeature. Zie [MCP-endpoint](/docs/developers/mcp-endpoint).
