---
title: MCP-endpoint
intro: Roep workspace-tools aan vanuit Cursor, Claude, Codex, VS Code, Windsurf, ChatGPT of een andere MCP-client.
description: Gebruik het Bokito MCP-endpoint om workspace-tools onder Govern aan te roepen vanuit externe AI-tools. Behandelt de pagina Koppel AI-tools, OAuth en app-token per tool, het JSON-RPC-transport, token-scopes en de geplande Workbench om werk aan codingtools te geven.
keywords: mcp, json-rpc, cursor, claude code, claude desktop, codex, vs code, copilot, windsurf, chatgpt, tools, model context protocol, oauth, workbench
sort: 50
related: api-overview,authentication,mcp
---

# MCP-endpoint

Bokito biedt zijn tool-registry aan als MCP-server op `https://your-bokito-host/api/mcp`. Externe AI-tools roepen precies dezelfde tools onder Govern aan als interne agents: één implementatie, twee gebruikers.

## Koppel een AI-tool

**Instellingen → Developers** opent met **Koppel AI-tools**: één rij per tool, met logo en status.

![Koppel AI-tools op de Developers-pagina](/api/docs/assets/mcp-endpoint/connect-ai-tools.png)
*Elke rij opent de stappen en de config voor die tool.*

1. Open **Instellingen** en daarna **Developers**.
2. Open de rij van je tool. De status is **Gekoppeld** zodra die tool met OAuth autoriseerde, **OAuth beschikbaar** wanneer hij zich via de browser kan aanmelden, of **App-token** wanneer hij een token nodig heeft.
3. Kies bovenaan de rij **OAuth (aanbevolen)** of **App-token**. OAuth vraagt geen token: de tool opent de browser, je meldt je aan bij Bokito en kiest een workspace.
4. Volg de stappen en kopieer of download de config. Maak je op dezelfde pagina een app-token aan, dan vullen de tokenfragmenten het in.

## Koppelen vanuit Cursor

1. Open de instellingen van Cursor, daarna MCP, en voeg een server toe.
2. Plak de config met alleen de URL en sla op. Cursor opent de browser om je aan te melden.

```json
{
  "mcpServers": {
    "bokito": { "url": "https://your-bokito-host/api/mcp" }
  }
}
```

Voor een token voeg je `"headers": { "Authorization": "Bearer bok_..." }` toe aan de regel `bokito`.

## Koppelen vanuit Claude Code

1. Voer het commando hieronder uit, start Claude Code en typ `/mcp`.
2. Kies **bokito**, daarna **Authenticate**, en meld je aan bij Bokito.

```bash
claude mcp add --transport http --scope user bokito https://your-bokito-host/api/mcp
```

Voor een token voeg je `--header "Authorization: Bearer bok_..."` toe aan het commando en sla je het aanmelden over.

## Koppelen vanuit Claude Desktop

1. Open in Claude **Settings**, daarna **Connectors**, en kies **Add custom connector**.
2. Vul `https://your-bokito-host/api/mcp` in en kies **Connect**. Meld je aan bij Bokito en kies een workspace.

Claude verbindt vanaf de servers van Anthropic, dus je Bokito-host moet vanaf internet bereikbaar zijn. Voor een token biedt de rij een `claude_desktop_config.json` die de `mcp-remote`-brug start (vraagt Node.js).

## Koppelen vanuit Codex CLI

1. Zet de server in `~/.codex/config.toml`.
2. Voer `codex mcp login bokito` uit en meld je aan bij Bokito.

```toml
[mcp_servers.bokito]
url = "https://your-bokito-host/api/mcp"
```

Voor een token voeg je `bearer_token_env_var = "BOKITO_MCP_TOKEN"` toe en zet je die variabele waar Codex draait. Het token staat dan niet in het bestand.

## Koppelen vanuit VS Code

1. Maak `.vscode/mcp.json`, of voer **MCP: Open User Configuration** uit.
2. Plak de config en kies **Start** boven de server. VS Code opent de browser om je aan te melden, en Copilot kan de tools gebruiken in agentmodus.

```json
{
  "servers": {
    "bokito": { "type": "http", "url": "https://your-bokito-host/api/mcp" }
  }
}
```

De tokenvariant voegt een `inputs`-vraag toe: VS Code vraagt het token één keer en bewaart het in zijn geheime opslag.

