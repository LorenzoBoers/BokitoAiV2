---
title: Zo werken Agents
intro: De bibliotheek van AI-werkers. Communicatie is waar ze praten; deze pagina is waar je ze aanneemt en brief.
description: Brief bedrijfsagents, zet chattoegang, deactiveer ze, voeg een handtekening toe en stel initialen of icoon in.
keywords: agents, ai-workforce, deactiveren, opnieuw activeren, chattoegang, handtekening, avatar, icoon, standaardagent
sort: 10
related: govern,knowledge,communication,agenda
---

# Zo werken Agents

Agents zijn de AI-werkers van deze workspace. Elke agent heeft één vorm: naam, doel, model, toegestane tools, eigenaar en optionele standaarden. Bokito is de systeemagent die namens de ingelogde gebruiker handelt en staat niet in de werkersbibliotheek.

## Blader door de bibliotheek

![Agentbibliotheek](/api/docs/assets/agents/library.png)
*Elke agent is een kaart. De standaardagent staat rustig als Standaard gemarkeerd.*

1. Open **Agents**. Bedrijfsagents staan als kaarten. Op elke kaart zie je open gesprekken (de detaillaag, **Open gesprekken**) en threads die een beslissing nodig hebben (**Voor jou**, gefilterd op die agent). Zoeken en de pillen **Alles** en **Bezig** beperken het raster. Boven de kaarten staat **Activiteit**: een tijdlijn met **Nu** in het midden en even grote punten. Elk punt heeft een icoon voor het actietype (chat, geplande wake, heartbeat, enzovoort). Als meerdere acties dicht bij elkaar liggen, toont het punt een getal; hover om ze onder elkaar te zien. Sessies van twee minuten of korter tonen één tijdstip, geen van–tot. Klik om de run, het gesprek of het Agenda-item te openen. Dezelfde tijdlijn staat op elke agentpagina, dan alleen voor die agent.
2. Kies **Nieuwe agent**. Vul een **Naam** in, selecteer een **Model**, beschrijf het **Doel** en kies **Agent aanmaken**.
3. Open een kaart voor instructies, model en chattoegang. Gebruik **Chat met deze agent** om een intern gesprek te starten. Agenda en gesprekken zijn rustige links op de detailpagina. Gerelateerde instellingen (AI-afhandeling, Kennis, Govern) staan als links onderaan de pagina, niet in de header.

Leden kunnen een agent openen om te lezen. Ze zien **Je kunt deze agent bekijken. Vraag een beheerder om instellingen te wijzigen.** Ze kunnen nog steeds chatten vanuit Communicatie.

In een chat met een agent toont het zijpaneel **AI-agent** in dezelfde gedempte stijl als de modelregel. Het aanwezigheidsbolletje zit op de avatar (geen label Standby/Bezig). Kies de modelregel om **Models** te openen. **Nu actief** verschijnt terwijl hij werkt en **Laatst actief 5 minuten geleden** na zijn laatste run of antwoord. Die live-status is dezelfde op Agents, de Communicatie-rail, Teams en de project-lead. Kies de agentnaam (of de werkregel) terwijl hij actief is om het gesprek of de run te openen; **Agent openen** blijft de agentpagina. De tellerregel (**2 modules | 3 koppelingen | 999+ tools**) heeft dezelfde gedempte stijl als de modelregel. Openklappen toont één rustige regel met modules en koppelingen (logo dan naam, zonder extra kopjes). Kijkmomenten en signalen van dat gesprek staan onder **Dit gesprek**.

Echte beslissingen leven in elk gesprek (en onder **Openstaande gesprekken** op de agent). Tipkaarten voor automatische mail tellen daar niet mee.

Nieuwe chats in Communicatie vereisen een **bedrijfsagent**. Als er geen beschikbaar is voor jou, toont de composer **Geen agents beschikbaar**. Open **Agents** of de setupgids om er een toe te voegen.

## Brief een agent

![Agentdetail](/api/docs/assets/agents/agent-brief.png)
*Wijzig doel, model en toegestane tools.*

1. Open de agent. De kaart **Instructies** toont een korte preview. Kies **Bewerken** om de volledige prompt in een dialoog te wijzigen. Wijzig ook **Naam**, **Doel** en **Model**.
2. Kies onder **Tools en toestemmingen** de tool-allowlist. De workspace-houding en het beleid per type of draaiboek in [Govern](/docs/govern/govern) begrenzen elke toegestane tool.
3. Kies op [Kanalen](/docs/inbox/channels) per verbonden kanaal één standaardagent. Een agent die op het gesprek is vastgezet wint altijd. **Deactiveren** verbergt de agent uit de bibliotheek en wist de kanaalstandaarden; run-geschiedenis blijft.

