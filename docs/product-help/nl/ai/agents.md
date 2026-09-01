---
title: Zo werken Agents
intro: De bibliotheek van AI-werkers. Communicatie is waar ze praten; deze pagina is waar je ze aanneemt en brief.
description: Brief bedrijfsagents, zet chattoegang, archiveer ze, voeg een handtekening toe en stel de visuele identiteit in.
keywords: agents, ai-workforce, archiveren, chattoegang, handtekening, avatar, icoon, standaardagent
sort: 10
related: govern,knowledge,communication,agenda
---

# Zo werken Agents

Agents zijn de AI-werkers van deze workspace. Open **Agents** om er een toe te voegen, een brief te wijzigen of een chat te starten. Leden praten met bestaande agents vanuit Communicatie. Setup vereist minstens één actieve bedrijfsagent. Eén daarvan is de **standaardagent**: nieuwe kanalen en niet-toegewezen werk gebruiken die agent tot je iemand anders kiest.

## Blader door de bibliotheek

![Agentbibliotheek](/api/docs/assets/agents/library.png)
*Elke agent is een kaart. De standaardagent staat rustig als Standaard gemarkeerd.*

1. Open **Agents**. Bedrijfsagents staan als kaarten. De standaardagent toont een rustig label **Standaard**. Op elke kaart kun je **open** gesprekken en threads die een **beslissing** nodig hebben zien — open de kaart en scroll naar **Openstaande gesprekken**, of spring naar Communicatie voor die agent. Zoeken en de pillen **Alles**, **Bezig** en **Standaard** beperken het raster.
2. Kies **Nieuwe agent**. Kies een start (**Klantensupport**, **Teamassistent** of **Projectlead**), vul een **Naam** in, kies een **Rol** (de regel eronder legt uit wat die doet), een **Model**, optioneel een **Project**, optioneel **Instructies**, en daarna **Agent aanmaken**.
3. Open een kaart voor instructies, model en chattoegang. Gebruik **Chat met deze agent** om een intern gesprek te starten. Agenda en gesprekken zijn rustige links op de detailpagina. Gerelateerde instellingen (Inbox AI, Kennis, Govern) staan als links onderaan de pagina, niet in de header.

Leden kunnen een agent openen om te lezen. Ze zien **Je kunt deze agent bekijken. Vraag een beheerder om instellingen te wijzigen.** Ze kunnen nog steeds chatten vanuit Communicatie.

Echte beslissingen leven in elk gesprek (en onder **Openstaande gesprekken** op de agent). Tipkaarten voor automatische mail tellen daar niet mee.

Nieuwe chats in Communicatie vereisen een **bedrijfsagent**. Als er geen beschikbaar is voor jou, toont de composer **Geen agents beschikbaar**. Open **Agents** of de setupgids om er een toe te voegen.

## Brief een agent

![Agentdetail](/api/docs/assets/agents/agent-brief.png)
*Wijzig rol, instructies, model en tools.*

1. Open de agent. Wijzig **Naam** en **Instructies**, en sla op.
2. Onder **Tools en toestemmingen** laat je **Autonomieniveau** op **Workspace-standaard**, of zet **Handmatig — altijd vragen**, **Goedkeuring — begrensde acties** of **Automatisch — zelfstandig handelen**. Een korte regel onder de keuze zegt wat dat betekent. Open **Workspace-houding** om de standaard te wijzigen. **Toegestane tools** zonder selectie betekent alle tools, nog steeds begrensd door [Govern](/docs/govern/govern).
3. Om te wijzigen wie niet-toegewezen werk behandelt, gebruik **Gebruik als standaardagent** onder de naam (alleen beheerders). **Archiveren** (onder het ···-menu) haalt de agent uit de lijst; run-geschiedenis blijft. Je kunt de huidige standaard niet archiveren tot een andere agent standaard is.

## Beperk wie mag chatten

1. Een stille agent toont **Klaar**. Open **Communicatie** op de agentpagina (chattoegang). Kies **Iedereen**, **Geselecteerde gebruikers** of **Niemand**.
2. **Niemand** houdt achtergrondwerk (Agenda, Inbox AI) zonder directe chat vanuit Communicatie.
3. Om een agent uit de bibliotheek te halen, gebruik **Archiveren** onder het ···-menu.

## Voeg een agenthandtekening toe

1. Open op een bedrijfsagent **E-mailhandtekening & verzenden als**.
2. Kies de standaard **Verzenden als**: **Als deze agent** (ondertekent als de agent) of **Als de goedkeurende collega** (impersoneert wie goedkeurt).
3. Vul een platte-teksthandtekening in. Regelafbrekingen blijven staan. Wanneer de agent namens zichzelf mailt, voegt Bokito altijd een korte regel “Beantwoord door een AI-agent · Powered by Bokito AI” toe met een link naar [bokito.ai](https://bokito.ai).
4. Sla op. Goedkeuringen voor deze agent gebruiken die standaard tot je op de kaart een andere Send as kiest.

## Stel icoon, kleur of foto in

1. Open een bedrijfsagent.
2. Op de kaart **Visuele identiteit** kies **Bewerken**.
3. Kies **Initialen**, **Icoon** (met kleur) of **Afbeelding** (upload een foto), en sla op.

Dezelfde look zie je in de Agents-bibliotheek, agentdetail, Berichten, de e-mailhandtekening van de standaardagent (foto indien gezet) en de webchat-headerbubble van de antwoordingende agent.

## Plan de agent

1. Open vanaf de agent **Agenda**.
2. Je landt op [Agenda](/docs/ai/agenda) gefilterd op die agent.
3. Koppel een wake zodat de agent draait zonder dat je een chat start.

## Wat nu

Richt de agent op [Kennis](/docs/ai/knowledge). Stel in hoe ver die mag gaan onder [Autonomie](/docs/govern/autonomy).