## Koppelen vanuit Windsurf

1. Open de MCP-instellingen in Windsurf en bewerk `mcp_config.json`.
2. Plak de config en ververs de servers. Windsurf opent de browser om je aan te melden.

```json
{
  "mcpServers": {
    "bokito": { "serverUrl": "https://your-bokito-host/api/mcp" }
  }
}
```

Voor een token voeg je `"headers": { "Authorization": "Bearer ${env:BOKITO_MCP_TOKEN}" }` toe en zet je de variabele.

## Koppelen vanuit ChatGPT

1. Open in ChatGPT **Settings**, daarna **Apps**, daarna **Advanced settings**, en zet **Developer mode** aan.
2. Kies **Create app**, vul `https://your-bokito-host/api/mcp` in en kies OAuth.
3. Meld je aan bij Bokito en kies een workspace.

ChatGPT ondersteunt alleen OAuth en verbindt vanaf de servers van OpenAI, dus je Bokito-host moet vanaf internet bereikbaar zijn.

## Gekoppelde clients

Na autorisatie verschijnt de sessie onder **Instellingen → Developers → Gekoppelde MCP-clients**, en de rij van de tool toont **Gekoppeld**. Kies **Intrekken** om toegang meteen te stoppen; de tool moet opnieuw autoriseren. Hergebruik van een refresh-token trekt ook de hele sessiefamilie in.

## Transport

MCP Streamable HTTP: JSON-RPC 2.0 via POST, plus GET met `Accept: text/event-stream` voor de idle SSE-probe. Clients authenticeren met een OAuth access-token (na de browserflow) of met een app-token. Antwoorden kunnen `Mcp-Session-Id` bevatten.

```
POST https://your-bokito-host/api/mcp
Authorization: Bearer …
Content-Type: application/json
```

Ondersteunde methoden: `initialize`, `ping`, `tools/list`, `tools/call`, plus `resources/list`, `resources/read`, `prompts/list` en `prompts/get` voor IDE-discovery. Tools adverteren MCP-annotaties (`readOnlyHint`, `destructiveHint`). Resources serveren product-help-markdown.

## App-token als terugval

Voor CI of scripts zonder browser: maak een token onder **Instellingen → Developers → App-tokens** en stuur het mee als `Authorization: Bearer bok_…`. De rij **Elke MCP-client** toont een kant-en-klare `curl`-aanroep.

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
- `agents` - agents bekijken met `list_agents`, `get_agent`, `list_playbooks` en `get_playbook`; agents en draaiboeken aanmaken of bijwerken
- `triggers` - `list_triggers` voor de Agenda, plus nieuwe wakes plannen
- `tickets` - actietags en tickets: `list_categories` (lijst actietags), `get_ticket`, `file_ticket` (zelfde pad als Hashtags toevoegen; geef een van de projecten van de actietag, `null` voor Geen project, of laat `project_id` weg zodat het ticket voorgesteld blijft voor het team) en `update_ticket` om een fase te verplaatsen. Vrije hashtags gaan via `set_thread_tags`, niet via `file_ticket`.
- `govern` - `get_tenant_overview`, `get_usage_summary` en `resolve_decision` voor een openstaande beslissingskaart
- `workspace` - kennis: `search_index`, `list_docs`, `read_doc`, `write_doc`; Prullenbak: `list_trash`, `restore_trash_item` (herstellen vraagt altijd; agents purgen niet)

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

OAuth-consent en app-token-scopes noemen toolcategorieën: een credential met scopes ziet en roept alleen tools in die categorieën aan (lege scopes = alle tools). Los van scopes loopt elke aanroep door de policy-engine van de workspace met API-vertrouwen - een tool die goedkeuring vraagt maakt een beslissing in plaats van uit te voeren. Externe toegang omzeilt Govern nooit.

## Werk aan een codingtool geven

Het blok **Geef werk aan een codingtool** op dezelfde pagina laat je Cursor Cloud Agents, Claude Managed Agents en Devin koppelen met je eigen API-sleutels. Een agent stelt de job voor als Beslissing; na je akkoord blijven voortgang en vragen in dezelfde thread en komt de pull request terug op het project. Zie [/docs/developers/workbench](/docs/developers/workbench).