## Bepaal wanneer de agent zelf handelt

1. Open de agent en zoek **Wanneer deze agent zelf handelt**. Zet het **Plafond**: **Handmatig**, **Geassisteerd** of **Autonoom**. Het plafond begrenst alles wat de agent doet, ook de AI-afhandeling van gesprekken die hij bezit. Alleen een eigenaar of beheerder kan Autonoom kiezen.
2. Voeg onder **Regels** een uitzondering toe. Schrijf de situatie op, bijvoorbeeld *Vraag eerst bij alles over terugbetalingen*, kies **Wat de agent doet** (**Nooit doen**, **Eerst vragen**, **Zonder vragen doen**) en de **Soort regel**: **De agent weegt het af** voor een situatie, of **Altijd voor een actie** voor een vaste actie of categorie.
3. Kies **Regel toevoegen**. Regels uit **Regels voor alle agents** op [Govern](/docs/govern/govern) staan hier ook. Elke regel telt hoe vaak hij gebruikt, goedgekeurd en afgewezen is.
4. Kies onder **Probeer uit** een actie en een zekerheid van 1 tot 10, en daarna **Probeer**. Het antwoord zegt of de agent het zelf doet, eerst vraagt of niet mag, en welke regel besliste. Onder zekerheid 7 vraagt de agent altijd.

Versturen naar klanten vraagt altijd, wat de regels ook zeggen. Agents kunnen zelf een regel voorstellen; die komt als kaart in het gesprek om te bevestigen.

## Kies wie de agent iets vraagt

1. Open de agent en zoek **Vragen stellen aan**.
2. Laat **Automatisch** staan om de eigenaar van het gesprek te vragen, dan wie het werk overdroeg, dan het eigenaarsteam. Wie afwezig is, wordt overgeslagen.
3. Of kies één persoon of één team. Vragen en concepten gaan daarheen; de agent slaat die persoon nog steeds over zolang die afwezig is.

## Beheerde agents

Sommige agents horen bij een platformstack of module (bijvoorbeeld Trading). Die tonen een badge **Beheerd** op de bibliotheekkaart en de detailpagina.

1. Open **Agents** en zoek een kaart met het label **Beheerd**.
2. Open de agent. De badge noemt bij hover het pakket dat de agent beheert.
3. Als je een beheerde agent **Deactiveert**, zetten stack-seed of updates hem niet stil terug. Bokito opent een herstel-Decision in Communicatie; keur die goed om de agent weer in de bibliotheek te zetten, of wijs af om hem gedeactiveerd te houden.

## Beperk wie mag chatten

1. Een stille agent toont **Klaar**. Open **Communicatie** op de agentpagina (chattoegang). Kies **Iedereen**, **Geselecteerde gebruikers** of **Niemand**.
2. **Niemand** houdt achtergrondwerk (Agenda, AI-afhandeling) zonder directe chat vanuit Communicatie.
3. Om een agent uit de bibliotheek te halen, gebruik **Deactiveren** onder het ···-menu. Status wordt **Gedeactiveerd**. Gebruik **Opnieuw activeren** daar of op [Workforce](/docs/getting-started/team) onder **Gedeactiveerd**. Geschiedenis blijft.

## Voeg een agenthandtekening toe

1. Open op een bedrijfsagent **E-mailhandtekening & verzenden als**.
2. Kies de standaard **Verzenden als**: **Als deze agent** (ondertekent als de agent) of **Als de goedkeurende collega** (impersoneert wie goedkeurt).
3. Vul een platte-teksthandtekening in. Regelafbrekingen blijven staan. Wanneer de agent namens zichzelf mailt, voegt Bokito altijd een korte regel “Beantwoord door een AI-agent · Powered by Bokito AI” toe met een link naar [bokito.ai](https://bokito.ai).
4. Sla op. Goedkeuringen voor deze agent gebruiken die standaard tot je op de kaart een andere Send as kiest.

## Stel naam of icoon in

1. Open een bedrijfsagent.
2. Kies **Bewerken** rechtsboven in de header.
3. Pas de **naam** aan, kies **Initialen** of **Icoon**, en sla op. Agents gebruiken altijd het platform-AI-violet — er is geen eigen kleur- of fotokiezer.

Dezelfde look zie je in de Agents-bibliotheek, agentdetail, Communicatie en de webchat-headerbubble van de antwoordingende agent.

## Plan de agent

1. Open vanaf de agent **Agenda**.
2. Je landt op [Agenda](/docs/ai/agenda) gefilterd op die agent.
3. Koppel een wake zodat de agent draait zonder dat je een chat start.

## Wat nu

Richt de agent op [Kennis](/docs/ai/knowledge). Stel in hoe ver die mag gaan onder [Autonomie](/docs/govern/autonomy).
