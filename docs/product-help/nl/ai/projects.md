---
title: Zo werken Projecten
intro: Een project houdt een doel vast — de landingspagina, het snapshot-canvas, documentatie, wie het leidt, en hoeveel het mag uitgeven.
description: Land op Project voor de flowborden en koppelingen, vraag een agent het snapshot-canvas te schrijven, houd documentatie bij en begrens uitgaven.
keywords: projecten, canvas, dashboard, snapshot, tickets, flows, borden, documentatie, secties, resources, repository, budget, orkestratie
sort: 40
related: workstreams,categories,agenda,knowledge,communication
---

# Zo werken Projecten

Een project is werk over dagen. Open **Projecten** wanneer een doel een thuis moet hebben in plaats van alleen in chat te leven. Een projectdetail heeft vier tabbladen: **Project** (landing: metadata, flowborden, gekoppelde oppervlakken), **Canvas** (snapshot-dashboard dat agents schrijven), **Documentatie** (wat waar is) en **Instellingen** (wie het uitvoert en waar het op werkt). De URL houdt het tabblad bij (`?tab=canvas`, `?tab=docs`, `?tab=settings`) zodat je dat oppervlak kunt delen.

## Maak of open een project

![Projectenlijst](/api/docs/assets/projects/project.png)
*Elke kaart toont de projectagent, open tickets en het budget.*

1. Open **Projecten**. De titel op de pagina is **{workspace} projecten**; het hulp-icoon naast **Projecten** in de bovenbalk opent deze gids. Kies **Nieuw project** (of zoek **Nieuw project** in het commandopalet) en geef het doel een naam, daarna Enter. De URL-slug wordt automatisch gemaakt; open **Geavanceerd: URL-slug** alleen als je die wilt wijzigen.
2. Lees de kaart: projectagent, open tickets (dezelfde borden als Project Home), documentatiegezondheid, repo-status, resterend budget. Zoek op naam of agent als de lijst groeit. Als niets past, toont **Zoekopdracht wissen** alle projecten weer.
3. Open die. Je landt op het tabblad **Project**. Klik de projectagent om die te openen. Beheerders kiezen de pen in de kaartkop om een andere bedrijfsagent als projectstandaard te zetten, of maken er een. Leden kunnen een project lezen; ze kunnen het niet verwijderen of de naam wijzigen.

## Lees Project en verplaats een ticket

Het tabblad **Project** is de landing. De bovenste rij toont de projectagent (klikken opent die; beheerders wijzigen via de pen), de projectagenda onder **Agenda** (openstaande check-ups en geplande kijkmomenten voor de tickets van dit project; **Openen in Agenda** toont ze allemaal) en het resterende budget. Daaronder staan de borden onder **Tickets** en **Recente activiteit**. **Instellingen** houdt de agents, repository, resources en de naam.

![Flowborden op een project](/api/docs/assets/projects/boards.png)
*Eén bord per flow op het project, met de fasen van die flow als kolommen.*

1. Open het tabblad **Project**. Onder **Tickets** is elke flow op dit project één bord, onder elkaar, met de actietag als titel. De kolommen zijn de fasen van de flow, bijvoorbeeld Open, Wachtend en Klaar.
2. Sleep een kaart naar een andere kolom om het ticket naar die fase te zetten. De verplaatsing staat in de tijdlijn van het gesprek.
3. Klik op een kaart om dat gesprek te openen in [Communicatie](/docs/inbox/communication). **Open in communicatie** in de projectkop opent de map van dit project in de Communicatie-zijbalk (de sectie Projecten wordt weer zichtbaar als je die had verborgen, de map scrollt in beeld en licht kort op).
4. Nog geen bord? Beheerders kiezen boven de borden **Flow toevoegen** en kiezen een flow; **Ontkoppelen** op een bord haalt hem weer weg. Zie [Flows](/docs/ai/workstreams).

## Vraag een agent een canvas te schrijven

Een project kan meerdere snapshot-canvasses hebben (geen live tegels). Jij voegt toe, verwijdert en zet **Verversen**; alleen agents schrijven het document met `bokito/canvas` via [Govern](/docs/govern/govern). De projectagent beheert ze standaard. Verversen is een [Agenda](/docs/ai/agenda)-wake (standaard dagelijks om 07:00 UTC), geen aparte scheduler.

1. Open het tabblad **Canvas**. Canvasnamen staan van links naar rechts. **Canvas toevoegen** is de tab ná de laatste canvas. Dat opent een dialoog: **Titel**, **Wat het moet bevatten** en **Verversen** (**Handmatig**, **Dagelijks**, **Wekelijks**, **Uurlijks**, **Maandelijks**). Dagelijks is de standaard. Sla op. De beheeragent begint vanuit je omschrijving.
2. Canvasses staan als tabs van links naar rechts. Zolang het document leeg is, toont de tab dat de agent schrijft. Na toepassen zie je kaarten, stats, tabellen of grafieken van de laatste schrijfbeurt.
3. Admins kunnen **Bron tonen**. Kies **Vraag agent om bij te werken** voor een eenmalige herschrijving, of wijzig Verversen zodat Agenda de agent blijft wekken. Workspace-canvasses staan op Overview **Canvas**.

## Tickets op een project krijgen

1. Kies op het tabblad **Project** **Flow toevoegen** en kies de flow. Flows koppel je vanuit het project; de flowpagina toont alleen waar hij gebruikt wordt.
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

1. Open het tabblad **Project**. De budgetkaart toont verbruik tegen het plafond van vandaag.
2. Kies de pen in de budgetkop. Zet **Dagelijks tokenplafond** en **Uurlijks tokenplafond** zodat één doel niet het hele workspaceplafond opmaakt. Laat een veld leeg om Cockpit **Verbruik** over te nemen. Kies **Budget opslaan**.
3. Als een project het plafond raakt, toont de kaart **Plafond bereikt** en pauzeren agents op dat project. Workspaceplafonds blijven op Cockpit **Verbruik**.

## Wat nu

Definieer de terugkerende processen achter het project onder [Flows](/docs/ai/workstreams), met een eigenaar en check-up per fase. Alles wat voor het project gepland staat, zie je op de [Agenda](/docs/ai/agenda) als je daar het project kiest. Bekijk dezelfde projectdocs onder [Kennis](/docs/ai/knowledge) door op die projectnaam te klikken; workspacebrede kennis blijft op de workspace-chip.
