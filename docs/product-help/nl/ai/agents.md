---
title: Zo werken Agents
intro: De bibliotheek van AI-werkers. Communicatie is waar ze praten; deze pagina is waar je ze aanneemt en brief.
description: Brief bedrijfsagents, zet chattoegang, deactiveer ze, voeg een handtekening toe en stel naam, functie, omschrijving of bot-uiterlijk in.
keywords: agents, ai-workforce, deactiveren, opnieuw activeren, chattoegang, handtekening, avatar, bot, kleur, aanspreekpunt, definitie, bevoegdheid, subagent
sort: 10
related: govern,knowledge,communication,agenda
---

# Zo werken Agents

Agents zijn de AI-werkers van deze workspace. Elke agent heeft één vorm: naam, omschrijving, instructies, model, toegestane tools, eigenaar en optionele standaarden. Bokito is de systeemagent die namens de ingelogde gebruiker handelt en staat niet in de werkersbibliotheek.

## Blader door de bibliotheek

![Agentbibliotheek](/api/docs/assets/agents/library.png)
*Elke agent is een kaart. De standaardagent staat rustig als Standaard gemarkeerd.*

1. Open **Agents**. Bedrijfsagents staan als kaarten. **Kennis** staat onderaan bij Gerelateerd, niet als tab naast Agents. Op elke kaart zie je open gesprekken (de detaillaag, **Open gesprekken**) en threads die een beslissing nodig hebben (**Voor jou**, gefilterd op die agent). Zoeken en de pillen **Alles** en **Bezig** beperken het raster. Een agent die een map leidt, toont die map als chip op de kaart; klik erop om de map te openen. Boven de kaarten staat **Activiteit**: een tijdlijn met **Nu** in het midden en even grote punten. Elk punt heeft een icoon voor het actietype (chat, geplande wake, heartbeat, enzovoort). Als meerdere acties dicht bij elkaar liggen, toont het punt een getal; hover om ze onder elkaar te zien. Sessies van twee minuten of korter tonen één tijdstip, geen van–tot. Klik om de run, het gesprek of het Agenda-item te openen. Op een agentpagina staat die tijdlijn, alleen voor die agent, achter het menu met drie puntjes als **Geschiedenis**.
2. Kies **Nieuwe agent**. Vul een **Naam** in, een verplichte **Functie** (max. 32 tekens), optioneel een **Omschrijving**, selecteer een **Model**, beschrijf de **Instructies** en kies **Agent aanmaken**. De functie staat onder de naam; de omschrijving is een langere optionele tekst. Instructies zijn de brief die de agent volgt. Voor een specialist-module gebruik je onderaan de banner **Afdeling toevoegen** (**Aanbod**; zelfde als op Workforce).
3. Open een kaart. Het tandwiel rechtsboven opent **Instellingen**: instructies, model, regels, handtekening, chattoegang en tools. Gebruik **Nieuw gesprek** om een intern gesprek te starten. Agenda en gesprekken zijn rustige links onder de gecentreerde profielheader. Gerelateerde instellingen (Autonomie, Kennis, Govern) staan als links onderaan de pagina, niet in de header.

Leden kunnen een agent openen om te lezen. Ze zien **Je kunt deze agent bekijken. Vraag een beheerder om instellingen te wijzigen.** Ze kunnen nog steeds chatten vanuit Communicatie.

In een chat met een agent toont het zijpaneel de functie onder de naam, in de kleur van de agent. Het aanwezigheidsbolletje zit op de avatar (geen label Standby/Bezig). Kies de modelregel om **Models** te openen. Die live-status is dezelfde op Agents, de Communicatie-rail, Afdelingen en de lead van een map. Kies de agentnaam (of de werkregel) terwijl hij actief is om het gesprek of de run te openen; **Agent openen** blijft de agentpagina. De tellerregel (**2 modules | 3 koppelingen | 999+ tools**) heeft dezelfde gedempte stijl als de modelregel. Openklappen toont één rustige regel met modules en koppelingen (logo dan naam, zonder extra kopjes). Kijkmomenten en signalen van dat gesprek staan onder **Dit gesprek**. Als het gesprek een snapshot-canvas bezit, toont dat blok ook de canvasnaam, een compacte preview en een link ernaartoe.

