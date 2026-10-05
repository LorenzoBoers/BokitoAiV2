---
title: Zo werken Projecten
intro: Een project houdt een doel vast — de landingspagina, het snapshot-canvas, documentatie, wie het leidt, en hoeveel het mag uitgeven.
description: Land op Project voor het signalenbord en koppelingen, vraag een agent het snapshot-canvas te schrijven, houd documentatie bij en begrens uitgaven.
keywords: projecten, canvas, dashboard, snapshot, signalen, documentatie, secties, resources, repository, budget, orkestratie
sort: 40
related: agenda,knowledge,communication,workstreams
---

# Zo werken Projecten

Een project is werk over dagen. Open **Projecten** wanneer een doel een thuis moet hebben in plaats van alleen in chat te leven. Een projectdetail heeft vier tabbladen: **Project** (landing: metadata, signalenbord, gekoppelde oppervlakken), **Canvas** (snapshot-dashboard dat agents schrijven), **Documentatie** (wat waar is) en **Instellingen** (wie het uitvoert en waar het op werkt). De URL houdt het tabblad bij (`?tab=canvas`, `?tab=docs`, `?tab=settings`) zodat je dat oppervlak kunt delen.

## Maak of open een project

![Projectenlijst](/api/docs/assets/projects/project.png)
*Elke kaart toont de projectagent, open signalen en het budget.*

1. Open **Projecten**. Kies **Nieuw project** (of zoek **Nieuw project** in het commandopalet) en geef het doel een naam, daarna Enter. De URL-slug wordt automatisch gemaakt; open **Geavanceerd: URL-slug** alleen als je die wilt wijzigen.
2. Lees de kaart: projectagent, open signalen (hetzelfde bord als Project Home), documentatiegezondheid, repo-status, resterend budget. Zoek op naam of agent als de lijst groeit. Als niets past, toont **Zoekopdracht wissen** alle projecten weer.
3. Open die. Je landt op het tabblad **Project**. Klik de projectagent om die te openen. Beheerders kiezen de pen in de kaartkop om een andere bedrijfsagent als projectstandaard te zetten, of maken er een. Leden kunnen een project lezen; ze kunnen het niet verwijderen of de naam wijzigen.

## Lees Project en verplaats een signaal

Het tabblad **Project** is de landing: de projectagent (avatar, status, laatst actief; klikken opent de agent, beheerders wijzigen via de pen in de kop), resterend budget met een pen in de kaartkop, gekoppelde draaiboeken, één **Signalen**-kanban, en gekoppelde resources. **Instellingen** houdt naam, repository, draaiboeken en resources — geen tweede kopie van de agent of het budget.

1. Open het tabblad **Project**. Het bord **Signalen** is het getypte werk voor dit project, van links naar rechts: **Voorgesteld**, **Open**, **Wachtend**, **Klaar**.
2. Sleep een kaart naar de volgende status, of open het gespreksicoon op een kaart om terug te gaan naar dat gesprek in [Communicatie](/docs/inbox/communication).
3. Vernieuw het snapshot op het tabblad **Canvas** als het bord de nieuwe stand moet volgen.

## Vraag een agent een canvas te schrijven

Een project kan meerdere snapshot-canvasses hebben (geen live tegels). Jij voegt toe, verwijdert en zet **Verversen**; alleen agents schrijven het document met `bokito/canvas` via [Govern](/docs/govern/govern). De projectagent beheert ze standaard. Verversen is een [Agenda](/docs/ai/agenda)-wake (standaard dagelijks om 07:00 UTC), geen aparte scheduler.

1. Open het tabblad **Canvas**. Canvasnamen staan van links naar rechts. **Canvas toevoegen** is de tab ná de laatste canvas. Dat opent een dialoog: **Titel**, **Wat het moet bevatten** en **Verversen** (**Handmatig**, **Dagelijks**, **Wekelijks**, **Uurlijks**, **Maandelijks**). Dagelijks is de standaard. Sla op. De beheeragent begint vanuit je omschrijving.
2. Canvasses staan als tabs van links naar rechts. Zolang het document leeg is, toont de tab dat de agent schrijft. Na toepassen zie je kaarten, stats, tabellen of grafieken van de laatste schrijfbeurt.
3. Admins kunnen **Bron tonen**. Kies **Vraag agent om bij te werken** voor een eenmalige herschrijving, of wijzig Verversen zodat Agenda de agent blijft wekken. Workspace-canvasses staan op Overview **Canvas**.

## Koppel gesprekken zodat signalen op het bord landen

1. Koppel een gesprek aan een project in het detailpaneel van het gesprek (**Project**).
2. Wanneer de agent dat werk als signaal typt, verschijnt de kaart op het bord **Signalen** onder **Voorgesteld**.
3. Sleep die door **Open**, **Wachtend** en **Klaar**. Hoeveel een agent zonder vragen mag doen, is één workspacebrede knop: zie [Autonomy](/docs/govern/autonomy).

## Houd projectdocumentatie bij

1. Open het tabblad **Documentatie** (een contextuele weergave van dezelfde docs als Kennis, gefilterd op dit project). Kies **Nieuw document**, geef het een naam en schrijf in **Schrijven** of **Markdown**. Inhoud wordt altijd als markdown opgeslagen.
2. Actieve gekoppelde queue-aanvragen tonen chips op het document. De status blijft op het queue-item.
3. Klap **Secties** uit om per `##`-sectie te werken, elk met een status: **Concept**, **Review** of **Definitief**. Een sectie die een agent tijdens een werkstroom-run schrijft, gaat naar **Review**; gate-goedkeuring promoveert haar naar **Definitief**.
4. Jij bewerkt direct; agents mogen projectdocumentatie alleen bewerken binnen een [werkstroom](/docs/ai/workstreams)-run, zodat achter elke agent-wijziging een werklog zit.
5. Kies **Openen in Kennishub** om hetzelfde document onder Kennis → Projecten te bewerken.

## Koppel resources

1. Open het tabblad **Instellingen**. De repositorykaart koppelt een GitHub-repo zoals voorheen; de status gaat van **Repo indexeren** naar **Repo klaar**.
2. Kies onder **Resources** voor **Resource koppelen** om andere omgevingen aan te haken waar het project op werkt: een drive-map, een Notion-pagina, een spreadsheet, een codeertool of een website.
3. Kies een type, voeg een label en een referentie toe (URL of ID), en kies **Koppelen**. Resources zijn nu gekoppeld op referentie; connectors die synchroniseren en handelen haken hier later op aan.

## Beperk uitgaven

1. Open het tabblad **Project**. De budgetkaart toont verbruik tegen het plafond van vandaag.
2. Kies de pen in de budgetkop. Zet **Dagelijks tokenplafond** en **Uurlijks tokenplafond** zodat één doel niet het hele workspaceplafond opmaakt. Laat een veld leeg om Cockpit **Verbruik** over te nemen. Kies **Budget opslaan**.
3. Als een project het plafond raakt, toont de kaart **Plafond bereikt** en pauzeren agents op dat project. Workspaceplafonds blijven op Cockpit **Verbruik**.

## Wat nu

Definieer de terugkerende processen achter het project onder [Werkstromen](/docs/ai/workstreams). Hang een planning op de [Agenda](/docs/ai/agenda). Bekijk dezelfde projectdocs onder [Kennis](/docs/ai/knowledge) door op die projectnaam te klikken; workspacebrede kennis blijft op de workspace-chip.
