---
title: Zo werken Projecten
intro: Een project houdt een doel vast — de landingspagina, het snapshot-canvas, documentatie, wie het leidt, en hoeveel het mag uitgeven.
description: Land op Project voor de flowborden en koppelingen, vraag een agent het snapshot-canvas te schrijven, houd documentatie bij en begrens uitgaven.
keywords: projecten, mappen, canvas, dashboard, snapshot, tickets, flows, borden, documentatie, secties, resources, repository, budget, orkestratie
sort: 40
related: workstreams,categories,agenda,knowledge,communication
---

# Zo werken Projecten

Een project is werk over dagen, en het kan mappen bevatten die zelf projecten zijn. Open **Projecten** wanneer een doel een thuis moet hebben in plaats van alleen in chat te leven. Een projectdetail heeft zes tabbladen: **Overzicht** (mappen, wie het uitvoert, agenda, budget, recente gesprekken en activiteit), **Gesprekken** (alles wat in deze map is opgeborgen), **Tickets** (flowborden), **Canvas** (snapshot-dashboard dat agents schrijven), **Documentatie** (wat waar is) en **Instellingen** (wie het uitvoert en waar het op werkt). De URL houdt het tabblad bij (`?tab=conversations`, `?tab=tickets`, `?tab=canvas`, `?tab=docs`, `?tab=settings`) zodat je dat oppervlak kunt delen.

## Maak of open een project

![Projectenlijst](/api/docs/assets/projects/project.png)
*Elke kaart toont de projectagent, open tickets en het budget.*

1. Open **Projecten**. Links staat een mappenmenu. Submappen blijven dicht tot je dat project opent. De titel op de pagina is **{workspace} projecten**; het hulp-icoon naast **Projecten** in de bovenbalk opent deze gids. Kies **Nieuw project** (of zoek **Nieuw project** in het commandopalet) en geef het doel een naam, daarna Enter. De URL-slug wordt automatisch gemaakt; open **Geavanceerd: URL-slug** alleen als je die wilt wijzigen.
2. Lees de kaart: projectagent, open tickets (dezelfde borden als Project Home), documentatiegezondheid, repo-status, resterend budget. De projectagent en de agentchips openen de agentpagina; staat een zoekresultaat in een ander project, dan opent het pad boven de naam die bovenliggende map. Zoek op naam of agent als de lijst groeit. Als niets past, toont **Zoekopdracht wissen** alle projecten weer.
3. Open die. Je landt op het tabblad **Overzicht**. Klik de projectagent om die te openen. Beheerders kiezen de pen in de kaartkop om een andere bedrijfsagent als projectstandaard te zetten, of maken er een. Leden kunnen een project lezen; ze kunnen het niet verwijderen of de naam wijzigen.

## Lees het Overzicht

Het tabblad **Overzicht** is de landing. De kopkaart toont het mapicoon, de naam en de beschrijving voor agents (beheerders wijzigen beide ter plekke; wijzigingen slaan automatisch op), en één regel feiten: open en gesloten gesprekken, hoeveel mappen erin zitten, de projectagent en de gekoppelde repository. Rechts staan **Open in communicatie**, **Nieuwe map** (beheerders) en een menu met meer acties: **Project-ID kopiëren**, **Slug kopiëren**, **Verplaatsen** en **Verwijderen**.

1. **Mappen** staan bovenaan, als kaarten: de naam, open en gesloten gesprekken in die map en dieper, en hoeveel mappen hij bevat. Klik een kaart om de map te openen. Beheerders zien ook een gestippelde kaart **Nieuwe map**.
2. De rij daaronder toont de projectagent (klikken opent die; beheerders wijzigen via de pen), de projectagenda onder **Agenda** (openstaande check-ups en geplande kijkmomenten voor de tickets van dit project; **Openen in Agenda** in de kaartkop toont ze allemaal en **Iets inplannen** op een lege kaart opent Agenda met dit project voorgeselecteerd) en het resterende budget.
3. **Recente gesprekken** toont de laatste open gesprekken in deze map; **Alle gesprekken** schakelt naar het tabblad Gesprekken.
4. **Recente activiteit** toont de laatste agent-runs op dit project. **Instellingen** houdt de agents, repository en resources.

## Bekijk de gesprekken in een map