Echte beslissingen leven in elk gesprek (en onder **Openstaande gesprekken** op de agent). Tipkaarten voor automatische mail tellen daar niet mee.

Nieuwe gesprekken in Communicatie vereisen een **bedrijfsagent**. Als er geen beschikbaar is voor jou, toont de composer **Geen agents beschikbaar**. Open **Agents** of de setupgids om er een toe te voegen.

## Brief een agent

![Agentdetail](/api/docs/assets/agents/agent-brief.png)
*Wijzig doel, model en toegestane tools.*

1. Open de agent. De profielheader toont het mark, de **naam**, de verplichte **functie** (in de markkleur) en optioneel de **omschrijving**. Kies het tandwiel rechtsboven. Onder **Instructies** staat een korte preview. Kies **Bewerken** om de volledige prompt te wijzigen. Wijzig ook **Model en runtime**.
2. Kies onder **Model en runtime** **Workspace-standaard** (volgt [Modellen](/docs/govern/models)), **Automatisch** (Bokito kiest een niveau per actie), of zet **Maki**, **Bokito** of **Kong** vast. Nieuwe agents starten op Workspace-standaard.
3. Kies onder **Tools en toestemmingen** de tool-allowlist. Zet **Web search** en **Fetch page** aan als de agent openbare feiten mag opzoeken of een openbare URL mag lezen (workspace-zoeken blijft via **search index** / docs). De workspace-houding en het beleid per type of draaiboek in [Govern](/docs/govern/govern) begrenzen elke toegestane tool.
4. Kies op [Kanalen](/docs/inbox/channels) met **Komt binnen bij** bij welke afdeling elk kanaal binnenkomt; het aanspreekpunt van die afdeling pakt op. Een agent die op het gesprek is vastgezet wint zolang die agent actief is. **Deactiveren** verbergt de agent uit de bibliotheek, haalt hem uit zijn afdelingen en zet open gesprekken op de lead van de workspace. Oude berichten houden de vorige auteur. Run-geschiedenis blijft.
5. Nadat je een bedrijfsagent hebt aangemaakt, open je een chat en laat je hem zijn eigen briefing uit de bedrijfsdocs voorstellen. De wijziging landt als Govern-concept; keur dat goed onder [Govern](/docs/govern/govern) **Openstaande concepten** of pas de briefing hier zelf aan.

## Bepaal wanneer de agent zelf handelt

1. Open de agent, kies het tandwiel en zoek **Wanneer deze agent zelf handelt**. Zet het **Plafond**: **Handmatig**, **Geassisteerd** of **Autonoom**. Het plafond begrenst alles wat de agent doet, ook de Autonomie van gesprekken die hij bezit. Alleen een eigenaar of beheerder kan Autonoom kiezen.
2. Voeg onder **Regels** een uitzondering toe. Schrijf de situatie op, bijvoorbeeld *Vraag eerst bij alles over terugbetalingen*, kies **Wat de agent doet** (**Nooit doen**, **Eerst vragen**, **Zonder vragen doen**) en de **Soort regel**: **De agent weegt het af** voor een situatie, of **Altijd voor een actie** voor een vaste actie of categorie.
3. Kies **Regel toevoegen**. Regels uit **Regels voor alle agents** op [Govern](/docs/govern/govern) staan hier ook. Elke regel telt hoe vaak hij gebruikt, goedgekeurd en afgewezen is.
4. Kies onder **Probeer uit** een actie en een zekerheid van 1 tot 10, en daarna **Probeer**. Het antwoord zegt of de agent het zelf doet, eerst vraagt of niet mag, en welke regel besliste. Onder zekerheid 7 vraagt de agent altijd.

