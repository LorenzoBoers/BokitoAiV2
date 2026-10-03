---
title: Geef werk aan een codingtool
intro: Koppel Cursor, Claude Managed Agents of Devin en geef codingwerk door vanuit een gesprek.
description: Koppel je eigen API-sleutels onder Instellingen → Developers, keur een Beslissing goed en volg de job in dezelfde thread tot de pull request er is.
keywords: workbench, cursor, claude, devin, coding, pull request, dispatch_work, developers
sort: 55
related: mcp-endpoint,api-overview,decisions
---

# Geef werk aan een codingtool

Geef codingwerk uit een gesprek door aan Cursor, Claude Managed Agents of Devin. Bokito start de job nadat je een Beslissing goedkeurt, toont de voortgang in de thread en brengt de pull request terug.

Koppel je eigen providersleutel onder Instellingen → Developers. Bokito draait de codingtool in deze release niet op eigen servers.

## Koppel Cursor Cloud Agents

![Cursor koppelen op de Developers-pagina](/api/docs/assets/mcp-endpoint/connect-ai-tools.png)

*Geef werk aan een codingtool op Instellingen → Developers.*

1. Open **Instellingen → Developers**.
2. Ga naar **Geef werk aan een codingtool**.
3. Vouw **Cursor Cloud Agents** open.
4. Plak je Cursor-API-sleutel uit het Cursor-dashboard en kies **Koppelen**.
5. Als een agent `dispatch_work` voorstelt, keur de Beslissing goed in Communicatie.

## Koppel Claude Managed Agents

1. Open **Instellingen → Developers → Geef werk aan een codingtool**.
2. Vouw **Claude Managed Agents** open.
3. Plak je Anthropic-API-sleutel. Optioneel: een GitHub-token zodat de sandbox kan clonen en pull requests openen.
4. Kies **Koppelen**.
5. Keur de Beslissing goed wanneer een agent werk aan Claude geeft.

## Koppel Devin

1. Open **Instellingen → Developers → Geef werk aan een codingtool**.
2. Vouw **Devin** open.
3. Plak je Devin service-user API-sleutel (`cog_…`) en organisatie-id.
4. Kies **Koppelen**.
5. Keur de Beslissing goed wanneer een agent een Devin-sessie start.

## Volg een job in het gesprek

1. Open het gesprek waarin de job is gestart.
2. Lees de statusupdates terwijl de tool werkt. Bij een actieve job gebruik je **Vervolg** voor extra instructies of **Stoppen** om te annuleren.
3. Als de tool een vraag stelt, beantwoord de Beslissingskaart; Bokito stuurt je antwoord als vervolg.
4. Als er een pull request verschijnt, open die via de statusregel op het projectcanvas (tegel **Workbench-jobs** en **Resources**) of in de thread.

Je kunt ook **Koppelingen** openen en **Codingtools koppelen** kiezen om bij dezelfde Developers-sectie te komen.
