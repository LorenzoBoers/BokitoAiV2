---
title: Zo werkt Workforce
intro: Mensen, agents en afdelingen op één pagina, met wie er beschikbaar is.
description: Nodig mensen uit, zie mensen en agents in één directory, groepeer ze in afdelingen, kies hoe een afdeling gesprekken oppakt, meld je afwezig en lees de Grid van binnenkomst tot resultaat.
keywords: workforce, team, leden, uitnodigen, rollen, afdelingen, beschikbaarheid, afwezig, om de beurt, minst open, oppakken, grid, lens, labels, knelpunten
sort: 60
related: setup-guide,communication,agents,channels
---

# Zo werkt Workforce

Workforce toont iedereen die gesprekken afhandelt: de mensen in de workspace, de bedrijfsagents en de afdelingen waarin je ze groepeert. Open **Workforce** in de rail onder **Team** om iemand uit te nodigen, de directory te bekijken of een afdeling te maken. Bovenaan staan de tabs **Mensen en agents**, **Afdelingen**, **Grid** (`/workforce/grid`) en **Workflow** (`/workforce/workflow`). De Grid laat in 3D zien hoe het bedrijf is ingericht. Workflow laat zien hoe werk door het bedrijf loopt: van het kanaal waar het binnenkomt, langs de persoon of agent die het oppakt en de flow waarin het loopt, naar het resultaat waar het landt.

## Nodig iemand uit

![Uitnodigen op Workforce](/api/docs/assets/team/invite.png)
*Eigenaren en beheerders nodigen mensen uit bovenaan Workforce.*

1. Open **Workforce**. Vul onder **Personen uitnodigen** een volledig e-mailadres in en kies **Rol**: **Beheerder** of **Lid**. Kies **Wat mag welke rol** tussen de rol en **Uitnodigen** als je de rechtenmatrix nodig hebt.
2. Kies **Uitnodigen**. Kan deze server geen mail versturen, gebruik dan **Uitnodigingslink kopiëren** en deel die zelf.
3. Openstaande uitnodigingen staan in de directory onder **In afwachting**. Gebruik **Uitnodiging opnieuw versturen** of **Uitnodiging intrekken**. Op een actief iemand wijzig je de rol of kies je **Deactiveren**. Alleen de **Eigenaar** kan een eigenaar promoveren, degraderen of deactiveren.

Leden beantwoorden gesprekken. Eigenaren en beheerders koppelen ook kanalen, wijzigen autonomie en nemen Govern-voorstellen aan. Zie [Govern](/docs/govern/govern).

## Neem nieuwe agents aan

1. Open op **Workforce**, onder **Personen uitnodigen**, de banner **Neem nieuwe agents aan**.
2. Kies **Aanbod**. Die opent Koppelingen gefilterd op modules (`/connections?kind=modules`), waar je specialisten naast het team installeert.

## Meld je afwezig

1. Open je accountmenu (onderaan de rail) en zet aanwezigheid op **Afwezig**. Je stip wordt overal grijs: in de lijst, in het gesprek, bij toewijzen en op Workforce.
2. Zolang je afwezig bent, slaan agents je over als ze kiezen wie ze iets vragen, geven afdelingen je geen nieuwe gesprekken, en telt de websitechat je niet mee als beschikbaar voor een live overdracht.
3. Zet aanwezigheid weer op beschikbaar als je terug bent. Iemand telt als beschikbaar zolang Bokito open staat op een van zijn apparaten.

Agents tonen een paarse hoekmarkering: stil als ze op standby staan, pulsend als ze echt aan een gesprek of run werken.

## Lees de directory

1. Op **Workforce** toont de directory mensen, openstaande uitnodigingen en bedrijfsagents samen. Onder de naam van een agent staat de functie in de kleur van die agent. **Type** is gewone tekst: **Persoon** voor mensen en uitnodigingen, **AI agent** voor bedrijfsagents (`ai_agent`). Filter met **Alles**, **Mensen**, **Agents**, **In afwachting** of **Gedeactiveerd**, of zoek op naam. **Alles**, **Mensen** en **Agents** verbergen gedeactiveerde rijen. De kolom **Laatst actief** toont wanneer iemand voor het laatst online was en wanneer een agent voor het laatst draaide. Via Gerelateerd open je **Agents** (zelfde filter **Gedeactiveerd** daar).
2. Elke persoon toont rol, afdelingen, open werk en aanwezigheid (**Beschikbaar**, **Afwezig**, **Offline**). In **Rol / plafond** wijzigt een eigenaar of beheerder de rol van een persoon, en het plafond van een agent met hetzelfde soort menu: **Handmatig**, **Geassisteerd** of **Autonoom**. Alleen een eigenaar of beheerder kan een plafond naar **Autonoom** zetten. Elke agent gebruikt dezelfde markering als op Agents en in Communicatie, en Status is **Standby**, **Bezig** of **Fout**. Open een agent voor 30-dagencijfers en regels (zie [Agents](/docs/ai/agents)). **Open in Grid** in de paginakop opent de Grid (zelfde knop op Agents, Flows, Werkmappen en Koppelingen).
3. Mensen en agents gebruiken hun eigen markering; afdelingen gebruiken een facepile van leden. De hoekpunten volgen één hiërarchie: groen als een persoon beschikbaar is, paars pulsend als een agent in het team bezig is, oranje als iemand afwezig is, stil paars als alleen agents beschikbaar zijn, grijs als iedereen offline is.