Versturen naar klanten vraagt altijd, wat de regels ook zeggen. Agents kunnen zelf een regel voorstellen; die komt als kaart in het gesprek om te bevestigen.

## Bepaal wat de agent mag aanraken

De kaart **Definitie** beperkt een agent verder dan zijn toollijst en bepaalt hoe een beurt moet eindigen.

1. Open de agent, kies het tandwiel en zoek **Definitie**.
2. Zet **Bevoegdheid**: **Alle tools**, **Geen ingrijpende tools** (verstuurt nooit naar klanten en doet geen andere ingrijpende wijzigingen) of **Alleen lezen**.
3. Zet **Prompt**: **Aanvullen op Bokito-prompt** houdt de werkregels van Bokito en voegt de instructies toe; **Alleen eigen prompt** gebruikt alleen de instructies.
4. Vul **Geblokkeerde tools** in (geblokkeerd, ook als de toollijst ze noemt), **Vaardigheden** (paden van workspace-documenten die de agent leest wanneer ze van toepassing zijn), **Moet eindigen met** (de agent krijgt een herinnering tot hij een van deze tools aanroept, maximaal 8 keer per beurt) en **MCP-servers**.
5. Kies **Opslaan**. Agents die klantmail beantwoorden eindigen een beurt altijd met een conceptantwoord, een notitie dat er geen antwoord nodig is, een beslissing of een verstuurd antwoord.

## Kies hoeveel de agent nadenkt

**Denkwerk** bepaalt hoe hard de agent nadenkt voor en tussen zijn acties. De agent kiest per stap zelf of hij nadenkt, antwoordt of iets doet; deze instelling is het plafond.

1. Open de agent, kies het tandwiel en zoek **Definitie**.
2. Zet **Denkwerk**: **Licht** voor snelle korte antwoorden, **Normaal** voor het meeste werk of **Grondig** voor analyse en lange taken.
3. Kies **Opslaan**. Een groet of bedankje krijgt altijd een snel antwoord. Bij een langere taak zegt de agent eerst in één zin wat hij gaat doen, doet het daarna en eindigt met het resultaat.

## Laat een agent een deeltaak uitbesteden

Een agent kan een subagent starten voor een zijtaak, zoals uitzoekwerk, terwijl hij zelf doorwerkt.

1. Vraag de agent in een gesprek om iets op te zoeken of na te gaan.
2. Het gesprek toont één regel **Subagent {agent}: {taak}** met de status: **In de wachtrij**, **Bezig**, **Klaar**, **Mislukt** of **Gestopt**.
3. Kies de regel om het resultaat te lezen. De subagent schrijft zelf nooit in het gesprek; de agent die hem startte gebruikt het resultaat in zijn eigen antwoord.
4. Per werkruimte draaien maximaal 32 subagents tegelijk, en een subagent kan geen nieuwe starten.

## Kies wie de agent iets vraagt

1. Open de agent en zoek **Vragen stellen aan**.
2. Laat **Automatisch** staan om de eigenaar van het gesprek te vragen, dan wie het werk overdroeg, dan het eigenaarsteam. Wie afwezig is, wordt overgeslagen.
3. Of kies één persoon of één team. Vragen en concepten gaan daarheen; de agent slaat die persoon nog steeds over zolang die afwezig is.

## Haal een andere agent in een gesprek

