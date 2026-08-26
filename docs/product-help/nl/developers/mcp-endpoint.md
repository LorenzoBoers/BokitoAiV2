---
title: MCP-endpoint
intro: Roep workspacetools aan vanuit Cursor of elke MCP-client via JSON-RPC.
description: Gebruik het Bokito-MCP-endpoint om governed workspacetools aan te roepen vanuit externe MCP-clients. Behandelt het JSON-RPC-transport, tokenscopes en een Cursor-voorbeeld.
keywords: mcp, json-rpc, cursor, tools, model context protocol
sort: 50
related: api-overview,authentication,mcp
---

# MCP-endpoint

Bokito stelt zijn toolregister beschikbaar als MCP-server. Externe clients - Cursor, IDE's, andere agentframeworks - roepen exact dezelfde governed tools aan die interne agents gebruiken: een implementatie, twee afnemers.

## Transport

MCP Streamable HTTP: JSON-RPC 2.0 via POST naar een endpoint, geauthenticeerd met een API-token.

```
POST https://jouw-bokito-host/api/mcp
Authorization: Bearer bok_...
Content-Type: application/json
```

Ondersteunde methodes: `initialize`, `ping`, `tools/list` en `tools/call`.

## Voorbeeld: tools oplijsten

```bash
curl -X POST -H "Authorization: Bearer bok_..." -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}' \
  "https://jouw-bokito-host/api/mcp"
```

Elke tool komt terug met een naam, een beschrijving met categorieprefix en een JSON-inputschema.

## Voorbeeld: tool aanroepen

```bash
curl -X POST -H "Authorization: Bearer bok_..." -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0", "id": 2, "method": "tools/call",
    "params": {"name": "search_knowledge", "arguments": {"query": "retourbeleid"}}
  }' \
  "https://jouw-bokito-host/api/mcp"
```

## Scopes en governance

Tokenscopes benoemen toolcategorieen: een scoped token ziet en roept alleen tools in die categorieen aan (lege scopes = alle tools). Los van scopes loopt elke aanroep door de policy-engine van de workspace met API-niveau-vertrouwen - een tool die goedkeuring vereist, levert een beslisverzoek op in plaats van uit te voeren. Externe toegang omzeilt governance nooit.

## Gebruiken vanuit Cursor

Voeg het endpoint toe aan je MCP-configuratie:

```json
{
  "mcpServers": {
    "bokito": {
      "url": "https://jouw-bokito-host/api/mcp",
      "headers": { "Authorization": "Bearer bok_..." }
    }
  }
}
```

De agent in je editor kan dan workspacekennis doorzoeken, gesprekken lezen en andere workspacetools gebruiken, binnen de scopes van het token.