## Deactiveer een persoon of agent

1. Open op **Workforce** de rij van een persoon of bedrijfsagent. Kies **Deactiveren**. Die verdwijnt uit het werkrooster: kiezers, afdelingen, toewijzing en chatdoelen slaan hen over. Geschiedenis in gesprekken en agentruns blijft.
2. Status op die rij (en op de agentpagina) is **Gedeactiveerd**. Open het filter **Gedeactiveerd** om iedereen te zien die buiten het rooster staat.
3. Kies **Opnieuw activeren** op de rij, of **Opnieuw activeren** op de agentpagina, om hen terug te zetten. Dezelfde e-mail opnieuw uitnodigen brengt een gedeactiveerd persoon ook terug als die de uitnodiging accepteert.

## Maak een afdeling

1. Scroll naar **Afdelingen** en kies **Nieuwe afdeling**. **Alle mensen** en **Alle agents** bestaan altijd; hun leden volgen de workspace. Die systeemafdelingen kun je niet bewerken of qua oppakken wijzigen, en ze verschijnen nooit als map in Communicatie.
2. Geef een eigen afdeling een naam en eventueel een omschrijving. Vink de mensen en agents aan. Een afdeling mag beide mengen. De markering is altijd de facepile van de leden — er is geen aparte keuze voor initialen of icoon.
3. Kies onder **Gesprekken oppakken** wat er gebeurt met nieuwe gesprekken van de afdeling:
   - **Mensen pakken op**: het gesprek blijft bij het team; wie als eerste reageert, neemt het.
   - **Agent eerst**: een agent in het team antwoordt eerst; mensen springen bij als hij iets vraagt.
   - **Om de beurt**: elk nieuw gesprek gaat direct naar het volgende beschikbare lid.
   - **Minst open**: elk nieuw gesprek gaat naar het beschikbare lid met de minste open gesprekken.
4. Kies **Opslaan**. Elke eigen afdeling verschijnt onder **Afdelingen** in de Communicatie-zijbalk. Klikken toont het open werk van die afdeling, met **Niet toegewezen** daaronder.
5. Terug op **Workforce** openen de naam van een eigen afdeling en de knop **Gesprekken** diezelfde map. Links op elke afdelingsrij — en in de toewijskieser, vermeldingen en Communicatie-mappen — staat die facepile: drie ledenmarkeringen bij drie mensen of agents; bij meer is de derde cirkel **+N**. Agentmarkeringen op Workforce openen de agentpagina en komen overeen met de markering op die pagina. De systeemafdelingen **Alle mensen** en **Alle agents** hebben geen map; hun naam blijft gewone tekst.

Om de beurt en minst open geven alleen werk aan mensen die beschikbaar zijn en agents die het kanaal mogen afhandelen. Past niemand, dan blijft het gesprek bij het team. Elke toewijzing staat in de tijdlijn en in het auditlog. Maak een team eigenaar van een kanaal onder **Instellingen**, **Kanalen** (zie [Kanalen](/docs/inbox/channels)).

## Bekijk de Grid

De Grid is de organisatiekaart in 3D: het bedrijf in het midden en elke afdeling als eiland met haar mensen en agents, en de werkmappen, flows en koppelingen waarmee ze werken.

1. Open **Workforce** en kies **Grid**.
2. Sleep om te schuiven, sleep met rechts om te kantelen en scroll om te zoomen. Namen bij de markeringen verschijnen vanaf **160%**; daaronder toont de kaart alleen de markeringen. Wijs een markering aan om de naam te lezen. Eilandnamen en de bedrijfsnaam blijven zichtbaar.
3. Wijs een item in de legenda aan om het en zijn directe koppelingen te laten oplichten. Klik erop om het op de kaart te vinden; klik op de kaart om de pagina ervan te openen.

**Open in Grid** op Agents, Flows, Werkmappen en Koppelingen opent deze kaart met dat item gevonden.

## Volg werk in Workflow

![Workflow in 2D met de lens Stroom](/api/docs/assets/team/grid.png)
*Binnenkomst links, uitvoerders per afdeling, flows, en rechts het resultaat.*