Elk gesprek dat op dit project of op een map erin is opgeborgen, staat in de Communicatie-zijbalk onder **Projecten**. Het tabblad **Gesprekken** toont dezelfde lijst naast de mappen en borden.

1. Open het tabblad **Gesprekken**. Het getal in de tab is het aantal open gesprekken. Schakel tussen **Open** en **Gesloten**.
2. Elke rij toont de statusstip, het kanaal, het onderwerp, het contact, de map waarin het zit als die dieper ligt dan dit project, en de actietag. Klik een rij om dat gesprek te openen in de map van dit project in Communicatie.
3. **Open in communicatie** naast het filter opent de hele map in de Communicatie-zijbalk (de sectie Projecten wordt weer zichtbaar als je die had verborgen, de map scrollt in beeld en licht kort op). Dezelfde knop staat in de projectkop.
4. Kies onderaan **Meer laden** als de map meer dan dertig gesprekken bevat.

## Verplaats een ticket op een bord

![Flowborden op een project](/api/docs/assets/projects/boards.png)
*Eén bord per flow op het project, met de fasen van die flow als kolommen.*

1. Open het tabblad **Tickets**. Elke flow op dit project is één bord, onder elkaar, met de actietag als titel. De kolommen zijn de fasen van de flow, bijvoorbeeld Open, Wachtend en Klaar.
2. Sleep een kaart naar een andere kolom om het ticket naar die fase te zetten. De verplaatsing staat in de tijdlijn van het gesprek.
3. Klik op een kaart om dat gesprek te openen in [Communicatie](/docs/inbox/communication).
4. Nog geen bord? Beheerders kiezen boven de borden **Flow toevoegen** en kiezen een flow; **Ontkoppelen** op een bord haalt hem weer weg. Zie [Flows](/docs/ai/workstreams).

## Vraag een agent een canvas te schrijven

Een project kan meerdere snapshot-canvasses hebben (geen live tegels). Jij voegt toe, verwijdert en zet **Verversen**; alleen agents schrijven het document met `bokito/canvas` via [Govern](/docs/govern/govern). De projectagent beheert ze standaard. Verversen is een [Agenda](/docs/ai/agenda)-wake (standaard dagelijks om 07:00 UTC), geen aparte scheduler.

1. Open het tabblad **Canvas**. Canvasnamen staan van links naar rechts. **Canvas toevoegen** is de tab ná de laatste canvas. Dat opent een dialoog: **Titel**, **Wat het moet bevatten** en **Verversen** (**Handmatig**, **Dagelijks**, **Wekelijks**, **Uurlijks**, **Maandelijks**). Dagelijks is de standaard. Sla op. De beheeragent begint vanuit je omschrijving.
2. Canvasses staan als tabs van links naar rechts. Zolang het document leeg is, toont de tab dat de agent schrijft. Na toepassen zie je kaarten, stats, tabellen of grafieken van de laatste schrijfbeurt.
3. Admins kunnen **Bron tonen**. Kies **Vraag agent om bij te werken** voor een eenmalige herschrijving, of wijzig Verversen zodat Agenda de agent blijft wekken. Workspace-canvasses staan op Overview **Canvas**.

## Tickets op een project krijgen

1. Kies op het tabblad **Tickets** **Flow toevoegen** en kies de flow. Flows koppel je vanuit het project; de flowpagina toont alleen waar hij gebruikt wordt.
2. Leg een gesprek vast met de actietag van die flow. Vastleggen vraagt bij welk project het hoort; kies dit project. Agents maken dezelfde keuze. Zie [Actietags en tickets](/docs/ai/categories).
3. Het ticket verschijnt in de eerste fase op het bord van die flow, en onder **Projecten** in de zijbalk van Communicatie.
4. Hoeveel een agent zonder vragen mag doen, is één workspacebrede knop: zie [Autonomy](/docs/govern/autonomy).

## Houd projectdocumentatie bij

1. Open het tabblad **Documentatie** (een contextuele weergave van dezelfde docs als Kennis, gefilterd op dit project). Kies **Nieuw document**, geef het een naam en schrijf in **Schrijven** of **Markdown**. Inhoud wordt altijd als markdown opgeslagen.
2. Actieve gekoppelde queue-aanvragen tonen chips op het document. De status blijft op het queue-item.
3. Klap **Secties** uit om per `##`-sectie te werken, elk met een status: **Concept**, **Review** of **Definitief**. Een sectie die een agent tijdens een flow-run schrijft, gaat naar **Review**; gate-goedkeuring promoveert haar naar **Definitief**.
4. Jij bewerkt direct; agents mogen projectdocumentatie alleen bewerken binnen een [flow](/docs/ai/workstreams)-run, zodat achter elke agent-wijziging een werklog zit.
5. Kies **Openen in Kennishub** om hetzelfde document onder Kennis → Projecten te bewerken.

