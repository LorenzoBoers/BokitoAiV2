---
title: Zo werken Agents
intro: De bibliotheek van AI-werkers. Communicatie is waar ze praten; deze pagina is waar je ze aanneemt en brief.
description: Brief bedrijfsagents, zet chattoegang, pauzeer ze, voeg een handtekening toe en stel de visuele identiteit in.
keywords: agents, ai-workforce, pauze, chattoegang, handtekening, avatar, icoon
sort: 10
related: govern,knowledge,communication,agenda
---

# Zo werken Agents

Agents zijn de AI-werkers van deze workspace. Open **Agents** om er een toe te voegen, een brief te wijzigen of een chat te starten. Leden praten met bestaande agents vanuit Communicatie.

## Blader door de bibliotheek

![Agentbibliotheek](/api/docs/assets/agents/library.png)
*Elke agent is een kaart. De standaardbehandelaar heeft een Lead-badge.*

1. Open **Agents**. Bedrijfsagents staan als kaarten. De agent die werk zonder toewijzing behandelt, toont een **Lead**-badge en de regel **Behandelt mail als niets anders is toegewezen**. Op elke kaart kun je **open** gesprekken en threads die een **beslissing** nodig hebben zien — open de kaart en scroll naar **Openstaande gesprekken**, of spring naar Communicatie voor die agent. **Agents filteren** beperkt het raster. Pillen **Alles**, **Bezig**, **Pauze** en **Lead** verbergen de rest.
2. Kies **Nieuwe agent**. Kies een start (**Klantensupport**, **Teamassistent** of **Projectlead**), vul een **Naam** in, kies een **Rol** (de regel eronder legt uit wat die doet), een **Model**, optioneel een **Project**, optioneel **Instructies**, en daarna **Agent aanmaken**.
3. Open een kaart voor instructies, model en chattoegang. Gebruik **Chat** om een intern gesprek te starten. **Meer acties** bevat Kennis, Inbox AI, Setup en **Dupliceren**.

Leden kunnen een agent openen om te lezen. Ze zien **Je kunt deze agent bekijken. Vraag een beheerder om instellingen te wijzigen.** Ze kunnen nog steeds chatten vanuit Communicatie.

Echte beslissingen leven in elk gesprek (en onder **Openstaande gesprekken** op de agent). Tipkaarten voor automatische mail tellen daar niet mee.

Nieuwe chats in Communicatie vereisen een **bedrijfsagent**. Als er geen beschikbaar is voor jou, toont de composer **Geen agents beschikbaar**. Open **Agents** of de setupgids om er een toe te voegen.

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

Leads gebruiken niet dezelfde pauze- en toegangscontroles als andere bedrijfsagents.

## Voeg een agenthandtekening toe

1. Open op een bedrijfsagent **E-mailhandtekening & verzenden als**.
2. Kies de standaard **Verzenden als**: **Als deze agent** (ondertekent als de agent) of **Als de goedkeurende collega** (impersoneert wie goedkeurt).
3. Vul een platte-teksthandtekening in. Regelafbrekingen blijven staan. Wanneer de agent namens zichzelf mailt, voegt Bokito altijd een korte regel “Beantwoord door een AI-agent · Powered by Bokito AI” toe met een link naar [bokito.ai](https://bokito.ai).
4. Sla op. Goedkeuringen voor deze agent gebruiken die standaard tot je op de kaart een andere Send as kiest.


## Stel icoon, kleur of foto in

1. Open een bedrijfsagent.
2. Kies op de kaart **Visuele identiteit** voor **Bewerken**.
3. Kies **Initialen**, **Icoon** (met kleur) of **Afbeelding** (upload een foto), en sla op.

Dezelfde look zie je in de agentbibliotheek, op de agentdetailpagina, in Berichten, in de standaard agent-e-mailhandtekening (foto wanneer ingesteld) en in de webchat-headerbubbel van de antwoorde agent.

## Plan de agent

1. Open vanuit de agent **Plannen**.
2. Je landt op de [Agenda](/docs/ai/agenda) gefilterd op die agent.
3. Hang een wake zodat de agent draait zonder dat jij een chat start.

## Wat nu

Wijs de agent naar [Kennis](/docs/ai/knowledge). Zet hoe ver die mag gaan onder [Autonomie](/docs/govern/autonomy).