1. Open in **Communicatie** een gesprek. Typ op **Team** `@` of kies de **@**-knop ernaast en kies een agent (zelfde chip als bij mensen), of gebruik **Haal een agent erbij** voor een stille sessie. Zonder tag is het bericht voor het hele team en antwoordt de agent die het laatst sprak, tenzij een andere deelnemer duidelijk beter past.
2. `@` maakt ze deelnemer en geeft ze een beurt (zelfde model als de websitewidget en peer-chats). Noem twee agents, of schrijf "allebei", en ze antwoorden na elkaar in de volgorde waarin je ze noemde. Avatars onder het onderwerp tonen wie meedoet; **Wacht op …** toont wie de volgende is.
3. Agents stellen elkaar zelf een vraag of dragen het gesprek over. Een agentbericht dat begint met de chip van een andere agent is een vraag aan die agent; een naam midden in een zin is alleen een link. De activiteitsregel toont **{naam} gevraagd** of **Overgedragen aan {naam}**, en het antwoord verschijnt in het gesprek. Na een paar agentbeurten zonder jou stoppen ze met één regel die de beurt aan jou teruggeeft. Een nieuw bericht van jou vervangt beurten die nog wachtten, en **Stop** beëindigt de lopende beurt en alles wat klaarstaat.
4. Leads nodigen modulespecialisten uit (Koppelingen → Aannemen / Installeren) in plaats van module- of labelwerk zelf te doen. Peer-chats via **start conversation** zien eruit als elk ander intern gesprek; zijtaken gaan via een subagent (zie hieronder).

## Neem een modulespecialist aan

1. Open **Koppelingen**, daarna een module zoals **Boekhouding**.
2. Kies onder **Afdeling** **Specialist aannemen**. Bokito maakt een specialist voor die module, zet die in de module-afdeling en opent een setup-chat.
3. Of zet een bestaande bedrijfsagent in die afdeling. Agents in de module-afdeling en de afdelingen eronder krijgen de tools van die module.
4. In een gesprek kan een agent een module aanraden die je nog niet hebt geïnstalleerd. Het antwoord toont dezelfde kaart als bij Koppelingen: de specialist, wat de module doet, partnerlogo's en **Installeren**. **Aanzetten** goedkeuren neemt die specialist aan.

## Module- en afdelingsagents

Sommige agents horen bij een module (bijvoorbeeld een aangenomen Boekhouding-specialist, of een Trading-packagent). Onder de naam staat in het klein dat ze uit die module komen, en die regel opent de module op Koppelingen.

1. Open **Agents**. Een modulespecialist toont **Uit de module Boekhouding** onder de omschrijving.
2. Open de agent. Die regel linkt naar de module op Koppelingen.
3. Als je zo’n agent **Deactiveert**, zet pack- of moduleherinstallatie hem niet stil terug. Bokito opent een herstel-Decision in Communicatie; keur die goed om de agent weer in de bibliotheek te zetten, of wijs af om hem gedeactiveerd te houden.

## Beperk wie mag chatten

1. Een stille agent toont **Klaar**. Open het tandwiel en kies **Communicatie** (chattoegang). Kies **Iedereen**, **Geselecteerde gebruikers** of **Niemand**.
2. **Niemand** houdt achtergrondwerk (Agenda, Autonomie) zonder directe chat vanuit Communicatie. Front desk-, folder- en andere lead-agents starten op **Iedereen**, zodat het hele team ze direct kan aanspreken.
3. Om een agent uit de bibliotheek te halen, gebruik **Deactiveren** onder het ···-menu. Status wordt **Gedeactiveerd**. Op **Agents** open je het filter **Gedeactiveerd** om ze terug te vinden, of gebruik **Opnieuw activeren** op de agentpagina of op [Workforce](/docs/getting-started/team) onder **Gedeactiveerd**. Gedeactiveerde agents verdwijnen uit keuzelijsten en kanaaltoegang; achtergebleven toekenningen verdwijnen bij opslaan. Geschiedenis blijft. Elke kaart toont de functieomschrijving onder de naam.

## Voeg een agenthandtekening toe