## Koppel resources

1. Open het tabblad **Instellingen**. De repositorykaart koppelt een GitHub-repo zoals voorheen; de status gaat van **Repo indexeren** naar **Repo klaar**.
2. Kies onder **Resources** voor **Resource koppelen** om andere omgevingen aan te haken waar het project op werkt: een drive-map, een Notion-pagina, een spreadsheet, een codeertool of een website.
3. Kies een type, voeg een label en een referentie toe (URL of ID), en kies **Koppelen**. Resources zijn nu gekoppeld op referentie; connectors die synchroniseren en handelen haken hier later op aan.

## Geef een project een eigen koppeling

Koppel een integratiekoppeling wanneer een project staat voor een klant of afdeling met een eigen account, zoals een aparte Moneybird-administratie.

1. Open het tabblad **Instellingen** en kies onder **Resources** voor **Resource koppelen**.
2. Kies het type **Koppeling**, kies de koppeling en daarna **Koppelen**.
3. De koppeling is nu exclusief voor de projecten waaraan hij gekoppeld is. Agents die aan dit project werken gebruiken hem vóór de modulestandaard; werk elders kan hem niet gebruiken.
4. Verwijder de resource om de koppeling weer in de hele workspace bruikbaar te maken. Een project verwijderen waarschuwt wanneer een koppeling alleen aan dat project hangt, omdat hij daarna overal bruikbaar wordt. Beheer dezelfde koppelingen vanaf de providerkaart; zie [Integraties](/docs/integrations/integrations).

## Beperk uitgaven

1. Open het tabblad **Overzicht**. De budgetkaart toont verbruik tegen het plafond van vandaag.
2. Kies de pen in de budgetkop. Zet **Dagelijks tokenplafond** en **Uurlijks tokenplafond** zodat één doel niet het hele workspaceplafond opmaakt. Laat een veld leeg om Cockpit **Verbruik** over te nemen. Kies **Budget opslaan**.
3. Als een project het plafond raakt, toont de kaart **Plafond bereikt** en pauzeren agents op dat project. Workspaceplafonds blijven op Cockpit **Verbruik**.

## Zet een map in een project

Een map is een project met een bovenliggend project. De lijst Projecten toont het bovenste niveau. Zoeken vindt ook een geneste naam en toont het pad erboven.

1. Open het project en kies **Nieuwe map** in de kop, of de gestippelde kaart **Nieuwe map** onder **Mappen**. Geef hem een naam en maak hem aan. Je komt in die map, en die kan zelf weer mappen bevatten.
2. Het tabblad **Overzicht** toont elke map als kaart: de naam, hoeveel gesprekken open en gesloten zijn in die map en dieper, en hoeveel mappen hij bevat. Klik de kaart om die map te openen; het kruimelpad boven de kop en het mappenmenu links tonen waar je bent.
3. Open in een gesprek het menu met meer acties en kies **Opbergen in map**, of **Sluiten en opbergen** om het in één stap te sluiten en op te bergen. Selecteer in de lijst gesprekken, open **Meer acties** en kies **Opbergen in map**.
4. Open het menu met meer acties in de projectkop en kies **Verplaatsen** om de map onder een ander project te zetten, of terug op het bovenste niveau. **Verwijderen** stuurt de mappen erin mee naar de prullenbak. Een canvasverversing van de bovenliggende map neemt de open- en gesloten-tellingen van elke map mee in de momentopname die de agent schrijft.

## Wat nu

Definieer de terugkerende processen achter het project onder [Flows](/docs/ai/workstreams), met een eigenaar en check-up per fase. Alles wat voor het project gepland staat, zie je op de [Agenda](/docs/ai/agenda) als je daar het project kiest. Bekijk dezelfde projectdocs onder [Kennis](/docs/ai/knowledge) door op die projectnaam te klikken; workspacebrede kennis blijft op de workspace-chip.
