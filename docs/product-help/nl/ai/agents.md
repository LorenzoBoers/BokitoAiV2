---
title: Zo werken Agents
intro: De bibliotheek van AI-werkers. Communicatie is waar ze praten; deze pagina is waar je ze aanneemt en brief.
description: Brief agents, zet chattoegang, pauzeer ze, voeg een e-mailhandtekening toe en houd je persoonlijke assistent privé.
keywords: agents, ai-workforce, pauze, chattoegang, handtekening, mijn assistent
sort: 10
related: govern,knowledge,communication,agenda
---

# Zo werken Agents

Agents zijn de AI-werkers van deze workspace. Open **Agents** om er een toe te voegen, een brief te wijzigen of een chat te starten. Leden praten met bestaande agents vanuit Communicatie.

## Blader door de bibliotheek

![Agentbibliotheek](/api/docs/assets/agents/library.png)
*Elke agent is een kaart. De standaardbehandelaar heeft een Lead-badge.*

1. Open **Agents**. Bedrijfsagents staan als kaarten. De agent die werk zonder toewijzing behandelt, toont een **Lead**-badge en de regel **Behandelt mail als niets anders is toegewezen**. **Agents filteren** beperkt het raster. Pillen **Alles**, **Bezig**, **Pauze** en **Lead** verbergen de rest.
2. Kies **Nieuwe agent**. Kies een start (**Klantensupport**, **Teamassistent** of **Projectlead**), vul een **Naam** in, kies een **Rol** (de regel eronder legt uit wat die doet), een **Model**, optioneel een **Project**, optioneel **Instructies**, en daarna **Agent aanmaken**.
3. Open een kaart voor instructies, model en chattoegang. Gebruik **Chat** om een intern gesprek te starten. **Meer acties** bevat Kennis, Inbox AI, Setup en **Dupliceren**.

Leden kunnen een agent openen om te lezen. Ze zien **Je kunt deze agent bekijken. Vraag een beheerder om instellingen te wijzigen.** Ze kunnen nog steeds chatten vanuit Communicatie.

Wanneer agents een ja of nee nodig hebben, opent een banner **Beslissingen** in Communicatie. Tipkaarten voor automatische mail (bonnen, nieuwsbrieven) tellen daar niet mee. Als die tips zich hebben opgestapeld, wist **Tipkaarten wissen** ze zonder echte beslissingen te wijzigen.

Je **persoonlijke assistent** is geen bedrijfsagent. Open **Instellingen** en daarna **Mijn assistent**. Zet **Naam van de assistent**, **Instructies** en **Standaardchat** (bedrijfsagent of mijn assistent), en kies **Wijzigingen opslaan**. **Nieuwe chat openen** start vanaf die standaard. Alleen jij ziet die assistent.

## Brief een agent

![Agentdetail](/api/docs/assets/agents/agent-brief.png)
*Wijzig rol, instructies, model en tools.*

1. Open de agent. Wijzig **Naam** en **Instructies**, en sla op.
2. Onder **Tools en toestemmingen** laat je **Autonomieniveau** op **Workspace-standaard**, of zet **Handmatig — altijd vragen**, **Goedkeuring — begrensde acties** of **Automatisch — zelfstandig handelen**. Een korte regel onder de keuze zegt wat dat betekent. Open **Workspace-houding** om de standaard te wijzigen. **Toegestane tools** zonder selectie betekent alle tools, nog steeds begrensd door [Govern](/docs/govern/govern).
3. Kies **Maak lead agent** wanneer deze agent werk zonder specifieke toewijzing moet afhandelen. **Archiveren** vraagt eerst of **Pauzeren** genoeg is. Je kunt de huidige lead niet archiveren tot een andere agent lead is.

## Pauzeer of beperk wie mag chatten

1. Een stille agent toont **Klaar**. Kies op de agentpagina **Pauzeren** om gepland en inbound werk te stoppen (status wordt **Pauze**). **Wekken** hervat. Een gepauzeerde agent maakt Agenda-wakes niet af tot je hervat. **Archiveren** haalt die uit de lijst; run-geschiedenis blijft.
2. Open **Communicatie** op dezelfde pagina (chattoegang). Kies **Iedereen**, **Geselecteerde gebruikers** of **Niemand**.
3. **Niemand** houdt achtergrondwerk (Agenda, Inbox AI) zonder directe chat vanuit Communicatie.

Leads en persoonlijke assistenten gebruiken niet dezelfde pauze- en toegangscontroles als bedrijfsagents.

## Voeg een agenthandtekening toe

1. Open op een bedrijfsagent de kaart voor de e-mailhandtekening.
2. Voeg HTML toe die wordt meegestuurd wanneer antwoorden als die agent de deur uit gaan (automatische verzendingen en goedkeuringen namens de agent).
3. Als de kaart leeg is, is de mailboxhandtekening de terugval. Zie [Kanalen](/docs/inbox/channels).

## Plan de agent

1. Open vanuit de agent **Plannen**.
2. Je landt op de [Agenda](/docs/ai/agenda) gefilterd op die agent.
3. Hang een wake zodat de agent draait zonder dat jij een chat start.

## Wat nu

Wijs de agent naar [Kennis](/docs/ai/knowledge). Zet hoe ver die mag gaan onder [Autonomie](/docs/govern/autonomy).