1. Open op een bedrijfsagent het tandwiel en kies **E-mailhandtekening & verzenden als**.
2. Kies de standaard **Verzenden als**: **Als deze agent** (ondertekent als de agent) of **Als de goedkeurende collega** (impersoneert wie goedkeurt).
3. Vul een platte-teksthandtekening in. Regelafbrekingen blijven staan. Wanneer de agent namens zichzelf mailt, voegt Bokito altijd een korte regel “Beantwoord door een AI-agent · Powered by Bokito AI” toe met een link naar [bokito.ai](https://bokito.ai).
4. Sla op. Goedkeuringen voor deze agent gebruiken die standaard tot je op de kaart een andere Send as kiest.

## Stel naam, functie, omschrijving of uiterlijk in

1. Open een bedrijfsagent.
2. Hover de **naam**: die wordt een pil met een pennetje. Een klik opent dezelfde dialoog als het potlood op het agentmark (of **Bewerken** via het ···-menu).
3. Pas de **naam** aan, vul de verplichte **Functie** in (max. 32 tekens; onder de naam in de markkleur), voeg optioneel een langere **Omschrijving** toe, kies **Initialen** of **Bot**. Bij **Bot** kies je een **vorm** en een **kleur** voor het geanimeerde gezicht (snelkeuze: paars, de workspace-accentkleur en grijs; open **Meer kleuren** voor de rest), en sla op. De lichamen van Claude en Cursor houden hun originele kleuren; voor die vormen is de kleurkeuze verborgen. Instructies staan in het tandwiel; dat is niet deze omschrijving.
4. Als gesprekken aan staan, kies je onder **Stemkwaliteit** **Workspace-standaard (Ops)**, **Huidig (standaard)** of **Top (Ferrari)** voor de voicemail- en live-callmodellen van deze agent, en daarna onder **Stem**, **Snelheid** en **Taal** hoe die klinkt. Een andere stem, snelheid, taal of kwaliteit speelt een kort fragment af en het teken praat. Dat is de agentstandaard. Staff zet de workspace-standaard op **Ops → Stemkwaliteit**. In een live gesprek laten **Gespreksinstellingen** de persoon aan de lijn een andere stem, snelheid of taal kiezen voor zichzelf. Die keuze blijft bij die persoon voor deze agent en laat de standaard van de agent staan.
5. In live chats volgt het gezicht de beurt: luistert terwijl je typt, denkt tijdens redeneren, zoekt tijdens opzoeken, schrijft terwijl tekst binnenkomt of een voorstel klaarstaat en verstuurt bij overdracht aan een collega. Aan het eind van de beurt toont het klaar, vertrekt het na een overdracht of toont het een alert na een fout. Alleen terwijl de agent bezig is (denken, zoeken, schrijven, versturen of werk) licht er een zachte orb in de eigen kleur van de agent achter hem op, ruim buiten het teken, die groeit en krimpt met het werk. Orbits en badges rond het teken blijven AI-paars. In rust kijkt het gezicht naar je cursor en leunt het er een beetje naartoe. De dev-workspace toont onder de kleuren ook **Bekijk beweging**, met de stemmingen (**Idle**, **Luistert**, **Denkt**, **Werkt**, **Zoekt**, **Schrijft**, **Verstuurt**, **Slaapt**) en de korte reacties (**Ja**, **Nee**, **Alert**, **Sprong**, **Klaar**, **Vertrekt**).

Dezelfde look zie je in de Agents-bibliotheek, agentdetail, Communicatie en de webchat-headerbubble van de antwoordingende agent.

## Plan de agent

1. Open vanaf de agent **Agenda**.
2. Je landt op [Agenda](/docs/ai/agenda) gefilterd op die agent.
3. Koppel een wake zodat de agent draait zonder dat je een chat start. Een oriëntatie is geen agenda-item: de agent kijkt rond en logt dat bij activiteiten.

## Wat nu

Richt de agent op [Kennis](/docs/ai/knowledge). Stel in hoe ver die mag gaan onder [Autonomie](/docs/govern/autonomy).
