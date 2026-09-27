---
title: MCP-endpoint
intro: Roep workspace-tools aan vanuit Cursor of een andere MCP-client via JSON-RPC.
description: Gebruik het Bokito MCP-endpoint om governed workspace-tools vanuit externe MCP-clients aan te roepen. Behandelt OAuth met alleen-URL, het JSON-RPC-transport, token-scopes en een Cursor-voorbeeld.
keywords: mcp, json-rpc, cursor, tools, model context protocol, oauth
sort: 50
related: api-overview,authentication,mcp
---

# MCP-endpoint

Bokito biedt zijn tool-registry aan als MCP-server. Externe clients - Cursor, IDE's, andere agent-frameworks - roepen precies dezelfde governed tools aan als interne agents: één implementatie, twee consumenten.

## Koppelen met OAuth (aanbevolen)

Plak alleen de MCP-URL in Cursor-instellingen → MCP. Bij eerste gebruik opent Cursor de browser: log in bij Bokito en kies een workspace onder je account.

```json
{
  "mcpServers": {
    "bokito": {
      "url": "https://your-bokito-host/api/mcp"
    }
  }
}
```

Onder **Instellingen → Developers** staat **Cursor MCP-URL-config kopiëren** voor hetzelfde fragment. Voor dit pad is geen API-token nodig.

## Gekoppelde clients

Na autorisatie verschijnt de sessie onder **Instellingen → Developers → Gekoppelde MCP-clients**. Kies **Intrekken** om toegang meteen te stoppen; Cursor moet opnieuw autoriseren. Hergebruik van een refresh-token trekt ook de hele sessiefamilie in.

## Transport

MCP Streamable HTTP: JSON-RPC 2.0 via POST, plus GET met `Accept: text/event-stream` voor de idle SSE-probe. Clients authenticeren met een OAuth access-token (na de browserflow) of met een API-token. Antwoorden kunnen `Mcp-Session-Id` bevatten.

```
POST https://your-bokito-host/api/mcp
Authorization: Bearer …
Content-Type: application/json
```

Ondersteunde methoden: `initialize`, `ping`, `tools/list`, `tools/call`, plus `resources/list`, `resources/read`, `prompts/list` en `prompts/get` voor IDE-discovery. Tools adverteren MCP-annotaties (`readOnlyHint`, `destructiveHint`). Resources serveren product-help-markdown.

## API-token als fallback

Voor CI of scripts zonder browser: maak een token onder **Instellingen → Developers** en plak een bearer-config (`Authorization: Bearer bok_…`). Dat pad gebruikt geen OAuth.

## Voorbeeld: tools ophalen

```bash
curl -X POST -H "Authorization: Bearer bok_..." -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}' \
  "https://your-bokito-host/api/mcp"
```

Elke tool komt terug met een naam, een beschrijving met categorieprefix, en een JSON input-schema.

## Wat je kunt aanroepen

`tools/list` is de bron van waarheid, maar deze families staan er altijd:

- `messaging` - threads lezen en samenvatten (`list_threads`), beantwoorden of sluiten, en CRM met `list_contacts`, `get_contact` en `upsert_contact`
- `agents` - workforce bekijken met `list_agents`, `get_agent`, `list_playbooks` en `get_playbook`; agents en playbooks aanmaken of bijwerken
- `triggers` - `list_triggers` voor de Agenda, plus nieuwe wakes plannen
- `cases` - typed intake: `list_case_types`, `list_cases`, `create_case`
- `govern` - `get_tenant_overview`, `get_usage_summary` en `resolve_decision` voor een openstaande beslissingskaart
- `workspace` - kennis: `search_index`, `list_docs`, `read_doc`, `write_doc`

## Voorbeeld: een tool aanroepen

```bash
curl -X POST -H "Authorization: Bearer bok_..." -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0", "id": 2, "method": "tools/call",
    "params": {"name": "search_index", "arguments": {"query": "restitutiebeleid"}}
  }' \
  "https://your-bokito-host/api/mcp"
```

## Scopes en governance

OAuth-consent en API-token-scopes noemen toolcategorieën: een scoped credential ziet en roept alleen tools in die categorieën aan (lege scopes = alle tools). Los van scopes loopt elke call door de workspace-policy-engine met API-trust - een tool die goedkeuring nodig heeft maakt een decision request in plaats van uit te voeren. Externe toegang omzeilt governance nooit.

## Gebruik vanuit Cursor

1. Kopieer de URL-only config onder **Instellingen → Developers**.
2. Plak die onder Cursor-instellingen → MCP.
3. Autoriseer in de browser en kies de workspace wanneer Cursor daarom vraagt.
4. Tools van die workspace verschijnen voor de agent, binnen scopes en Govern.
5. Om later te ontkoppelen: open **Gekoppelde MCP-clients** en kies **Intrekken**.
