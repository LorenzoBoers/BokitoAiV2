---
title: Zo werken Agents
intro: De bibliotheek van AI-werkers. Communicatie is waar ze praten; deze pagina is waar je ze aanneemt en brief.
description: Brief bedrijfsagents, zet chattoegang, archiveer ze, voeg een handtekening toe en stel initialen of icoon in.
keywords: agents, ai-workforce, archiveren, chattoegang, handtekening, avatar, icoon, standaardagent
sort: 10
related: govern,knowledge,communication,agenda
---

# Zo werken Agents

Agents zijn de AI-werkers van deze workspace. Elke agent heeft één vorm: naam, doel, doelgroep, model, toegestane tools, eigenaar en optionele standaarden. Bokito is de systeemagent die namens de ingelogde gebruiker handelt en staat niet in de werkersbibliotheek.

## Blader door de bibliotheek

![Agentbibliotheek](/api/docs/assets/agents/library.png)
*Elke agent is een kaart. De standaardagent staat rustig als Standaard gemarkeerd.*

1. Open **Agents**. Bedrijfsagents staan als kaarten met hun doelgroep. Op elke kaart zie je open gesprekken en threads die een beslissing nodig hebben. Zoeken en de pillen **Alles** en **Bezig** beperken het raster.
2. Kies **Nieuwe agent**. Vul een **Naam** in, kies de **Doelgroep**, selecteer een **Model**, beschrijf het **Doel** en kies **Agent aanmaken**.
3. Open een kaart voor instructies, model en chattoegang. Gebruik **Chat met deze agent** om een intern gesprek te starten. Agenda en gesprekken zijn rustige links op de detailpagina. Gerelateerde instellingen (Inbox AI, Kennis, Govern) staan als links onderaan de pagina, niet in de header.

Leden kunnen een agent openen om te lezen. Ze zien **Je kunt deze agent bekijken. Vraag een beheerder om instellingen te wijzigen.** Ze kunnen nog steeds chatten vanuit Communicatie.

Echte beslissingen leven in elk gesprek (en onder **Openstaande gesprekken** op de agent). Tipkaarten voor automatische mail tellen daar niet mee.

Nieuwe chats in Communicatie vereisen een **bedrijfsagent**. Als er geen beschikbaar is voor jou, toont de composer **Geen agents beschikbaar**. Open **Agents** of de setupgids om er een toe te voegen.

## Brief een agent

![Agentdetail](/api/docs/assets/agents/agent-brief.png)
*Wijzig doel, doelgroep, model en toegestane tools.*

1. Open de agent. Wijzig **Naam**, **Doel**, **Doelgroep** en **Model**.
2. Kies onder **Tools en toestemmingen** de tool-allowlist. De workspace-houding en het beleid per type of draaiboek in [Govern](/docs/govern/govern) begrenzen elke toegestane tool.
3. Zet **Autonomieniveau** op de agent: **Handmatig — altijd vragen**, **Goedkeuring — begrensde acties**, **Automatisch — zelfstandig handelen**, of **Workspace-standaard**. Dat zit op of onder het workspaceplafond op [Autonomie](/docs/govern/autonomy).
4. Kies in **Communicatie-instellingen** per verbonden kanaal één standaardagent. Een agent die op het gesprek is vastgezet wint altijd. **Archiveren** verbergt de agent en wist de kanaalstandaarden; run-geschiedenis blijft.

## Beperk wie mag chatten

1. Een stille agent toont **Klaar**. Open **Communicatie** op de agentpagina (chattoegang). Kies **Iedereen**, **Geselecteerde gebruikers** of **Niemand**.
2. **Niemand** houdt achtergrondwerk (Agenda, Inbox AI) zonder directe chat vanuit Communicatie.
3. Om een agent uit de bibliotheek te halen, gebruik **Archiveren** onder het ···-menu.

## Voeg een agenthandtekening toe

1. Open op een bedrijfsagent **E-mailhandtekening & verzenden als**.
2. Kies de standaard **Verzenden als**: **Als deze agent** (ondertekent als de agent) of **Als de goedkeurende collega** (impersoneert wie goedkeurt).
3. Vul een platte-teksthandtekening in. Regelafbrekingen blijven staan. Wanneer de agent namens zichzelf mailt, voegt Bokito altijd een korte regel “Beantwoord door een AI-agent · Powered by Bokito AI” toe met een link naar [bokito.ai](https://bokito.ai).
4. Sla op. Goedkeuringen voor deze agent gebruiken die standaard tot je op de kaart een andere Send as kiest.

## Stel naam of icoon in

1. Open een bedrijfsagent.
2. Kies **Bewerken** naast de agentnaam.
3. Pas de **naam** aan, kies **Initialen** of **Icoon**, en sla op. Agents gebruiken altijd het platform-AI-violet — er is geen eigen kleur- of fotokiezer.

Dezelfde look zie je in de Agents-bibliotheek, agentdetail, Communicatie en de webchat-headerbubble van de antwoordingende agent.

## Plan de agent

1. Open vanaf de agent **Agenda**.
2. Je landt op [Agenda](/docs/ai/agenda) gefilterd op die agent.
3. Koppel een wake zodat de agent draait zonder dat je een chat start.

## Wat nu

Richt de agent op [Kennis](/docs/ai/knowledge). Stel in hoe ver die mag gaan onder [Autonomie](/docs/govern/autonomy).
