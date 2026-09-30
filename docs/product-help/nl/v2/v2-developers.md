---
title: V2 voor developers: API, MCP en OAuth
intro: Een toolregister achter de REST-API, het MCP-endpoint en het commandopalet; het beleid wordt een keer toegepast.
description: Integreer met Bokito V2. API-tokens met de scopes read, write en tools, de REST-API en OpenAPI, het MCP-endpoint met OAuth 2.1-discovery en consent, webhooks voor triggers en de workbench, en de modules-API.
keywords: v2, api, rest, openapi, token, scopes, mcp, oauth, pkce, dynamic client registration, consent, webhook, workbench, modules
sort: 70
related: v2-govern,v2-connections,v2-knowledge
---

# V2 voor developers

Alles wat het V2-dashboard doet loopt via `https://v2.bokito.ai/api`. Agents, het commandopalet, de REST-API en het MCP-endpoint roepen allemaal hetzelfde toolregister aan, zodat het workspacebeleid in Govern een keer en voor elke aanroeper op dezelfde manier wordt toegepast.

## API-tokens

Tokens beginnen met `bok2_` en worden een keer getoond.

1. Open in het dashboard **Govern**, **API-tokens**, **Nieuw token** (adminrol vereist).
2. Kies scopes: `read` voor GET-verzoeken, `write` voor mutaties, `tools` voor `POST /api/tools/execute` en `/api/mcp`. Geen scopes betekent alle drie.
3. Stuur het token als `Authorization: Bearer bok2_...`. Het token handelt met de rol van de operator die het maakte en onder het workspacebeleid; gevolgrijke tools veroorzaken een Beslissing in plaats van uit te voeren.
4. Een ontbrekende scope geeft `403` met `WWW-Authenticate: Bearer error="insufficient_scope"`.

## REST-API

De interactieve referentie staat op `https://v2.bokito.ai/api/docs`; het schema op `/api/openapi.json`.

```
GET  /api/conversations?queue=attention
GET  /api/conversations/{id}/messages
POST /api/conversations/{id}/reply        {"body": "..."}      -> ToolOutcome
POST /api/conversations/{id}/notes        {"body": "..."}
POST /api/conversations/{id}/status       {"status": "closed"}
GET  /api/decisions                        open beslissingen
POST /api/decisions/{id}/resolve           {"option": "approve", "note": "..."}
GET  /api/tools                            tools die je mag aanroepen
POST /api/tools/execute                    {"name": "...", "args": {...}}
GET  /api/usage?since=2026-09-01T00:00:00Z kosten en EU-aandeel
GET  /api/outcomes                         samenvatting opgelost-door-agent
```

Mutaties die op een tool zijn afgebeeld geven een `ToolOutcome` terug: `status` is `done`, `decision` (met `decision_id`) of `denied` (met `reason`). Volg de beslissing in plaats van opnieuw te proberen.

## MCP-endpoint

`https://v2.bokito.ai/api/mcp` is een MCP Streamable HTTP-server (JSON-RPC 2.0, protocol `2025-06-18`).

- `tools/list` geeft de tools van de workspace op vertrouwensniveau `api`, inclusief geïnstalleerde moduletools, met de annotaties `readOnlyHint`, `destructiveHint`, `idempotentHint` en `openWorldHint`.
- `tools/call` geeft `content`, `structuredContent` en `isError` terug. Een tool die goedkeuring nodig heeft antwoordt met `status: decision` en een hint; een operator keurt goed in de thread.
- `resources/list` stelt Knowledge-documenten beschikbaar als `bokito://docs/{path}`.
- `prompts/list` biedt `workspace_brief` en `draft_reply`.

Plak alleen de URL in je client:

```json
{ "mcpServers": { "bokito-v2": { "url": "https://v2.bokito.ai/api/mcp" } } }
```

## OAuth 2.1 voor MCP-clients

Clients die OAuth ondersteunen ontdekken de autorisatieserver zelf.

1. Een niet-geauthenticeerde aanroep van `/api/mcp` geeft `401` met `WWW-Authenticate: Bearer resource_metadata="https://v2.bokito.ai/.well-known/oauth-protected-resource/api/mcp"`.
2. De client leest `/.well-known/oauth-authorization-server/api/oauth` en registreert zich met `POST /api/oauth/register` (RFC 7591, client-id's beginnen met `mcp_`).
3. `GET /api/oauth/authorize` met PKCE S256 stuurt de operator naar `/oauth/consent`, waar de gevraagde toegang (lezen, schrijven, tools uitvoeren) wordt getoond en met **Toestaan** wordt goedgekeurd.
4. `POST /api/oauth/token` wisselt de code in voor een `bok2o_`-toegangstoken (1 uur) en een `bok2r_`-vernieuwingstoken (30 dagen, bij elk gebruik geroteerd). `POST /api/oauth/revoke` trekt in.
5. Verbonden clients staan onder **Instellingen**, **Developers**, **Gekoppelde MCP-clients**. **Ontkoppelen** trekt hun tokens direct in.

## Webhooks

- **Triggerwebhooks**: maak een trigger van soort **Webhook** onder **Werk**, **Triggers**. Stuur `POST /api/hooks/{id}` met header `X-Bokito-Secret: <geheim>` en een JSON-body; de body wordt aan het draaiboek of de agent doorgegeven.
- **Workbench-webhooks**: `POST /api/hooks/workbench/{public_key}` wordt door Bokito bij elke opdracht geregistreerd. De body wordt geverifieerd met `X-Webhook-Signature: sha256=<hmac>` over de ruwe body; ongeldige handtekeningen geven `401 invalid_signature`.

## Modules-API

```
GET    /api/modules                        catalogus met installatiestatus
POST   /api/modules/{slug}/install         {"connection_id": "...", "settings": {...}}
PATCH  /api/modules/{slug}                 instellingen of verbinding wijzigen
DELETE /api/modules/{slug}                 verwijderen (uitschakelen, geschiedenis blijft)
```

Moduletools zijn op elk oppervlak verborgen en geweigerd (`403 module_not_installed`) totdat de module is geïnstalleerd.

## Wat nu

- Bepaal wat API-clients zonder vragen mogen doen: [/docs/v2/v2-govern](/docs/v2/v2-govern)
- Koppel de systemen waarmee de tools praten: [/docs/v2/v2-connections](/docs/v2/v2-connections)