1. Open **Workforce** en kies **Workflow**. Vier kolommen lees je van links naar rechts: **Binnenkomst**, **Uitvoerders · per afdeling**, **Flow · hoe** en **Resultaat · waar het landt**. De dikte van een lijn is het aantal gesprekken in de gekozen periode (**7 dagen**, **30 dagen** of **90 dagen**).
2. Kies een lens. **Stroom** toont de stroom. **Labels** kleurt een lijn in de kleur van het flow-label, met hetzelfde icoon als elders. Labels zonder flow staan samen als **Overig**, in grijs. Kies een label om alleen dat label door de keten te volgen. **Autonomie** kleurt uitvoerders naar wat ze zelf mogen (**Autonoom**, **Geassisteerd**, **Handmatig**). Het paneel rechts begint met **Knelpunten**: knooppunten die aandacht vragen, zoals werk dat niemand oppakt, of een persoon of agent met meer dan 15 open gesprekken of meer dan twee keer wat in het team gewoon is.
3. Workflow opent in **3D**: de vier lagen staan als platen naast elkaar. Kies **2D** voor het platte bord met dezelfde knooppunten. Sleep om te verschuiven, scroll om te zoomen en kies **Beginbeeld** om terug te gaan naar het startbeeld.
4. Kies een knooppunt. Het paneel rechts toont waar het werk vandaan komt en waar het heen gaat, elk met het eigen icoon, en de verdeling per label. Zijn er knelpunten, dan staat links van het paneel een knop met een uitroepteken en het aantal. Kies die en de lijst Knelpunten verschijnt op die plek, naast het paneel. Sluit de lijst en de knop komt terug. Het item blijft open. Is het knooppunt een agent of een persoon, dan staat het gezicht links, de functie in kleur ernaast en de omschrijving eronder. Een agent ademt als hij vrij is en toont de werkbeweging als hij bezig is. Een persoon houdt dezelfde opbouw, met zijn foto. **Open gesprekken** opent dat werk in Communicatie. Op een werkmap opent **Toevoegen aan Werkt in** de werkmap met het toevoegformulier klaar.
5. Heeft veel werk van een knooppunt geen label, kies dan **Labels voorstellen**. Er opent een agentchat met dat werk zonder label, de afzenders en bedrijven, en de agent stuurt één labelplan; er verandert niets tot je het goedkeurt. Zie [Labels en tickets](/docs/ai/categories).

De kolom Resultaat zegt **Geschat** zolang nog niet elk resultaat als oplevering is vastgelegd. Een werkmap in die kolom telt het werk van de werkmappen hierin mee; kies hem om elke werkmap hierin met een eigen aantal te zien. Een gesprek dat gesloten is als **Geen antwoord nodig** of **Al afgehandeld buiten Bokito** telt niet als gesloten zonder resultaat; het paneel van die put toont hoeveel het er waren. Een gesprek telt onder zijn flow-label, of zonder flow-label onder het label dat het als eerste kreeg. Het oranje vak **Zonder afdeling** bevat mensen en agents die gesprekken afhandelen maar in geen afdeling zitten.

## Persoonlijke instellingen blijven persoonlijk

Iedereen heeft **Profiel** en **Notificaties**. Op Profiel (**Instellingen** → **Profiel & beveiliging**) kies je **Voornaam**, **Achternaam**, **Taal** (Nederlands of Engels voor de dashboard-UI — menu's en labels; dat is niet de werktaal van de organisatie), **Startpagina**, **Weergave**, en optioneel een persoonlijke **E-mailhandtekening** (terugval wanneer een mailbox ieders eigen handtekening gebruikt; placeholders zoals `{{name}}`, `{{first_name}}` en `{{last_name}}` komen uit het profiel). Gedeelde mailbox-handtekeningen staan onder **Instellingen** → **Kanalen**. De werktaal van de organisatie (hoe agents voor het team schrijven) staat onder **Instellingen** → **Communicatie**. Op Notificaties kies je per niveau wat je bereikt: **Nu** (een gesprek of vraag voor jou, een nieuw bericht op een gesprek van jou of je team — standaard aan met in-app en push — een vermelding, een klant die op een mens wacht), **Later** (systeemmeldingen zoals een mislukte run of een Govern-voorstel, nooit als push) en **Overzicht** (teamactiviteit en afgeronde runs, ingeklapt in de bel en als dagelijkse e-mail). Gesprekken die jou nodig hebben staan in **Voor jou** in Communicatie; de belbadge volgt dat aantal en opent **Voor jou**, terwijl de lijst onder de bel systeemmeldingen houdt.

## Wat nu

Rond de [setupgids](/docs/getting-started/setup-guide) af, koppel daarna [kanalen](/docs/inbox/channels) en kies welk team elk kanaal bezit.
